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
