# GPU Scavenger

GPU Scavenger is a host-first GPU task controller and Agent for the verified Linux/NVIDIA boundary. The Agent only manages scopes that it created, and a host Claim stops new work and drives ReleaseVerifier before the GPU is reported free.

## Local checks

```text
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

The workspace builds on macOS for development and protocol/UI work. Running the GPU Agent requires Linux, NVIDIA NVML, cgroup v2 and systemd scopes; an unsupported host reports `schedulable=false` and does not receive tasks.

## Run the macOS desktop app

The native shell starts a local Controller database under the macOS application data directory, chooses an available loopback port for the embedded console, and reuses the same operator UI. Port `18080` is not required.

```bash
cd apps/scavenger-desktop
npx --yes @tauri-apps/cli@2.12.4 dev
```

To build the application bundle:

```bash
npx --yes @tauri-apps/cli@2.12.4 build --bundles app
open ../../target/release/bundle/macos/GPU\ Scavenger.app
```

The desktop shell is the operator surface; GPU workloads still run on enrolled Linux/NVIDIA Agents.

To point the desktop shell at a Controller running on the GPU server, use an SSH tunnel and pass the forwarded Web URL:

```bash
ssh -N -L 18081:127.0.0.1:18081 <user>@<gpu-server>
open -n "target/release/bundle/macos/GPU Scavenger.app" --args \
  --controller-url http://127.0.0.1:18081
```

The Controller and Agent stay on the server; the Mac only renders the operator surface.

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

## Distribute the Linux runtime

The Linux delivery artifact is a prebuilt runtime bundle. Build it from an
already compiled Linux x86_64 `target/release` directory; the packaging step
does not invoke Cargo:

```bash
packaging/linux/build-bundle.sh \
  --binary-dir /path/to/linux-target/release \
  --output dist/gpu-scavenger-linux-x86_64-0.1.0.tar.gz
```

On a GPU host, unpack and install it into an explicit prefix. `/share` is a
valid choice when the root filesystem is constrained:

```bash
tar -xzf gpu-scavenger-linux-x86_64-0.1.0.tar.gz
cd gpu-scavenger-linux-x86_64-0.1.0
./install.sh --prefix /share/gpu-scavenger
cd /share/gpu-scavenger
./scripts/start.sh
./scripts/status.sh
```

The bundle contains the Controller and Agent binaries, a local configuration
template, SHA256 verification, and lifecycle scripts. It does not install a
systemd unit, change global services, or require a Rust toolchain on the target
host. See [`packaging/linux/README.md`](packaging/linux/README.md) for the
uninstall and SSH tunnel commands.
