#!/usr/bin/env bash
set -euo pipefail

prefix=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
config="$prefix/etc/scavenger.env.local"
[[ -f "$config" ]] || config="$prefix/etc/scavenger.env"
# shellcheck disable=SC1090
source "$config"

mkdir -p "$prefix/run" "$prefix/logs"
agent_id=${SCAVENGER_AGENT_ID:-$(hostname)}
db_path=$prefix/$SCAVENGER_DB
claim_path=$prefix/$SCAVENGER_CLAIM
controller_pid_file="$prefix/run/controller.pid"
agent_pid_file="$prefix/run/agent.pid"

is_owned_process() {
    local pid=$1 expected=$2
    [[ -r "/proc/$pid/cmdline" ]] || return 1
    tr '\0' ' ' <"/proc/$pid/cmdline" | grep -F -- "$expected" >/dev/null
}

read_pid() {
    local pid_file=$1 pid
    [[ -f "$pid_file" ]] || return 1
    read -r pid <"$pid_file"
    [[ "$pid" =~ ^[0-9]+$ ]] || return 1
    printf '%s\n' "$pid"
}

if pid=$(read_pid "$controller_pid_file") && is_owned_process "$pid" "$prefix/bin/scavenger-controller"; then
    echo "controller already running pid=$pid"
else
    rm -f "$controller_pid_file"
    nohup "$prefix/bin/scavenger-controller" serve \
        --db "$db_path" \
        --listen "$SCAVENGER_CONTROLLER_LISTEN" \
        --web-listen "$SCAVENGER_WEB_LISTEN" \
        >"$prefix/logs/controller.log" 2>&1 </dev/null &
    printf '%s\n' "$!" >"$controller_pid_file"
fi

for _ in {1..20}; do
    if curl -fsS "http://$SCAVENGER_WEB_LISTEN/api/status" >/dev/null 2>&1; then
        break
    fi
    sleep 0.25
done
curl -fsS "http://$SCAVENGER_WEB_LISTEN/api/status" >/dev/null || {
    echo "controller did not become ready; see $prefix/logs/controller.log" >&2
    exit 1
}

if pid=$(read_pid "$agent_pid_file") && is_owned_process "$pid" "$prefix/bin/scavenger-agent"; then
    echo "agent already running pid=$pid"
else
    rm -f "$agent_pid_file"
    nohup "$prefix/bin/scavenger-agent" run \
        --controller "$SCAVENGER_CONTROLLER_URL" \
        --agent-id "$agent_id" \
        --claim-path "$claim_path" \
        --poll-ms "$SCAVENGER_POLL_MS" \
        >"$prefix/logs/agent.log" 2>&1 </dev/null &
    printf '%s\n' "$!" >"$agent_pid_file"
fi
echo "started prefix=$prefix agent_id=$agent_id"
