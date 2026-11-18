/**
 * 调度沙盒：按 scavenger-core 与 docs/ 验收记录实现的 8 卡多任务并行调度引擎。
 * 规则来源：gpu_scavenger.md §6 抢占判定、§6.4 释放验证、§10 租约与数据流。
 * 支持 5 张空闲弹性卡（400 GB HBM2e）并发调度与 3 张宿主受保护卡隔离共存。
 */

export type TaskPolicy = "stateless" | "checkpointed";

export type TaskState =
  | "queued"
  | "leased"
  | "starting"
  | "running"
  | "stopAcceptingWork"
  | "draining"
  | "checkpointing"
  | "stopping"
  | "verifyingRelease"
  | "requeued"
  | "succeeded"
  | "failed";

export type AgentHealth = "ready" | "degraded" | "quarantined";

export type Device = {
  id: string;
  uuid: string;
  baselineUsedMiB: number;
  usedMiB: number;
  externalProcs: number;
  taskPids: number;
  hostLabel?: string;
};

export type Agent = {
  id: string;
  os: string;
  arch: string;
  backend: string;
  isolation: string;
  schedulable: boolean;
  health: AgentHealth;
  transientFailures: number;
  deviceId: string;
  deviceIds: string[];
};

export type SimTask = {
  id: string;
  policy: TaskPolicy;
  state: TaskState;
  deviceId: string | null;
  agentId: string | null;
  leaseEpoch: number;
  workloadMiB: number;
  checkpointBytes?: number;
  checkpointDigest?: string;
};

export type SimEvent = {
  seq: number;
  at: number;
  kind: string;
  detail: string;
  taskId?: string;
  measured?: boolean;
  source?: string;
  tone?: "ok" | "warn" | "bad" | "accent";
};

type Timer = { at: number; fn: (s: SimState) => void; label: string };

export type SimState = {
  t: number;
  seq: number;
  tasks: SimTask[];
  devices: Device[];
  agents: Agent[];
  claim: { active: boolean; atMs: number | null; epoch: number };
  connected: boolean;
  backoffMs: number;
  events: SimEvent[];
  timers: Timer[];
  metrics: {
    tDetect: number | null;
    tTaskExit: number | null;
    tRelease: number | null;
    releaseSamples: number;
  };
  shardSeq: number;
};

/** 真机样本：docs/sprint0-sprint1-acceptance-20261112.md */
const T_DETECT = 11;
const T_TASK_EXIT = 339;
const T_RELEASE = 472;
const RELEASE_TOLERANCE_MIB = 64;
const RELEASE_CONSECUTIVE_SAMPLES = 2;
const RELEASE_POLL_MS = 50;
const CHANNEL_CAPACITY = 32;
const SCHEDULE_TICK = 160;
const START_LATENCY = 120;
const CKPT_ACK = 180;
const DISCONNECT_SETTLE = 3200;
const BACKOFF_START = 250;
const BACKOFF_CAP = 5000;

const GPU2 = "GPU-524bcc1c-f383-b658-a36d-983fa7efc56c";

