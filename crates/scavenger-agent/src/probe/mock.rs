use std::collections::BTreeMap;
use std::sync::{Arc, RwLock};

use scavenger_core::{GpuDeviceId, GpuProbe, GpuSnapshot, ProbeError};

#[derive(Debug, Clone, Default)]
pub struct MockGpuProbe {
    snapshots: Arc<RwLock<BTreeMap<String, GpuSnapshot>>>,
}

impl MockGpuProbe {
    pub fn new(snapshots: impl IntoIterator<Item = GpuSnapshot>) -> Self {
        let values = snapshots
            .into_iter()
            .map(|snapshot| (snapshot.device.uuid.clone(), snapshot))
            .collect();
        Self {
            snapshots: Arc::new(RwLock::new(values)),
        }
    }

    pub fn set_snapshot(&self, snapshot: GpuSnapshot) -> Result<(), ProbeError> {
        let mut snapshots = self
            .snapshots
            .write()
            .map_err(|_| ProbeError::Transient("mock probe lock poisoned".to_string()))?;
        snapshots.insert(snapshot.device.uuid.clone(), snapshot);
        Ok(())
    }
}

impl GpuProbe for MockGpuProbe {
    fn inventory(&self) -> Result<Vec<GpuDeviceId>, ProbeError> {
        let snapshots = self
            .snapshots
            .read()
            .map_err(|_| ProbeError::Transient("mock probe lock poisoned".to_string()))?;
        Ok(snapshots
            .values()
            .map(|snapshot| snapshot.device.clone())
            .collect())
    }

