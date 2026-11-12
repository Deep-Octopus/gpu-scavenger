#!/usr/bin/env bash
set -euo pipefail

prefix=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

stop_owned() {
    local name=$1 pid_file=$2 expected=$3 pid
    [[ -f "$pid_file" ]] || { echo "$name not running"; return 0; }
    read -r pid <"$pid_file"
    if [[ ! "$pid" =~ ^[0-9]+$ ]] || [[ ! -r "/proc/$pid/cmdline" ]]; then
        rm -f "$pid_file"
        echo "$name stale pid file removed"
        return 0
    fi
    if ! tr '\0' ' ' <"/proc/$pid/cmdline" | grep -F -- "$expected" >/dev/null; then
        echo "$name pid file does not identify the installed binary; refusing to stop" >&2
        return 1
    fi
    kill -TERM "$pid"
    for _ in {1..20}; do
        [[ -r "/proc/$pid/cmdline" ]] || break
        sleep 0.25
    done
    if [[ -r "/proc/$pid/cmdline" ]]; then
        echo "$name did not exit after SIGTERM" >&2
        return 1
    fi
    rm -f "$pid_file"
    echo "stopped $name pid=$pid"
}

stop_owned agent "$prefix/run/agent.pid" "$prefix/bin/scavenger-agent"
stop_owned controller "$prefix/run/controller.pid" "$prefix/bin/scavenger-controller"
