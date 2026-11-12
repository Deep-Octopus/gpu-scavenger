use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use scavenger_protocol::control::{
    agent_message, control_server::Control, AgentHealth, AgentMessage, ClaimEvent, DeviceState,
    MasterMessage, TaskEvent, Welcome,
};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::transport::{Certificate, Identity, ServerTlsConfig};
use tonic::{Request, Response, Status, Streaming};

use crate::auth::EnrollmentGuard;
use crate::store::{EnqueueTask, TaskRecord, TaskStore};

mod scheduler;
mod snapshot;

pub use snapshot::ControllerSnapshot;

type Outbound = mpsc::Sender<Result<MasterMessage, Status>>;

#[derive(Clone)]
pub struct ControllerService {
    state: Arc<ControllerState>,
}

#[derive(Debug, Clone)]
pub struct TlsServerConfig {
    pub certificate: PathBuf,
    pub private_key: PathBuf,
    pub client_ca: Option<PathBuf>,
}

struct ControllerState {
    store: TaskStore,
    enrollment: Mutex<EnrollmentGuard>,
    agents: Mutex<BTreeMap<String, AgentHandle>>,
    next_agent: Mutex<usize>,
    next_session: Mutex<u64>,
}

struct AgentHandle {
    session_id: u64,
    devices: Vec<DeviceState>,
    sender: Outbound,
    busy: bool,
    claim_active: bool,
    quarantined: bool,
    degraded: bool,
    health_reason: String,
    next_command_seq: u64,
}

impl ControllerService {
    pub fn new(store: TaskStore) -> Self {
        Self {
            state: Arc::new(ControllerState {
                store,
                enrollment: Mutex::new(EnrollmentGuard::default()),
                agents: Mutex::new(BTreeMap::new()),
                next_agent: Mutex::new(0),
                next_session: Mutex::new(0),
            }),
        }
    }

    pub fn with_enrollment_token_file(self, path: Option<PathBuf>) -> Self {
        if let Ok(mut guard) = self.state.enrollment.lock() {
            *guard = EnrollmentGuard::from_file(path);
        }
        self
    }

    pub async fn run_scheduler(self) {
        let mut interval = tokio::time::interval(Duration::from_millis(200));
        loop {
            interval.tick().await;
            if let Err(error) = self.state.store.requeue_expired() {
                eprintln!("scheduler requeue error: {error}");
            }
            if let Err(error) = self.state.schedule_once() {
                eprintln!("scheduler error: {error}");
            }
        }
    }

    pub async fn serve(
        self,
        address: SocketAddr,
        tls: Option<TlsServerConfig>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let scheduler = self.clone();
        tokio::spawn(async move { scheduler.run_scheduler().await });
        if let Some(tls) = tls {
            let certificate = std::fs::read(tls.certificate)?;
            let private_key = std::fs::read(tls.private_key)?;
            let identity = Identity::from_pem(certificate, private_key);
            let mut tls_config = ServerTlsConfig::new().identity(identity);
            if let Some(client_ca) = tls.client_ca {
                let ca = std::fs::read(client_ca)?;
                tls_config = tls_config.client_ca_root(Certificate::from_pem(ca));
            }
            return tonic::transport::Server::builder()
                .tls_config(tls_config)?
                .add_service(scavenger_protocol::control::control_server::ControlServer::new(self))
                .serve(address)
                .await
                .map_err(|error| Box::new(error) as Box<dyn std::error::Error + Send + Sync>);
        }
        tonic::transport::Server::builder()
            .add_service(scavenger_protocol::control::control_server::ControlServer::new(self))
            .serve(address)
            .await
            .map_err(|error| Box::new(error) as Box<dyn std::error::Error + Send + Sync>)
    }
}

#[tonic::async_trait]
impl Control for ControllerService {
    type OpenStreamStream = ReceiverStream<Result<MasterMessage, Status>>;

    async fn open_stream(
        &self,
        request: Request<Streaming<AgentMessage>>,
    ) -> Result<Response<Self::OpenStreamStream>, Status> {
        let mut inbound = request.into_inner();
        let first = inbound
            .message()
            .await?
            .ok_or_else(|| Status::invalid_argument("AgentHello is required"))?;
        let hello = match first.message {
            Some(agent_message::Message::Hello(hello)) if !hello.agent_id.is_empty() => hello,
            _ => return Err(Status::invalid_argument("first message must be AgentHello")),
        };
        self.state
            .validate_enrollment(&hello.enrollment_token)
            .map_err(Status::permission_denied)?;
        let agent_id = hello.agent_id.clone();
        let devices = hello
            .devices
            .iter()
            .map(|device| DeviceState {
                uuid: device.uuid.clone(),
                free_memory_bytes: 0,
                process_count: 1,
            })
            .collect();
        let (sender, receiver) = mpsc::channel(32);
        self.state
            .store
            .requeue_agent_tasks(&agent_id)
            .map_err(|error| Status::internal(error.to_string()))?;
        let session_id = self
            .state
            .register_agent(
                agent_id.clone(),
                AgentHandle {
                    session_id: 0,
                    devices,
                    sender: sender.clone(),
                    busy: false,
                    claim_active: false,
                    quarantined: !matches!(
                        hello.health,
                        x if x == AgentHealth::AgentHealthy as i32
                            || x == AgentHealth::AgentDegraded as i32
                    ),
                    degraded: hello.health == AgentHealth::AgentDegraded as i32,
                    health_reason: hello.health_reason.clone(),
                    next_command_seq: 0,
                },
            )
            .map_err(|error| Status::internal(error.to_string()))?;
        sender
            .send(Ok(MasterMessage {
                message: Some(
                    scavenger_protocol::control::master_message::Message::Welcome(Welcome {
                        agent_id: agent_id.clone(),
                        heartbeat_interval_ms: 1_000,
                    }),
                ),
            }))
            .await
            .map_err(|_| Status::unavailable("agent response stream closed"))?;

        let state = self.state.clone();
        tokio::spawn(async move {
            while let Ok(Some(message)) = inbound.message().await {
                state.handle_message(&agent_id, session_id, message);
            }
            state.unregister_agent(&agent_id, session_id);
        });

        Ok(Response::new(ReceiverStream::new(receiver)))
    }
}

