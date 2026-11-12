use crate::types::ProcessIdentity;

pub fn same_process(left: &ProcessIdentity, right: &ProcessIdentity) -> bool {
    left.pid == right.pid
        && left.start_time_ticks == right.start_time_ticks
        && left.uid == right.uid
        && left.cgroup_id == right.cgroup_id
}

#[cfg(test)]
mod tests {
    use super::same_process;
    use crate::ProcessIdentity;

    fn identity(start_time_ticks: u64) -> ProcessIdentity {
        ProcessIdentity {
            pid: 42,
            start_time_ticks,
            uid: 0,
            cgroup_id: Some(7),
        }
    }

    #[test]
    fn process_reuse_does_not_match() {
        assert!(!same_process(&identity(10), &identity(11)));
    }

    #[test]
    fn exact_identity_matches() {
        assert!(same_process(&identity(10), &identity(10)));
    }
}
