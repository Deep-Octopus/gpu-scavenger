# Contributing

Thanks for helping improve GPU Scavenger. The project values small, reviewable
changes that preserve explicit ownership and fail-closed behavior on shared GPU
hosts.

## Before opening a pull request

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
bash -n packaging/linux/*.sh
```

For packaging changes, build a bundle from Linux x86_64 binaries and verify the
archive can be extracted on Linux. For host-boundary changes, record the host,
GPU UUID, paths, ports, and owned process identities in an acceptance document.
Do not include private keys, enrollment tokens, or unrelated workloads in logs.

## Change shape

- Keep one independently reviewable feature or behavior change per commit.
- Keep I/O and system calls at the edges; keep state transitions testable as
  pure functions.
- Do not add speculative flags, queues, abstractions, or compatibility layers.
- Never identify or stop another user's work by PID, GPU index, or memory usage.
- Use the designated design skill for user-facing UI changes.

## Pull requests

Describe the user-visible behavior, the safety boundary it relies on, and the
checks you ran. Separate local tests from real-host evidence. If a check could
not run, state why and identify the remaining risk.
