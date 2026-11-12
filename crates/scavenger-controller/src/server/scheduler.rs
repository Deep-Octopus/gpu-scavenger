use scavenger_protocol::control::{MasterMessage, TaskAssignment};

use super::{ControllerState, DeviceState, Outbound, TaskRecord};

type Candidate = (String, Vec<DeviceState>, Outbound);

impl ControllerState {
    pub(super) fn schedule_once(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let Some((agent_id, devices, sender)) = self.select_candidate()? else {
            return Ok(());
        };
        let mut leased = None;
        for device in devices
            .into_iter()
            .filter(|device| device.process_count == 0)
        {
            if let Some(task) = self.store.lease_next(&agent_id, &device.uuid, 60_000)? {
                leased = Some(task);
                break;
            }
        }
        let Some(task) = leased else {
            self.set_busy(&agent_id, false);
            return Ok(());
        };
        let Some(command_seq) = self.next_command_seq(&agent_id) else {
            self.set_busy(&agent_id, false);
            return Ok(());
        };
        let assignment = assignment_from_task(&task, command_seq);
        if sender
            .try_send(Ok(MasterMessage {
                message: Some(scavenger_protocol::control::master_message::Message::Task(
                    assignment,
                )),
            }))
            .is_err()
        {
            self.set_busy(&agent_id, false);
        }
        Ok(())
    }

    pub(super) fn select_candidate(
        &self,
    ) -> Result<Option<Candidate>, Box<dyn std::error::Error + Send + Sync>> {
        let mut agents = self
            .agents
            .lock()
            .map_err(|_| "agent registry lock poisoned")?;
        let mut cursor = self
            .next_agent
            .lock()
            .map_err(|_| "scheduler cursor lock poisoned")?;
        let agent_ids: Vec<String> = agents.keys().cloned().collect();
        if agent_ids.is_empty() {
            return Ok(None);
        }
        for offset in 0..agent_ids.len() {
            let index = (*cursor + offset) % agent_ids.len();
            let agent_id = &agent_ids[index];
            let Some(agent) = agents.get_mut(agent_id) else {
                continue;
            };
            if agent.busy
                || agent.claim_active
                || agent.quarantined
                || agent.degraded
                || !agent.capabilities.schedulable
            {
                continue;
            }
            agent.busy = true;
            *cursor = (index + 1) % agent_ids.len();
            return Ok(Some((
                agent_id.clone(),
                agent.devices.clone(),
                agent.sender.clone(),
            )));
        }
        Ok(None)
    }
}

fn assignment_from_task(task: &TaskRecord, command_seq: u64) -> TaskAssignment {
    TaskAssignment {
        task_id: task.task_id.clone(),
        lease_epoch: task.lease_epoch,
        device_uuid: task.device_uuid.clone(),
        program: task.program.clone(),
        args: task.args.clone(),
        env: task.env.clone().into_iter().collect(),
        workdir: task.workdir.clone().unwrap_or_default(),
        output_path: task.output_path.clone().unwrap_or_default(),
        policy: task.policy,
        checkpoint_path: task.checkpoint_path.clone().unwrap_or_default(),
        checkpoint_deadline_ms: task.checkpoint_deadline_ms,
        command_seq,
    }
}
