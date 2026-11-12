#!/usr/bin/env bash
set -euo pipefail

prefix=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
"$prefix/scripts/stop.sh"
case "$prefix" in
    /|/usr|/usr/local|/opt|/share|"$HOME"|"$HOME/.local")
        echo "refusing to remove broad prefix: $prefix" >&2
        exit 1
        ;;
esac
rm -rf -- "$prefix"
echo "removed $prefix"
