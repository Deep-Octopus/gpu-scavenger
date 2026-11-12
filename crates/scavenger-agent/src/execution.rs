use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use scavenger_core::{GpuProbe, TaskHandle, TaskSpec};
use scavenger_protocol::control::{AgentMessage, TaskAssignment, TaskEventKind};
use tokio::sync::mpsc;

use crate::agent::AgentError;
use crate::artifact::digest_file;
use crate::assignment::{assignment_to_spec, spec_device};
use crate::claim::ClaimFile;
use crate::events::{
    send_claim_event_blocking, send_result_commit_blocking, send_task_event_blocking,
};
use crate::probe::NvmlProbe;
use crate::release::{wait_for_cgroup_id, wait_for_release, wait_for_scope_empty};
use crate::runner::SystemdScopeRunner;

pub(crate) struct ExecutionContext {
    pub(crate) sender: mpsc::Sender<AgentMessage>,
    pub(crate) probe: Arc<NvmlProbe>,
    pub(crate) claim: ClaimFile,
    pub(crate) agent_id: String,
    pub(crate) poll_interval: Duration,
    pub(crate) connection_alive: Arc<AtomicBool>,
    pub(crate) health_ok: Arc<AtomicBool>,
}

pub(crate) fn execute_task(
    assignment: TaskAssignment,
    context: ExecutionContext,
) -> Result<(), AgentError> {
    let ExecutionContext {
        sender,
        probe,
        claim,
        agent_id,
        poll_interval,
        connection_alive,
        health_ok,
    } = context;
    let spec = assignment_to_spec(&assignment)?;
    if claim.is_active()? {
        return hold_before_launch(&sender, &agent_id, &assignment, &spec);
    }
    let initial = probe.query_snapshot(&spec_device(&spec))?;
    if !initial.processes.is_empty() {
        send_task_event_blocking(
            &sender,
            &agent_id,
            &assignment,
            TaskEventKind::TaskEventFailed,
            "device is not idle at assignment time",
        )?;
        return Ok(());
    }
    let (mut runner, handle, cgroup_id) = start_scope(&spec)?;
    send_task_event_blocking(
        &sender,
        &agent_id,
        &assignment,
        TaskEventKind::TaskEventStarted,
        "task started in systemd scope",
    )?;
    let mut context = TaskContext {
        runner: &mut runner,
        handle: &handle,
        cgroup_id,
        assignment: &assignment,
        spec: &spec,
        baseline_free_memory_bytes: initial.free_memory_bytes,
        sender: &sender,
        probe: &probe,
        claim: &claim,
        agent_id: &agent_id,
        connection_alive: &connection_alive,
        health_ok: &health_ok,
    };
    monitor_task(&mut context, poll_interval)
}

fn hold_before_launch(
    sender: &mpsc::Sender<AgentMessage>,
    agent_id: &str,
    assignment: &TaskAssignment,
    spec: &TaskSpec,
) -> Result<(), AgentError> {
    send_claim_event_blocking(
        sender,
        agent_id,
        &spec.device_uuid,
        true,
        "claim file active before task launch",
    )?;
    send_task_event_blocking(
        sender,
        agent_id,
        assignment,
        TaskEventKind::TaskEventStopped,
        "task held by host claim before launch",
    )?;
    send_task_event_blocking(
        sender,
        agent_id,
        assignment,
        TaskEventKind::TaskEventReleaseVerified,
        "no task scope was launched",
    )
}

fn start_scope(spec: &TaskSpec) -> Result<(SystemdScopeRunner, TaskHandle, u64), AgentError> {
    let mut runner = SystemdScopeRunner::new("gpu-scavenger");
    let handle = runner.start_task(spec)?;
    let cgroup_id = match wait_for_cgroup_id(&runner, &handle) {
        Ok(cgroup_id) => cgroup_id,
        Err(error) => {
            if let Err(stop_error) = runner.hard_stop_task(&handle) {
                eprintln!("failed to stop task after cgroup setup error: {stop_error}");
            }
            return Err(error);
        }
    };
    Ok((runner, handle, cgroup_id))
}

struct TaskContext<'a> {
    runner: &'a mut SystemdScopeRunner,
    handle: &'a TaskHandle,
    cgroup_id: u64,
    assignment: &'a TaskAssignment,
    spec: &'a TaskSpec,
    baseline_free_memory_bytes: u64,
    sender: &'a mpsc::Sender<AgentMessage>,
    probe: &'a NvmlProbe,
    claim: &'a ClaimFile,
    agent_id: &'a str,
    connection_alive: &'a AtomicBool,
    health_ok: &'a AtomicBool,
}