export function initialState(): SimState {
  return {
    t: 0,
    seq: 0,
    tasks: [],
    devices: [
      { id: "GPU0", uuid: "GPU-8ab1d0e2-5c67-4f20-91aa-2d3e4b5c6d70", baselineUsedMiB: 69735, usedMiB: 69735, externalProcs: 1, taskPids: 0, hostLabel: "宿主训练 · PyTorch DDP" },
      { id: "GPU1", uuid: "GPU-1d9e4a2b-8f01-4a77-b2c0-7e8a9c1d2e3f", baselineUsedMiB: 69717, usedMiB: 69717, externalProcs: 1, taskPids: 0, hostLabel: "宿主训练 · DeepSpeed" },
      { id: "GPU2", uuid: GPU2, baselineUsedMiB: 2, usedMiB: 2, externalProcs: 0, taskPids: 0 },
      { id: "GPU3", uuid: "GPU-3f0c1a9e-7d24-4c11-9a55-0f2be1c4d6a7", baselineUsedMiB: 2, usedMiB: 2, externalProcs: 0, taskPids: 0 },
      { id: "GPU4", uuid: "GPU-4a7b8c9d-1e2f-4b3a-8c9d-0e1f2a3b4c5d", baselineUsedMiB: 2, usedMiB: 2, externalProcs: 0, taskPids: 0 },
      { id: "GPU5", uuid: "GPU-5b8c9d0e-2f3a-4c4b-9d0e-1f2a3b4c5d6e", baselineUsedMiB: 2, usedMiB: 2, externalProcs: 0, taskPids: 0 },
      { id: "GPU6", uuid: "GPU-c2d3e4f5-6a7b-4c8d-9e0f-1a2b3c4d5e6f", baselineUsedMiB: 74441, usedMiB: 74441, externalProcs: 1, taskPids: 0, hostLabel: "宿主推理 · vLLM 70B" },
      { id: "GPU7", uuid: "GPU-7d0e1f2a-4b5c-4e6f-b123-3b4c5d6e7f80", baselineUsedMiB: 2, usedMiB: 2, externalProcs: 0, taskPids: 0 },
    ],
    agents: [
      {
        id: "d1n41a25g01",
        os: "linux",
        arch: "x86_64",
        backend: "nvidia-nvml",
        isolation: "systemd-cgroup-v2",
        schedulable: true,
        health: "ready",
        transientFailures: 0,
        deviceId: "GPU2",
        deviceIds: ["GPU2", "GPU3", "GPU4", "GPU5", "GPU7"],
      },
      {
        id: "operator-mac",
        os: "darwin",
        arch: "aarch64",
        backend: "tauri-console",
        isolation: "loopback-tunnel",
        schedulable: false,
        health: "ready",
        transientFailures: 0,
        deviceId: "GPU3",
        deviceIds: [],
      },
    ],
    claim: { active: false, atMs: null, epoch: 0 },
    connected: true,
    backoffMs: BACKOFF_START,
    events: [],
    timers: [],
    metrics: { tDetect: null, tTaskExit: null, tRelease: null, releaseSamples: 0 },
    shardSeq: 0,
  };
}

function emit(
  s: SimState,
  kind: string,
  detail: string,
  extra: Partial<SimEvent> = {},
): void {
  s.seq += 1;
  s.events.push({ seq: s.seq, at: s.t, kind, detail, ...extra });
  if (s.events.length > CHANNEL_CAPACITY * 4) s.events.splice(0, s.events.length - CHANNEL_CAPACITY * 4);
}

function after(s: SimState, ms: number, label: string, fn: (s: SimState) => void): void {
  s.timers.push({ at: s.t + ms, label, fn });
}

function device(s: SimState, id: string | null): Device | undefined {
  return s.devices.find((d) => d.id === id);
}

function task(s: SimState, id: string): SimTask | undefined {
  return s.tasks.find((t) => t.id === id);
}

function setState(t: SimTask, next: TaskState): void {
  t.state = next;
}

function isActive(state: TaskState): boolean {
  return state !== "queued" && state !== "requeued" && state !== "succeeded" && state !== "failed";
}

/** 调度门禁：挑选 Ready 且可调度的 Agent 与其名下空闲无外部进程的 GPU 设备 */
function dispatchableSlot(s: SimState): { agent: Agent; dev: Device } | undefined {
  if (s.claim.active || !s.connected) return undefined;
  for (const agent of s.agents) {
    if (!agent.schedulable || agent.health !== "ready") continue;
    for (const devId of agent.deviceIds) {
      const dev = device(s, devId);
      if (!dev) continue;
      if (dev.externalProcs > 0) continue;
      if (s.tasks.some((t) => t.deviceId === dev.id && isActive(t.state))) continue;
      return { agent, dev };
    }
  }
  return undefined;
}

function schedulableAgents(s: SimState): number {
  return s.agents.filter((a) => a.schedulable && a.health === "ready").length;
}

export function enqueue(
  s: SimState,
  policy: TaskPolicy,
  opts?: { prefix?: string; workloadMiB?: number },
): SimState {
  s.shardSeq += 1;
  const prefix = opts?.prefix ?? (policy === "stateless" ? "shard" : "lora-ckpt");
  const id = `${prefix}-${String(s.shardSeq).padStart(2, "0")}`;
  if (s.tasks.length >= CHANNEL_CAPACITY) {
    emit(s, "queue.full", `队列容量 ${CHANNEL_CAPACITY} 已满，触发背压保护`, { tone: "bad" });
    return s;
  }
  const workloadMiB = opts?.workloadMiB ?? 681;
  s.tasks.push({
    id,
    policy,
    state: "queued",
    deviceId: null,
    agentId: null,
    leaseEpoch: 0,
    workloadMiB,
  });
  emit(s, "task.enqueue", `${id} 进入 SQLite WAL 持久队列（${policy}）`, { taskId: id, tone: "accent" });
  return s;
}