    fn query_snapshot(&self, device: &GpuDeviceId) -> Result<GpuSnapshot, ProbeError> {
        let snapshots = self
            .snapshots
            .read()
            .map_err(|_| ProbeError::Transient("mock probe lock poisoned".to_string()))?;
        snapshots
            .get(&device.uuid)
            .cloned()
            .ok_or_else(|| ProbeError::NotSupported(format!("unknown mock GPU {}", device.uuid)))
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::MockGpuProbe;
    use scavenger_core::{
        apply_task_event, decide_preemption, CheckpointRequest, EvictionDecision, GpuDeviceId,
        GpuProbe, GpuProcessInfo, GpuProcessKind, GpuSnapshot, HostDemand, ProbeHealth,
        ProcessIdentity, TaskEvent, TaskHandle, TaskPolicy, TaskRunner, TaskSpec, TaskState,
    };

    fn snapshot(processes: Vec<scavenger_core::GpuProcessInfo>) -> GpuSnapshot {
        snapshot_with_memory(processes, 79_000)
    }

    fn snapshot_with_memory(
        processes: Vec<scavenger_core::GpuProcessInfo>,
        free_memory_bytes: u64,
    ) -> GpuSnapshot {
        GpuSnapshot {
            device: GpuDeviceId {
                uuid: "GPU-test".to_string(),
            },
            total_memory_bytes: 80_000,
            free_memory_bytes,
            utilization_gpu_percent: 0,
            processes,
            observed_at_monotonic_ms: 1,
            health: ProbeHealth::Healthy,
        }
    }

    #[test]
    fn mock_probe_drives_stateless_preemption_decision() -> Result<(), Box<dyn std::error::Error>> {
        let probe = MockGpuProbe::new([snapshot(Vec::new())]);
        let device = probe.inventory()?.remove(0);
        let empty = probe.query_snapshot(&device)?;
        assert_eq!(
            decide_preemption(&HostDemand::None, TaskPolicy::Stateless, 1),
            EvictionDecision::KeepRunning
        );

        let external = scavenger_core::GpuProcessInfo {
            identity: scavenger_core::ProcessIdentity {
                pid: 42,
                start_time_ticks: 100,
                uid: 0,
                cgroup_id: Some(99),
            },
            kind: scavenger_core::GpuProcessKind::Compute,
            used_memory_bytes: 1_024,
            gpu_instance_id: None,
            compute_instance_id: None,
        };
        let mut changed = empty;
        changed.processes.push(external);
        probe.set_snapshot(changed)?;
        let observed = probe.query_snapshot(&device)?;
        assert_eq!(observed.processes.len(), 1);
        assert_eq!(
            decide_preemption(
                &HostDemand::ObservedExternal {
                    confirmed_samples: 2,
                },
                TaskPolicy::Stateless,
                2,
            ),
            EvictionDecision::HardStop {
                reason: "confirmed external GPU use".to_string(),
            }
        );
        Ok(())
    }

    #[derive(Default)]
    struct SandboxRunner {
        stopped: BTreeSet<String>,
    }

    impl TaskRunner for SandboxRunner {
        type Error = String;

        fn start(&mut self, spec: &TaskSpec) -> Result<TaskHandle, Self::Error> {
            Ok(TaskHandle {
                task_id: spec.task_id.clone(),
                unit_name: format!("sandbox-{}", spec.task_id),
            })
        }

        fn request_checkpoint(
            &mut self,
            _handle: &TaskHandle,
            _request: &CheckpointRequest,
        ) -> Result<(), Self::Error> {
            Err("checkpoint unsupported in stateless sandbox".to_string())
        }

        fn hard_stop(&mut self, handle: &TaskHandle) -> Result<(), Self::Error> {
            self.stopped.insert(handle.unit_name.clone());
            Ok(())
        }

        fn is_empty(&self, handle: &TaskHandle) -> Result<bool, Self::Error> {
            Ok(self.stopped.contains(&handle.unit_name))
        }
    }

    #[test]
    fn mock_probe_claim_releases_owned_task_without_touching_external_process(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let device = GpuDeviceId {
            uuid: "GPU-test".to_string(),
        };
        let own_process = GpuProcessInfo {
            identity: ProcessIdentity {
                pid: 101,
                start_time_ticks: 10,
                uid: 1000,
                cgroup_id: Some(7),
            },
            kind: GpuProcessKind::Compute,
            used_memory_bytes: 1_024,
            gpu_instance_id: None,
            compute_instance_id: None,
        };
        let probe = MockGpuProbe::new([snapshot(vec![own_process])]);
        let mut runner = SandboxRunner::default();
        let spec = TaskSpec {
            task_id: "task-1".to_string(),
            lease_epoch: 1,
            device_uuid: device.uuid.clone(),
            program: "/bin/true".to_string(),
            args: Vec::new(),
            env: Default::default(),
            workdir: None,
            output_path: None,
            policy: TaskPolicy::Stateless,
        };
        let handle = runner.start(&spec).map_err(|error| error.to_string())?;
        assert!(matches!(
            decide_preemption(
                &HostDemand::ExplicitClaim {
                    reason: "owner".to_string(),
                    expires_at_ms: 2_000,
                },
                TaskPolicy::Stateless,
                1_000,
            ),
            EvictionDecision::HardStop { .. }
        ));
        let mut state = apply_task_event(TaskState::Queued, TaskEvent::LeaseGranted)?;
        state = apply_task_event(state, TaskEvent::Started)?;
        state = apply_task_event(state, TaskEvent::StopRequested)?;
        runner
            .hard_stop(&handle)
            .map_err(|error| error.to_string())?;
        let external = GpuProcessInfo {
            identity: ProcessIdentity {
                pid: 202,
                start_time_ticks: 20,
                uid: 1001,
                cgroup_id: Some(99),
            },
            kind: GpuProcessKind::Compute,
            used_memory_bytes: 2_048,
            gpu_instance_id: None,
            compute_instance_id: None,
        };
        probe.set_snapshot(snapshot_with_memory(vec![external], 77_000))?;
        let observed = probe.query_snapshot(&device)?;
        assert_eq!(observed.processes[0].identity.cgroup_id, Some(99));
        assert!(runner.is_empty(&handle)?);
        probe.set_snapshot(snapshot_with_memory(Vec::new(), 80_000))?;
        let released = apply_task_event(state, TaskEvent::ReleaseVerified)?;
        assert_eq!(released, TaskState::Requeued);
        assert!(probe.query_snapshot(&device)?.processes.is_empty());
        assert_eq!(runner.stopped.len(), 1);
        Ok(())
    }
}