impl ControllerState {
    fn validate_enrollment(&self, token: &str) -> Result<(), String> {
        self.enrollment
            .lock()
            .map_err(|_| "enrollment guard lock poisoned".to_string())?
            .validate(token)
            .map_err(|error| error.to_string())
    }

    fn register_agent(
        &self,
        agent_id: String,
        mut handle: AgentHandle,
    ) -> Result<u64, &'static str> {
        let mut agents = self
            .agents
            .lock()
            .map_err(|_| "agent registry lock poisoned")?;
        let mut next_session = self
            .next_session
            .lock()
            .map_err(|_| "session counter lock poisoned")?;
        *next_session = next_session.saturating_add(1);
        handle.session_id = *next_session;
        let session_id = handle.session_id;
        agents.insert(agent_id, handle);
        Ok(session_id)
    }

    fn session_id(&self, agent_id: &str) -> Option<u64> {
        self.agents
            .lock()
            .ok()
            .and_then(|agents| agents.get(agent_id).map(|agent| agent.session_id))
    }

    fn unregister_agent(&self, agent_id: &str, session_id: u64) {
        if let Ok(mut agents) = self.agents.lock() {
            if agents
                .get(agent_id)
                .is_some_and(|agent| agent.session_id == session_id)
            {
                agents.remove(agent_id);
            }
        }
    }

    fn handle_message(&self, agent_id: &str, session_id: u64, message: AgentMessage) {
        if self.session_id(agent_id) != Some(session_id) {
            return;
        }
        let Some(message) = message.message else {
            return;
        };
        match message {
            agent_message::Message::Heartbeat(heartbeat) => {
                if let Err(error) = self.store.renew_agent(agent_id, 60_000) {
                    eprintln!("heartbeat renewal error: {error}");
                }
                self.update_devices(agent_id, heartbeat.devices);
                self.update_health(agent_id, heartbeat.health, heartbeat.health_reason);
            }
            agent_message::Message::TaskEvent(event) => {
                if let Err(error) = self.store.record_event(&event) {
                    eprintln!("task event error: {error}");
                }
                if is_terminal_event(&event) {
                    self.set_busy(agent_id, false);
                }
            }
            agent_message::Message::ResultCommit(commit) => {
                if let Err(error) = self.store.commit_result(&commit) {
                    eprintln!("result commit error: {error}");
                }
            }
            agent_message::Message::Claim(claim) => self.update_claim(agent_id, claim),
            agent_message::Message::CheckpointAck(checkpoint) => {
                if let Err(error) = self.store.record_checkpoint(&checkpoint) {
                    eprintln!("checkpoint commit error: {error}");
                }
            }
            agent_message::Message::Hello(_) => {}
        }
    }

    fn update_devices(&self, agent_id: &str, devices: Vec<DeviceState>) {
        if let Ok(mut agents) = self.agents.lock() {
            if let Some(agent) = agents.get_mut(agent_id) {
                agent.devices = devices;
            }
        }
    }

    fn update_claim(&self, agent_id: &str, claim: ClaimEvent) {
        if let Ok(mut agents) = self.agents.lock() {
            if let Some(agent) = agents.get_mut(agent_id) {
                agent.claim_active = claim.active;
            }
        }
    }

    fn update_health(&self, agent_id: &str, health: i32, reason: String) {
        if let Ok(mut agents) = self.agents.lock() {
            if let Some(agent) = agents.get_mut(agent_id) {
                agent.quarantined = !matches!(
                    health,
                    x if x == AgentHealth::AgentHealthy as i32
                        || x == AgentHealth::AgentDegraded as i32
                );
                agent.degraded = health == AgentHealth::AgentDegraded as i32;
                agent.health_reason = reason;
            }
        }
    }

    pub(super) fn snapshot(&self) -> Result<ControllerSnapshot, String> {
        snapshot::build(self)
    }

    pub(super) fn next_command_seq(&self, agent_id: &str) -> Option<u64> {
        self.agents.lock().ok().and_then(|mut agents| {
            let agent = agents.get_mut(agent_id)?;
            agent.next_command_seq = agent.next_command_seq.saturating_add(1);
            Some(agent.next_command_seq)
        })
    }

    fn set_busy(&self, agent_id: &str, busy: bool) {
        if let Ok(mut agents) = self.agents.lock() {
            if let Some(agent) = agents.get_mut(agent_id) {
                agent.busy = busy;
            }
        }
    }
}

impl ControllerService {
    pub fn snapshot(&self) -> Result<ControllerSnapshot, String> {
        self.state.snapshot()
    }

    pub fn enqueue_task(&self, task: EnqueueTask) -> Result<(), String> {
        self.state
            .store
            .enqueue_with_policy(task)
            .map_err(|error| error.to_string())
    }
}

fn is_terminal_event(event: &TaskEvent) -> bool {
    matches!(
        scavenger_protocol::control::TaskEventKind::try_from(event.kind),
        Ok(scavenger_protocol::control::TaskEventKind::TaskEventReleaseVerified)
    )
}

#[cfg(test)]
mod tests;