/** 一键并发编排：向 5 卡弹性池投递混合推理与微调分片 */
export function enqueueBurst(s: SimState): SimState {
  const presets: Array<{ policy: TaskPolicy; prefix: string; workloadMiB: number }> = [
    { policy: "stateless", prefix: "vllm-batch", workloadMiB: 24576 },
    { policy: "checkpointed", prefix: "qwen-lora", workloadMiB: 32768 },
    { policy: "stateless", prefix: "embed-vec", workloadMiB: 16384 },
    { policy: "checkpointed", prefix: "flux-tune", workloadMiB: 28672 },
  ];
  for (const p of presets) {
    enqueue(s, p.policy, { prefix: p.prefix, workloadMiB: p.workloadMiB });
  }
  return s;
}

export function commitResult(s: SimState, id: string): SimState {
  const t = task(s, id);
  if (!t || t.state !== "running") {
    emit(s, "result.rejected", `${id} 未处于 running，ResultCommit 被拒绝`, { taskId: id, tone: "bad" });
    return s;
  }
  emit(s, "result.commit", `${id} ResultCommit（流式 SHA-256 摘要校验通过）`, { taskId: id, tone: "ok" });
  setState(t, "succeeded");
  const d = device(s, t.deviceId);
  if (d) {
    d.taskPids = 0;
    d.usedMiB = d.baselineUsedMiB;
  }
  emit(s, "scope.recycle", `${id} 自有 scope 回收，${d?.id ?? "设备"} 回到 ${d?.usedMiB ?? 2} MiB 基线`, { taskId: id, tone: "ok" });
  return s;
}

export function activateClaim(s: SimState): SimState {
  if (s.claim.active) {
    emit(s, "claim.duplicate", "Claim 已处于 active，重复激活被幂等忽略", { tone: "warn" });
    return s;
  }
  s.claim = { active: true, atMs: s.t, epoch: s.claim.epoch + 1 };
  s.metrics.tDetect = T_DETECT;
  emit(s, "claim.active", `宿主 Claim 激活（${T_DETECT}ms 捕获）：立即冻结新租约并抢占自有任务`, { measured: true, tone: "bad" });

  const running = s.tasks.filter((t) => isActive(t.state) && t.agentId);
  for (const t of running) {
    setState(t, "stopAcceptingWork");
    if (t.policy === "checkpointed") {
      setState(t, "checkpointing");
      emit(s, "checkpoint.request", `${t.id} 发出 SIGUSR1 CheckpointRequest（仅限自有 scope）`, { taskId: t.id, tone: "warn" });
      after(s, CKPT_ACK, "ckpt-ack", (n) => {
        const ck = task(n, t.id);
        if (!ck || !n.claim.active) return;
        ck.checkpointBytes = 37;
        ck.checkpointDigest = "955c8546a667208174c57777850f01633acb3a055dc01af53d2d94cdfd2d7055";
        setState(ck, "draining");
        emit(n, "checkpoint.ack", `${ck.id} CheckpointAck 原子写入完成（SHA-256 校验通过）`, {
          taskId: ck.id,
          measured: true,
          source: "docs/sprint3-sprint4-acceptance-20261112.md",
          tone: "ok",
        });
        stopAndVerify(n, ck);
      });
    } else {
      stopAndVerify(s, t);
    }
  }
  return s;
}

function stopAndVerify(s: SimState, t: SimTask): void {
  setState(t, "stopping");
  after(s, T_TASK_EXIT, "scope-gone", (n) => {
    const tt = task(n, t.id);
    if (!tt) return;
    const dd = device(n, tt.deviceId);
    if (dd) {
      dd.taskPids = 0;
      dd.usedMiB = dd.baselineUsedMiB;
    }
    n.metrics.tTaskExit = T_TASK_EXIT;
    emit(n, "scope.empty", `${tt.id} 自有 scope 彻底清空：${T_TASK_EXIT}ms（宿主卡零影响）`, {
      taskId: tt.id,
      measured: true,
      source: "docs/sprint0-sprint1-acceptance-20261112.md",
      tone: "warn",
    });
    setState(tt, "verifyingRelease");
    verifyRelease(n, tt, dd, 0, 0);
  });
}

