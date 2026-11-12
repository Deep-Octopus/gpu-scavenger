use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use scavenger_protocol::control::{
    control_client::ControlClient, AgentMessage, TaskAssignment, TaskEventKind,
};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::Request;

use crate::claim::ClaimFile;
pub use crate::connection::AgentTlsConfig;
use crate::connection::{
    current_probe, endpoint, hello, initialize_probe, spawn_heartbeat, SharedProbeRuntime,
};
use crate::events::send_task_event;
use crate::execution::{execute_task, ExecutionContext};

#[derive(Debug, Clone)]
pub struct AgentConfig {
    pub controller: String,
    pub agent_id: String,
    pub claim_path: ClaimFile,
    pub poll_interval: Duration,
    pub tls: Option<AgentTlsConfig>,
    pub enrollment_token: Option<std::path::PathBuf>,
}

#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error("controller connection failed: {0:?}")]
    Transport(#[from] tonic::transport::Error),
    #[error("controller stream failed: {0}")]
    Status(Box<tonic::Status>),
    #[error("agent channel closed")]
    ChannelClosed,
    #[error("task execution failed: {0}")]
    Task(#[from] crate::runner::RunnerError),
    #[error("claim file failed: {0}")]
    Claim(#[from] std::io::Error),
    #[error("result artifact failed: {0}")]
    Artifact(String),
    #[error("task execution join failed: {0}")]
    Join(String),
    #[error("agent configuration failed: {0}")]
    Config(String),
    #[error("agent internal state failed: {0}")]
    Internal(String),
    #[error("GPU probe failed: {0}")]
    Probe(#[from] scavenger_core::ProbeError),
}

impl From<tonic::Status> for AgentError {
    fn from(error: tonic::Status) -> Self {
        Self::Status(Box::new(error))
    }
}

pub async fn run(config: AgentConfig) -> Result<(), AgentError> {
    let runtime = initialize_probe();
    let active = Arc::new(AtomicBool::new(false));
    let health_ok = Arc::new(AtomicBool::new(true));
    let mut backoff = Duration::from_millis(250);
    loop {
        match run_connection(&config, &runtime, &active, &health_ok).await {
            Ok(()) => backoff = Duration::from_millis(250),
            Err(AgentError::Config(error)) => return Err(AgentError::Config(error)),
            Err(error) => {
                eprintln!("controller session ended: {error}");
            }
        }
        tokio::time::sleep(backoff).await;
        backoff = backoff.saturating_mul(2).min(Duration::from_secs(5));
    }
}

async fn run_connection(
    config: &AgentConfig,
    runtime: &SharedProbeRuntime,
    active: &Arc<AtomicBool>,
    health_ok: &Arc<AtomicBool>,
) -> Result<(), AgentError> {
    let endpoint = endpoint(config)?;
    let channel = endpoint.connect().await?;
    let mut client = ControlClient::new(channel);
    let (sender, receiver) = mpsc::channel(32);
    sender
        .send(hello(
            runtime,
            &config.agent_id,
            config.enrollment_token.as_deref(),
        )?)
        .await
        .map_err(|_| AgentError::ChannelClosed)?;
    let response = client
        .open_stream(Request::new(ReceiverStream::new(receiver)))
        .await?;
    let connection_alive = Arc::new(AtomicBool::new(true));
    let last_command_seq = Arc::new(AtomicU64::new(0));
    health_ok.store(is_healthy(runtime), Ordering::Release);
    let heartbeat = spawn_heartbeat(
        sender.clone(),
        runtime.clone(),
        config.agent_id.clone(),
        config.claim_path.clone(),
        config.poll_interval,
        connection_alive.clone(),
        health_ok.clone(),
    );
    let mut stream = response.into_inner();
    let stream_result = loop {
        match stream.message().await {
            Ok(Some(message)) => {
                if let Some(scavenger_protocol::control::master_message::Message::Task(task)) =
                    message.message
                {
                    spawn_assignment(
                        task,
                        AssignmentContext {
                            sender: sender.clone(),
                            runtime: runtime.clone(),
                            claim: config.claim_path.clone(),
                            agent_id: config.agent_id.clone(),
                            active: active.clone(),
                            health_ok: health_ok.clone(),
                            connection_alive: connection_alive.clone(),
                            poll_interval: config.poll_interval,
                            last_command_seq: last_command_seq.clone(),
                        },
                    );
                }
            }
            Ok(None) => break Ok(()),
            Err(error) => break Err(AgentError::from(error)),
        }
    };
    connection_alive.store(false, Ordering::Release);
    heartbeat.abort();
    wait_for_active(active).await;
    stream_result
}

struct AssignmentContext {
    sender: mpsc::Sender<AgentMessage>,
    runtime: SharedProbeRuntime,
    claim: ClaimFile,
    agent_id: String,
    active: Arc<AtomicBool>,
    health_ok: Arc<AtomicBool>,
    connection_alive: Arc<AtomicBool>,
    poll_interval: Duration,
    last_command_seq: Arc<AtomicU64>,
}

fn spawn_assignment(assignment: TaskAssignment, context: AssignmentContext) {
    tokio::spawn(async move {
        if let Err(error) = handle_assignment(assignment, context).await {
            eprintln!("task assignment error: {error}");
        }
    });
}

async fn handle_assignment(
    assignment: TaskAssignment,
    context: AssignmentContext,
) -> Result<(), AgentError> {
    if !accept_command(&context.last_command_seq, assignment.command_seq) {
        return Ok(());
    }
    if context.active.swap(true, Ordering::AcqRel) {
        send_task_event(
            &context.sender,
            &context.agent_id,
            &assignment,
            TaskEventKind::TaskEventFailed,
            "agent already owns an active task",
        )
        .await?;
        return Ok(());
    }
    let Some(probe) = current_probe(&context.runtime) else {
        context.active.store(false, Ordering::Release);
        return Ok(());
    };
    let execution = ExecutionContext {
        sender: context.sender,
        probe,
        claim: context.claim,
        agent_id: context.agent_id,
        poll_interval: context.poll_interval,
        connection_alive: context.connection_alive,
        health_ok: context.health_ok,
    };
    let result = tokio::task::spawn_blocking(move || execute_task(assignment, execution))
        .await
        .map_err(|error| AgentError::Join(error.to_string()))?;
    context.active.store(false, Ordering::Release);
    result
}

fn accept_command(last: &AtomicU64, command_seq: u64) -> bool {
    loop {
        let current = last.load(Ordering::Acquire);
        if command_seq <= current {
            return false;
        }
        if last
            .compare_exchange(current, command_seq, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            return true;
        }
    }
}

async fn wait_for_active(active: &Arc<AtomicBool>) {
    while active.load(Ordering::Acquire) {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

fn is_healthy(runtime: &SharedProbeRuntime) -> bool {
    runtime
        .lock()
        .map(|state| state.health == scavenger_protocol::control::AgentHealth::AgentHealthy as i32)
        .unwrap_or(false)
}
