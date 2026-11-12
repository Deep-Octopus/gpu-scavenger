# Releasing GPU Scavenger

This repository publishes runtime artifacts rather than committing compiled
binaries to Git.

## Linux runtime

Build the Controller and Agent on a Linux x86_64 builder, then package the
already-built files on a machine with the repository checkout:

```bash
packaging/linux/build-bundle.sh \
  --binary-dir /path/to/linux-target/release \
  --output dist/gpu-scavenger-linux-x86_64-0.1.0.tar.gz
```

The script checks for Linux x86_64 ELF files, writes `SHA256SUMS`, strips
platform archive metadata, and creates a reproducible tarball. Attach the
tarball and its SHA256 to the GitHub release.

## macOS desktop

Build the Tauri app on the target architecture:

```bash
npx --yes @tauri-apps/cli@2.12.4 build --bundles app
ditto -c -k --sequesterRsrc --keepParent \
  "target/release/bundle/macos/GPU Scavenger.app" \
  "dist/GPU-Scavenger-macos-arm64.app.zip"
```

Only publish an app archive after launching it once and verifying both local
and `--controller-url` remote modes.

## Release checklist

1. Update `Cargo.toml` and the changelog version.
2. Run format, Clippy, and workspace tests.
3. Build and hash the Linux bundle.
4. Verify install/start/status/stop on a clean Linux/NVIDIA host.
5. Launch the macOS app and verify the remote console through an SSH tunnel.
6. Create a Git tag such as `v0.1.0` and upload only intended artifacts.
7. Record real-host evidence under `docs/`.
