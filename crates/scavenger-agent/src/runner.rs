use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::process::{Child, Command, Output};

use scavenger_core::{CheckpointRequest, TaskHandle, TaskRunner, TaskSpec};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum RunnerError {
    #[error("failed to spawn task: {0}")]
    Spawn(#[from] std::io::Error),
    #[error("systemd command failed: {command}: {stderr}")]
    CommandFailed { command: String, stderr: String },
    #[error("task runner does not support checkpoint requests")]
    CheckpointUnsupported,
    #[error("task {0} is not registered")]
    UnknownTask(String),
    #[error("invalid task identifier: {0}")]
    InvalidTaskId(String),
}

pub struct SystemdScopeRunner {
    runtimes: BTreeMap<String, Child>,
    unit_prefix: String,
}

impl SystemdScopeRunner {
    pub fn new(unit_prefix: impl Into<String>) -> Self {
        Self {
            runtimes: BTreeMap::new(),
            unit_prefix: unit_prefix.into(),
        }
    }

    pub fn start_task(&mut self, spec: &TaskSpec) -> Result<TaskHandle, RunnerError> {
        let unit_name = self.unit_name(&spec.task_id, spec.lease_epoch)?;
        let mut args = vec![
            "--scope".to_string(),
            format!("--unit={unit_name}"),
            "--quiet".to_string(),
            format!("--setenv=CUDA_VISIBLE_DEVICES={}", spec.device_uuid),
        ];
        if let Some(workdir) = &spec.workdir {
            args.push(format!("--working-directory={}", workdir.display()));
        }
        if let Some(checkpoint_path) = &spec.checkpoint_path {
            args.push(format!(
                "--setenv=GPU_SCAVENGER_CHECKPOINT_PATH={}",
                checkpoint_path.display()
            ));
        }
        for (key, value) in &spec.env {
            args.push(format!("--setenv={key}={value}"));
        }
        args.push("--".to_string());
        args.push(spec.program.clone());
        args.extend(spec.args.iter().cloned());

        let child = Command::new("systemd-run").args(args).spawn()?;
        self.runtimes.insert(unit_name.clone(), child);
        Ok(TaskHandle {
            task_id: spec.task_id.clone(),
            unit_name,
        })
    }

    pub fn poll(&mut self, handle: &TaskHandle) -> Result<Option<i32>, RunnerError> {
        let Some(child) = self.runtimes.get_mut(&handle.unit_name) else {
            return Err(RunnerError::UnknownTask(handle.task_id.clone()));
        };
        let Some(status) = child.try_wait()? else {
            return Ok(None);
        };
        let code = status.code().unwrap_or(-1);
        self.runtimes.remove(&handle.unit_name);
        Ok(Some(code))
    }

    pub fn hard_stop_task(&mut self, handle: &TaskHandle) -> Result<(), RunnerError> {
        if self.is_empty(handle)? {
            self.runtimes.remove(&handle.unit_name);
            return Ok(());
        }
        let kill = run_systemctl(&[
            "kill",
            "--kill-who=all",
            "--signal=SIGKILL",
            &handle.unit_name,
        ])?;
        if !kill.status.success() && !self.is_empty(handle)? {
            return Err(command_failure("systemctl kill", kill));
        }
        let stop = run_systemctl(&["stop", &handle.unit_name])?;
        if !stop.status.success() && !self.is_empty(handle)? {
            return Err(command_failure("systemctl stop", stop));
        }
        self.wait_for_child(handle)?;
        Ok(())
    }

    pub fn request_checkpoint(
        &mut self,
        handle: &TaskHandle,
        _request: &CheckpointRequest,
    ) -> Result<(), RunnerError> {
        let output = run_systemctl(&[
            "kill",
            "--kill-who=all",
            "--signal=SIGUSR1",
            &handle.unit_name,
        ])?;
        if !output.status.success() {
            return Err(command_failure("systemctl checkpoint", output));
        }
        Ok(())
    }

    pub fn is_empty(&self, handle: &TaskHandle) -> Result<bool, RunnerError> {
        let output = run_systemctl(&[
            "show",
            "--property=ActiveState",
            "--value",
            &handle.unit_name,
        ])?;
        if !output.status.success() {
            return Err(command_failure("systemctl show", output));
        }
        let state = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(matches!(
            state.as_str(),
            "inactive" | "failed" | "deactivating" | "not-found" | ""
        ))
    }

    pub fn cgroup_id(&self, handle: &TaskHandle) -> Result<Option<u64>, RunnerError> {
        let output = run_systemctl(&[
            "show",
            "--property=ControlGroup",
            "--value",
            &handle.unit_name,
        ])?;
        if !output.status.success() {
            return Err(command_failure("systemctl show ControlGroup", output));
        }
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if path.is_empty() {
            return Ok(None);
        }
        let metadata = fs::metadata(format!("/sys/fs/cgroup{path}"))?;
        Ok(Some(metadata.ino()))
    }

    fn wait_for_child(&mut self, handle: &TaskHandle) -> Result<(), RunnerError> {
        let Some(mut child) = self.runtimes.remove(&handle.unit_name) else {
            return Ok(());
        };
        child.wait()?;
        Ok(())
    }

    fn unit_name(&self, task_id: &str, lease_epoch: u64) -> Result<String, RunnerError> {
        let sanitized: String = task_id
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() || character == '-' {
                    character
                } else {
                    '-'
                }
            })
            .collect();
        if sanitized.is_empty() {
            return Err(RunnerError::InvalidTaskId(task_id.to_string()));
        }
        Ok(format!(
            "{}-{}-{}.scope",
            self.unit_prefix, sanitized, lease_epoch
        ))
    }
}

impl TaskRunner for SystemdScopeRunner {
    type Error = RunnerError;

    fn start(&mut self, spec: &TaskSpec) -> Result<TaskHandle, Self::Error> {
        self.start_task(spec)
    }

    fn request_checkpoint(
        &mut self,
        handle: &TaskHandle,
        request: &CheckpointRequest,
    ) -> Result<(), Self::Error> {
        self.request_checkpoint(handle, request)
    }

    fn hard_stop(&mut self, handle: &TaskHandle) -> Result<(), Self::Error> {
        self.hard_stop_task(handle)
    }

    fn is_empty(&self, handle: &TaskHandle) -> Result<bool, Self::Error> {
        Self::is_empty(self, handle)
    }
}

fn run_systemctl(args: &[&str]) -> Result<Output, RunnerError> {
    Ok(Command::new("systemctl").args(args).output()?)
}

fn command_failure(command: &str, output: Output) -> RunnerError {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    RunnerError::CommandFailed {
        command: command.to_string(),
        stderr,
    }
}
