#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: install.sh --prefix DIR

Install the prebuilt bundle into DIR. DIR must be an explicit path; no system
package manager, systemd unit, or global service is modified.
EOF
}

prefix=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --prefix)
            [[ $# -ge 2 ]] || { echo "missing value for --prefix" >&2; exit 2; }
            prefix=$2
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "unknown argument: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

[[ -n "$prefix" ]] || { echo "--prefix is required" >&2; exit 2; }
[[ "$(uname -s)" == "Linux" ]] || { echo "Linux is required" >&2; exit 1; }
[[ "$(uname -m)" == "x86_64" ]] || { echo "Linux x86_64 is required" >&2; exit 1; }
command -v sha256sum >/dev/null || { echo "sha256sum is required" >&2; exit 1; }
command -v nvidia-smi >/dev/null || {
    echo "nvidia-smi is required on the target host" >&2
    exit 1
}

bundle_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
(cd "$bundle_dir" && sha256sum --check SHA256SUMS)
mkdir -p "$prefix/bin" "$prefix/etc" "$prefix/scripts" "$prefix/run" "$prefix/logs"
cp "$bundle_dir/bin/scavenger-controller" "$prefix/bin/"
cp "$bundle_dir/bin/scavenger-agent" "$prefix/bin/"
cp "$bundle_dir/etc/scavenger.env" "$prefix/etc/"
cp "$bundle_dir/scripts/"*.sh "$prefix/scripts/"
chmod 0755 "$prefix/bin/"* "$prefix/scripts/"*.sh
if [[ ! -f "$prefix/etc/scavenger.env.local" ]]; then
    cp "$prefix/etc/scavenger.env" "$prefix/etc/scavenger.env.local"
fi
printf 'installed=%s\n' "$prefix"
printf 'configure=%s\n' "$prefix/etc/scavenger.env.local"
printf 'start=%s/scripts/start.sh\n' "$prefix"
