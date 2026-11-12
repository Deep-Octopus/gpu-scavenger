#!/usr/bin/env bash
set -euo pipefail

prefix=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
config="$prefix/etc/scavenger.env.local"
[[ -f "$config" ]] || config="$prefix/etc/scavenger.env"
# shellcheck disable=SC1090
source "$config"

show_process() {
    local name=$1 pid_file=$2 expected=$3 pid
    if [[ -f "$pid_file" ]] && read -r pid <"$pid_file" && [[ -r "/proc/$pid/cmdline" ]] \
        && tr '\0' ' ' <"/proc/$pid/cmdline" | grep -F -- "$expected" >/dev/null; then
        echo "$name=running pid=$pid"
    else
        echo "$name=stopped"
    fi
}

show_process controller "$prefix/run/controller.pid" "$prefix/bin/scavenger-controller"
show_process agent "$prefix/run/agent.pid" "$prefix/bin/scavenger-agent"
if curl -fsS "http://$SCAVENGER_WEB_LISTEN/api/status"; then
    printf '\n'
else
    echo "controller_status=unavailable" >&2
    exit 1
fi
