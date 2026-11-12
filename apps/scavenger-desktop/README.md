# GPU Scavenger Desktop

The macOS desktop shell embeds the existing controller Web console in a native Tauri window. It starts a local Controller database under the macOS application data directory and binds the console to an ephemeral loopback port, so it does not compete with an existing service on port 18080.

From the repository root:

```bash
cargo tauri dev --manifest-path apps/scavenger-desktop/src-tauri/Cargo.toml
```

Build a macOS application bundle with:

```bash
cargo tauri build --manifest-path apps/scavenger-desktop/src-tauri/Cargo.toml --bundles app
```

The native shell is an operator console. GPU execution still requires a Linux/NVIDIA Agent; macOS reports itself as unschedulable by design.

To use the shell with a Controller running on a GPU server, forward the Controller's Web port to the Mac and pass the forwarded URL:

```bash
ssh -N -L 18081:127.0.0.1:18081 <user>@<gpu-server>
open -n "../../target/release/bundle/macos/GPU Scavenger.app" --args \
  --controller-url http://127.0.0.1:18081
```

In this mode the Mac window is only the client surface. The Controller and Agent remain on the server.