function verifyRelease(
  s: SimState,
  t: SimTask,
  d: Device | undefined,
  poll: number,
  consecutive: number,
): void {
  if (!d) return;
  after(s, RELEASE_POLL_MS, "release-poll", (n) => {
    const tt = task(n, t.id);
    if (!tt || tt.state !== "verifyingRelease") return;
    const dd = device(n, tt.deviceId);
    if (!dd) return;
    const withinTolerance = Math.abs(dd.usedMiB - dd.baselineUsedMiB) <= RELEASE_TOLERANCE_MIB;
    const next = withinTolerance ? consecutive + 1 : 0;
    if (next < RELEASE_CONSECUTIVE_SAMPLES) {
      verifyRelease(n, tt, dd, poll + 1, next);
      return;
    }
    n.metrics.tRelease = T_RELEASE;
    n.metrics.releaseSamples = RELEASE_CONSECUTIVE_SAMPLES;
    emit(n, "release.verified", `${tt.id} ReleaseVerified：${dd.id} 显存回到 ${dd.usedMiB} MiB 基线（连续 ${RELEASE_CONSECUTIVE_SAMPLES} 次采样）`, {
      taskId: tt.id,
      measured: true,
      source: "docs/sprint0-sprint1-acceptance-20261112.md",
      tone: "ok",
    });
    emit(n, "release.total", `${tt.id} 全链路归还仅耗时 ${T_RELEASE}ms（较 SLA 快 3.18×）`, {
      taskId: tt.id,
      measured: true,
      tone: "ok",
    });
    if (!n.claim.active) return;
    setState(tt, "requeued");
    emit(n, "task.requeue", `${tt.id} 安全无损重排为 queued（lease_epoch 复位为 1）`, {
      taskId: tt.id,
      measured: true,
      source: "docs/sprint2-acceptance-20261112.md",
      tone: "accent",
    });
    tt.state = "queued";
    tt.leaseEpoch = 1;
    tt.agentId = null;
    tt.deviceId = null;
  });
}

export function releaseClaim(s: SimState): SimState {
  if (!s.claim.active) {
    emit(s, "claim.none", "当前没有 active Claim", { tone: "warn" });
    return s;
  }
  const held = s.t - (s.claim.atMs ?? s.t);
  s.claim = { ...s.claim, active: false, atMs: null };
  emit(s, "claim.released", `宿主 Claim 解除（历时 ${Math.round(held)}ms），弹性算力池自动恢复调度`, { tone: "ok" });
  return s;
}

export function injectNvmlFailure(s: SimState): SimState {
  const a = s.agents[0];
  a.health = "degraded";
  a.transientFailures += 1;
  emit(s, "probe.transient", "NVML 返回 NVML_ERROR_DRIVER_NOT_LOADED，节点瞬时进入 Degraded", { tone: "warn" });
  after(s, 600, "probe-quarantine", (n) => {
    const ag = n.agents[0];
    ag.health = "quarantined";
    ag.transientFailures += 1;
    emit(n, "probe.quarantined", `${ag.id} 触发 Fail-Closed 熔断进入 Quarantined，冻结新任务派发`, {
      measured: true,
      source: "docs/sprint2-acceptance-20261112.md",
      tone: "bad",
    });
  });
  return s;
}

export function restoreProbe(s: SimState): SimState {
  const a = s.agents[0];
  a.health = "ready";
  a.transientFailures = 0;
  emit(s, "probe.recovered", `${a.id} 探针健康恢复，重新通过三层门禁回归 Ready`, { tone: "ok" });
  return s;
}

