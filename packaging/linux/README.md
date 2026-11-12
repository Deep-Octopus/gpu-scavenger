# GPU Scavenger Linux bundle

This archive contains prebuilt Linux x86_64 binaries for the Controller and
Agent. It is a runtime package: installing it does not run Cargo, Rustup,
Docker, or a system package manager.

## Install on a GPU host

```bash
tar -xzf gpu-scavenger-linux-x86_64-0.1.0.tar.gz
cd gpu-scavenger-linux-x86_64-0.1.0
./install.sh --prefix /share/gpu-scavenger
cd /share/gpu-scavenger
./scripts/start.sh
./scripts/status.sh
```

The prefix is explicit because some hosts have a full root filesystem. The
installer creates only `bin/`, `etc/`, `run/`, `logs/`, and `scripts/` below
that prefix. It does not install a systemd unit or change services outside the
prefix.

Edit `etc/scavenger.env.local` before starting to change loopback ports or the
Agent identity. The default Web console is bound to `127.0.0.1:18081`; expose
it through an SSH tunnel rather than opening a new public listener.

```bash
./scripts/stop.sh
./scripts/uninstall.sh
```

`uninstall.sh` stops only processes whose command line matches this prefix
before removing the prefix. It refuses broad paths such as `/share`.

The `SHA256SUMS` file covers both runtime binaries. `BUILD.txt` should be kept
alongside a deployment record when the bundle is produced from a remote Linux
builder.