fn monitor_task(context: &mut TaskContext<'_>, poll_interval: Duration) -> Result<(), AgentError> {
    loop {
        std::thread::sleep(poll_interval);
        if !context.connection_alive.load(Ordering::Acquire) {
            return stop_disconnected(context);
        }
        if !context.health_ok.load(Ordering::Acquire) {
            return stop_disconnected(context);
        }
        let snapshot = match context.probe.query_snapshot(&spec_device(context.spec)) {
            Ok(snapshot) => snapshot,
            Err(error) => {
                return stop_quarantined_with_error(context, error);
            }
        };
        if context.claim.is_active()? {
            send_claim_event_blocking(
                context.sender,
                context.agent_id,
                &context.spec.device_uuid,
                true,
                "claim file active",
            )?;
            return stop_and_report(context, "task stopped for host claim");
        }
        if snapshot
            .processes
            .iter()
            .any(|process| process.identity.cgroup_id != Some(context.cgroup_id))
        {
            return stop_and_report(context, "task stopped for host claim or external GPU use");
        }
        if let Some(exit_code) = context.runner.poll(context.handle)? {
            return finish_task(context, exit_code);
        }
    }
}

fn stop_and_report(context: &mut TaskContext<'_>, reason: &str) -> Result<(), AgentError> {
    context.runner.hard_stop_task(context.handle)?;
    wait_for_release(
        context.runner,
        context.handle,
        context.probe,
        context.spec,
        context.cgroup_id,
        context.baseline_free_memory_bytes,
    )?;
    send_task_event_blocking(
        context.sender,
        context.agent_id,
        context.assignment,
        TaskEventKind::TaskEventStopped,
        reason,
    )?;
    send_task_event_blocking(
        context.sender,
        context.agent_id,
        context.assignment,
        TaskEventKind::TaskEventReleaseVerified,
        "task cgroup and GPU process released",
    )
}

fn stop_disconnected(context: &mut TaskContext<'_>) -> Result<(), AgentError> {
    context.runner.hard_stop_task(context.handle)?;
    if context.health_ok.load(Ordering::Acquire) {
        wait_for_release(
            context.runner,
            context.handle,
            context.probe,
            context.spec,
            context.cgroup_id,
            context.baseline_free_memory_bytes,
        )?;
    } else {
        wait_for_scope_empty(context.runner, context.handle)?;
    }
    Ok(())
}

fn stop_quarantined_with_error(
    context: &mut TaskContext<'_>,
    error: scavenger_core::ProbeError,
) -> Result<(), AgentError> {
    context.runner.hard_stop_task(context.handle)?;
    wait_for_scope_empty(context.runner, context.handle)?;
    Err(AgentError::Probe(error))
}

fn finish_task(context: &mut TaskContext<'_>, exit_code: i32) -> Result<(), AgentError> {
    wait_for_release(
        context.runner,
        context.handle,
        context.probe,
        context.spec,
        context.cgroup_id,
        context.baseline_free_memory_bytes,
    )?;
    if !context.connection_alive.load(Ordering::Acquire)
        || !context.health_ok.load(Ordering::Acquire)
    {
        return Ok(());
    }
    if exit_code == 0 {
        if let Err(error) = commit_result_if_needed(context) {
            send_task_event_blocking(
                context.sender,
                context.agent_id,
                context.assignment,
                TaskEventKind::TaskEventFailed,
                "result artifact validation failed",
            )?;
            send_release_verified(context)?;
            return Err(error);
        }
    }
    let kind = if exit_code == 0 {
        TaskEventKind::TaskEventSucceeded
    } else {
        TaskEventKind::TaskEventFailed
    };
    let message = format!("task exited with code {exit_code}");
    send_task_event_blocking(
        context.sender,
        context.agent_id,
        context.assignment,
        kind,
        &message,
    )?;
    send_release_verified(context)
}

fn commit_result_if_needed(context: &TaskContext<'_>) -> Result<(), AgentError> {
    if context.assignment.output_path.is_empty() {
        return Ok(());
    }
    let (output_size_bytes, digest) =
        digest_file(std::path::Path::new(&context.assignment.output_path))?;
    send_result_commit_blocking(
        context.sender,
        context.agent_id,
        context.assignment,
        output_size_bytes,
        &digest,
    )
}

fn send_release_verified(context: &TaskContext<'_>) -> Result<(), AgentError> {
    send_task_event_blocking(
        context.sender,
        context.agent_id,
        context.assignment,
        TaskEventKind::TaskEventReleaseVerified,
        "task cgroup and GPU process released",
    )
}
