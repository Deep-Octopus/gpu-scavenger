#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReleaseObservation {
    pub cgroup_empty: bool,
    pub owned_process_count: u32,
    pub free_memory_bytes: u64,
    pub baseline_free_memory_bytes: u64,
}

pub fn release_sample_ready(observation: &ReleaseObservation, memory_tolerance_bytes: u64) -> bool {
    observation.cgroup_empty
        && observation.owned_process_count == 0
        && observation
            .free_memory_bytes
            .saturating_add(memory_tolerance_bytes)
            >= observation.baseline_free_memory_bytes
}

pub fn next_release_sample_count(
    current_count: u32,
    observation: &ReleaseObservation,
    memory_tolerance_bytes: u64,
) -> u32 {
    if release_sample_ready(observation, memory_tolerance_bytes) {
        current_count.saturating_add(1)
    } else {
        0
    }
}

pub fn release_verified(sample_count: u32, required_samples: u32) -> bool {
    required_samples > 0 && sample_count >= required_samples
}

#[cfg(test)]
mod tests {
    use super::{
        next_release_sample_count, release_sample_ready, release_verified, ReleaseObservation,
    };

    fn observation(
        cgroup_empty: bool,
        owned_process_count: u32,
        free_memory_bytes: u64,
    ) -> ReleaseObservation {
        ReleaseObservation {
            cgroup_empty,
            owned_process_count,
            free_memory_bytes,
            baseline_free_memory_bytes: 1_000,
        }
    }

    #[test]
    fn release_requires_scope_process_and_memory_conditions() {
        assert!(!release_sample_ready(&observation(false, 0, 1_000), 0));
        assert!(!release_sample_ready(&observation(true, 1, 1_000), 0));
        assert!(!release_sample_ready(&observation(true, 0, 900), 50));
        assert!(release_sample_ready(&observation(true, 0, 950), 50));
    }

    #[test]
    fn failed_sample_resets_consecutive_release_count() {
        let good = observation(true, 0, 1_000);
        let bad = observation(true, 1, 1_000);
        assert_eq!(next_release_sample_count(0, &good, 0), 1);
        assert_eq!(next_release_sample_count(1, &good, 0), 2);
        assert_eq!(next_release_sample_count(2, &bad, 0), 0);
        assert!(release_verified(2, 2));
        assert!(!release_verified(1, 2));
        assert!(!release_verified(1, 0));
    }
}
