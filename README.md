# GPU Scavenger

GPU Scavenger is a host-first GPU task controller and Agent for the verified Linux/NVIDIA boundary. The Agent only manages scopes that it created, and a host Claim stops new work and drives ReleaseVerifier before the GPU is reported free.

## Local checks

```text
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

The workspace builds on macOS for development and protocol/UI work. Running the GPU Agent requires Linux, NVIDIA NVML, cgroup v2 and systemd scopes; an unsupported host reports `schedulable=false` and does not receive tasks.

## Run the controller

```bash
cargo run -p scavenger-controller -- serve \
  --db /tmp/gpu-scavenger/controller.sqlite3 \
  --listen 127.0.0.1:50051 \
  --web-listen 127.0.0.1:18080
```

Open `http://127.0.0.1:18080` for the operator console. For a shared network, configure TLS/mTLS and an enrollment token file before exposing the control port.

The TLS Controller reloads its certificate and key on Unix after `SIGHUP`. Replace both files atomically, then run `kill -HUP <controller-pid>`; new Agent sessions use the new certificate while existing long-lived streams drain and reconnect normally.

## Run an Agent on a verified node

```bash
cargo run -p scavenger-agent -- run \
  --controller http://127.0.0.1:50051 \
  --claim-path /tmp/gpu-scavenger/claim
```

Use `scavenger-agent claim` and `scavenger-agent unclaim` for an explicit host demand. Task policy `stateless` is the default; `checkpointed` requires a task that implements the `GPU_SCAVENGER_CHECKPOINT_PATH` and SIGUSR1 protocol described in [`gpu_scavenger.md`](gpu_scavenger.md).

The design, support matrix and remote acceptance records are in [`gpu_scavenger.md`](gpu_scavenger.md) and [`docs/`](docs/).
