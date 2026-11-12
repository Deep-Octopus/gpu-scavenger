use crate::types::{EvictionDecision, HostDemand, TaskPolicy};

pub fn decide_preemption(demand: &HostDemand, policy: TaskPolicy, now_ms: u64) -> EvictionDecision {
    match demand {
        HostDemand::None => EvictionDecision::KeepRunning,
        HostDemand::Unknown { reason } => EvictionDecision::Quarantine {
            reason: reason.clone(),
        },
        HostDemand::ObservedExternal { confirmed_samples } if *confirmed_samples < 2 => {
            EvictionDecision::StopAcceptingNewWork
        }
        HostDemand::ObservedExternal { .. } => EvictionDecision::HardStop {
            reason: "confirmed external GPU use".to_string(),
        },
        HostDemand::ExplicitClaim { expires_at_ms, .. }
        | HostDemand::GuardActive {
            expires_at_ms: Some(expires_at_ms),
            ..
        } if *expires_at_ms <= now_ms => EvictionDecision::KeepRunning,
        HostDemand::ExplicitClaim { .. } | HostDemand::GuardActive { .. } => match policy {
            TaskPolicy::Stateless => EvictionDecision::HardStop {
                reason: "host claim".to_string(),
            },
            TaskPolicy::Checkpointed {
                checkpoint_deadline_ms,
            } => EvictionDecision::RequestCheckpoint {
                deadline_ms: now_ms.saturating_add(checkpoint_deadline_ms),
            },
        },
    }
}

pub fn calculate_reserve(
    total_memory_bytes: u64,
    minimum_bytes: u64,
    ratio_basis_points: u64,
    host_startup_p99_bytes: u64,
    safety_margin_bytes: u64,
) -> u64 {
    let ratio_reserve = total_memory_bytes.saturating_mul(ratio_basis_points) / 10_000;
    let observed_reserve = host_startup_p99_bytes.saturating_add(safety_margin_bytes);
    minimum_bytes.max(ratio_reserve).max(observed_reserve)
}

#[cfg(test)]
mod tests {
    use super::{calculate_reserve, decide_preemption};
    use crate::{EvictionDecision, HostDemand, TaskPolicy};

    #[test]
    fn preemption_table_covers_signal_priority() {
        let cases = [
            (HostDemand::None, EvictionDecision::KeepRunning),
            (
                HostDemand::ObservedExternal {
                    confirmed_samples: 1,
                },
                EvictionDecision::StopAcceptingNewWork,
            ),
            (
                HostDemand::ObservedExternal {
                    confirmed_samples: 2,
                },
                EvictionDecision::HardStop {
                    reason: "confirmed external GPU use".to_string(),
                },
            ),
            (
                HostDemand::ExplicitClaim {
                    reason: "owner".to_string(),
                    expires_at_ms: 1_000,
                },
                EvictionDecision::HardStop {
                    reason: "host claim".to_string(),
                },
            ),
        ];

        for (demand, expected) in cases {
            assert_eq!(
                decide_preemption(&demand, TaskPolicy::Stateless, 10),
                expected
            );
        }
    }

    #[test]
    fn expired_claim_does_not_preempt() {
        let demand = HostDemand::ExplicitClaim {
            reason: "owner".to_string(),
            expires_at_ms: 10,
        };
        assert_eq!(
            decide_preemption(&demand, TaskPolicy::Stateless, 10),
            EvictionDecision::KeepRunning
        );
    }

    #[test]
    fn reserve_uses_largest_safety_input() {
        assert_eq!(
            calculate_reserve(80_000, 1_536, 1_000, 12_000, 2_000),
            14_000
        );
    }
}
