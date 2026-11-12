#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: build-bundle.sh [--binary-dir DIR] [--output FILE]

Package already-built Linux x86_64 binaries. This script never runs cargo.
EOF
}

root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
binary_dir="$root_dir/target/release"
output=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --binary-dir)
            [[ $# -ge 2 ]] || { echo "missing value for --binary-dir" >&2; exit 2; }
            binary_dir=$2
            shift 2
            ;;
        --output)
            [[ $# -ge 2 ]] || { echo "missing value for --output" >&2; exit 2; }
            output=$2
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

command -v tar >/dev/null || { echo "tar is required" >&2; exit 1; }
command -v sha256sum >/dev/null || { echo "sha256sum is required" >&2; exit 1; }
command -v file >/dev/null || { echo "file is required" >&2; exit 1; }
[[ -x "$binary_dir/scavenger-controller" ]] || {
    echo "missing executable: $binary_dir/scavenger-controller" >&2
    exit 1
}
[[ -x "$binary_dir/scavenger-agent" ]] || {
    echo "missing executable: $binary_dir/scavenger-agent" >&2
    exit 1
}
for binary in "$binary_dir/scavenger-controller" "$binary_dir/scavenger-agent"; do
    file "$binary" | grep -E 'ELF 64-bit.*x86-64' >/dev/null || {
        echo "not a Linux x86_64 ELF: $binary" >&2
        exit 1
    }
done

if [[ -z "$output" ]]; then
    output="$root_dir/dist/gpu-scavenger-linux-x86_64-0.1.0.tar.gz"
fi
mkdir -p "$(dirname "$output")"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
bundle_root="$stage/gpu-scavenger-linux-x86_64-0.1.0"
mkdir -p "$bundle_root/bin" "$bundle_root/etc" "$bundle_root/scripts"

cp "$binary_dir/scavenger-controller" "$bundle_root/bin/"
cp "$binary_dir/scavenger-agent" "$bundle_root/bin/"
cp "$root_dir/packaging/linux/install.sh" "$bundle_root/"
cp "$root_dir/packaging/linux/README.md" "$bundle_root/"
cp "$root_dir/packaging/linux/scavenger.env" "$bundle_root/etc/"
cp "$root_dir/packaging/linux/start.sh" "$bundle_root/scripts/"
cp "$root_dir/packaging/linux/stop.sh" "$bundle_root/scripts/"
cp "$root_dir/packaging/linux/status.sh" "$bundle_root/scripts/"
cp "$root_dir/packaging/linux/uninstall.sh" "$bundle_root/scripts/"
if [[ -f "$binary_dir/BUILD.txt" ]]; then
    cp "$binary_dir/BUILD.txt" "$bundle_root/"
fi
if command -v xattr >/dev/null; then
    xattr -rc "$stage"
fi
chmod 0755 "$bundle_root/install.sh" "$bundle_root/scripts/"*.sh \
    "$bundle_root/bin/"*
(cd "$bundle_root" && sha256sum bin/* > SHA256SUMS)

COPYFILE_DISABLE=1 tar --format=ustar -C "$stage" -czf "$output" "$(basename "$bundle_root")"
sha256sum "$output"
echo "created $output"