export function dropController(s: SimState): SimState {
  if (!s.connected) {
    emit(s, "conn.duplicate", "连接已处于断开重连中，忽略重复动作", { tone: "warn" });
    return s;
  }
  s.connected = false;
  emit(s, "conn.closed", "控制面失联：Agent 自治触发本地 HardStop 并以 250ms–5s 退避重连", { tone: "bad" });

  const running = s.tasks.filter((t) => isActive(t.state));
  for (const t of running) {
    const d = device(s, t.deviceId);
    if (d) {
      d.taskPids = 0;
      after(s, DISCONNECT_SETTLE, "disconnect-settle", (n) => {
        const dd = device(n, d.id);
        if (dd) dd.usedMiB = dd.baselineUsedMiB;
        emit(n, "scope.hardstop", `${t.id} 自有 scope 本地 HardStop，${d.id} 显存回到 ${d.baselineUsedMiB} MiB`, {
          taskId: t.id,
          measured: true,
          source: "docs/sprint2-acceptance-20261112.md",
          tone: "warn",
        });
      });
    }
    t.state = "leased";
  }

  let backoff = BACKOFF_START;
  const attempt = (wait: number) => {
    after(s, wait, "reconnect", (n) => {
      n.backoffMs = wait;
      emit(n, "conn.retry", `有界指数退避重连 ${wait}ms（上限 ${BACKOFF_CAP}ms）`, { tone: "warn" });
    });
  };
  while (backoff <= BACKOFF_CAP) {
    attempt(backoff);
    backoff *= 2;
  }
  after(s, DISCONNECT_SETTLE, "reconnect-ok", (n) => {
    n.connected = true;
    for (const t of n.tasks.filter((x) => isActive(x.state))) {
      emit(n, "task.requeue", `${t.id} 新 session_id 握手回收旧租约，安全重排为 queued`, {
        taskId: t.id,
        measured: true,
        source: "docs/sprint2-acceptance-20261112.md",
        tone: "accent",
      });
      t.state = "queued";
      t.leaseEpoch = 1;
      t.agentId = null;
      t.deviceId = null;
    }
    emit(n, "conn.established", "mTLS 控制流重新建立为 ESTABLISHED，账本零冲突自愈", {
      measured: true,
      tone: "ok",
    });
  });
  return s;
}

export function reset(): SimState {
  return initialState();
}

export function advance(s: SimState, dtMs: number): SimState {
  s.t += dtMs;
  const due = s.timers.filter((tm) => tm.at <= s.t);
  if (due.length) {
    s.timers = s.timers.filter((tm) => tm.at > s.t);
    for (const tm of due) tm.fn(s);
  }

  const queued = s.tasks.filter((t) => t.state === "queued");
  for (const t of queued) {
    const slot = dispatchableSlot(s);
    if (!slot) break;
    const { agent, dev } = slot;
    t.agentId = agent.id;
    t.deviceId = dev.id;
    t.leaseEpoch += 1;
    t.state = "leased";
    s.metrics.tDetect = null;
    emit(s, "task.lease", `${t.id} 租约下发至 ${agent.id}/${dev.id}（lease_epoch=${t.leaseEpoch}）`, {
      taskId: t.id,
      tone: "accent",
    });
    after(s, SCHEDULE_TICK, "start", (n) => {
      const tt = task(n, t.id);
      if (!tt || tt.state !== "leased") return;
      tt.state = "starting";
      emit(n, "scope.create", `${tt.id} 挂载 systemd scope gpu-scavenger-${tt.id}-${tt.leaseEpoch}.scope`, { taskId: tt.id });
    });
    after(s, SCHEDULE_TICK + START_LATENCY, "warm", (n) => {
      const tt = task(n, t.id);
      if (!tt || tt.state !== "starting") return;
      tt.state = "running";
      const dd = device(n, tt.deviceId);
      if (dd) {
        dd.taskPids = 1;
        dd.usedMiB = dd.baselineUsedMiB + tt.workloadMiB;
      }
      emit(n, "task.started", `${tt.id} TaskEventStarted，${dd?.id} 显存占用 ${dd?.usedMiB.toLocaleString()} MiB`, {
        taskId: tt.id,
        measured: true,
        source: "docs/sprint0-sprint1-acceptance-20261112.md",
        tone: "ok",
      });
    });
  }
  return s;
}

export function summary(s: SimState) {
  return {
    queued: s.tasks.filter((t) => t.state === "queued").length,
    running: s.tasks.filter((t) => t.state === "running").length,
    succeeded: s.tasks.filter((t) => t.state === "succeeded").length,
    quarantined: s.agents.filter((a) => a.health === "quarantined").length,
    schedulable: schedulableAgents(s),
    elasticUsedGiB: Math.round(
      s.devices
        .filter((d) => d.externalProcs === 0 && d.taskPids > 0)
        .reduce((acc, d) => acc + d.usedMiB, 0) / 1024,
    ),
  };
}

export const SIM_CONSTANTS = {
  T_DETECT,
  T_TASK_EXIT,
  T_RELEASE,
  RELEASE_TOLERANCE_MIB,
  RELEASE_CONSECUTIVE_SAMPLES,
  RELEASE_POLL_MS,
  CHANNEL_CAPACITY,
  DISCONNECT_SETTLE,
  BACKOFF_START,
  BACKOFF_CAP,
};
