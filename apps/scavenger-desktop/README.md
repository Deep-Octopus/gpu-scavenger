# GPU Scavenger Desktop

The desktop shell embeds the existing Controller Web console in a native Tauri
window. macOS and Windows are operator surfaces; GPU execution remains on a
Linux/NVIDIA Agent.

From the repository root:

```bash
cargo tauri dev --manifest-path apps/scavenger-desktop/src-tauri/Cargo.toml
```

Build a macOS application bundle with:

```bash
cargo tauri build --manifest-path apps/scavenger-desktop/src-tauri/Cargo.toml --bundles app
```

The native shell is an operator console. GPU execution still requires a Linux/NVIDIA Agent; macOS reports itself as unschedulable by design.

The Windows x64 MSI and NSIS installers are built by
`.github/workflows/windows-release.yml` on a Windows runner and published to
the GitHub Release. Windows also reports itself as unschedulable by design.

To use the shell with a Controller running on a GPU server, forward the Controller's Web port to the Mac and pass the forwarded URL:

```bash
ssh -N -L 18081:127.0.0.1:18081 <user>@<gpu-server>
open -n "../../target/release/bundle/macos/GPU Scavenger.app" --args \
  --controller-url http://127.0.0.1:18081
```

In this mode the Mac window is only the client surface. The Controller and Agent remain on the server.
