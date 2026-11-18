import { useSyncExternalStore } from "react";

/**
 * 沙盒事件流 → 状态机跃迁的唯一映射表。
 * 键是 sim.ts 里的 event kind；值必须能在 StateMachine 的跃迁表里找到同名的一条边，
 * 找不到就退化成「只点亮节点」，绝不为了好看而编造一条 core 里没有的跃迁。
 */
export type Graph = "task" | "node";

export type Pulse = {
  graph: Graph;
  from: string;
  to: string;
  kind: string;
  seq: number;
};

const EDGE: Record<string, { graph: Graph; from: string; to: string }> = {
  "task.enqueue": { graph: "task", from: "Queued", to: "Queued" },
  "task.lease": { graph: "task", from: "Queued", to: "Leased" },
  "task.started": { graph: "task", from: "Leased", to: "Running" },
  "claim.active": { graph: "task", from: "Running", to: "Stopping" },
  "release.verified": { graph: "task", from: "Stopping", to: "Requeued" },
  "task.requeue": { graph: "task", from: "Requeued", to: "Queued" },
  "result.commit": { graph: "task", from: "Running", to: "Succeeded" },
  "task.failed": { graph: "task", from: "Running", to: "Failed" },
  "lease.expired": { graph: "task", from: "Leased", to: "Requeued" },
  "probe.transient": { graph: "node", from: "Ready", to: "Degraded" },
  "probe.quarantined": { graph: "node", from: "Degraded", to: "Quarantined" },
  "probe.recovered": { graph: "node", from: "Degraded", to: "Ready" },
  "conn.closed": { graph: "node", from: "Ready", to: "Disconnected" },
  "conn.established": { graph: "node", from: "Disconnected", to: "Ready" },
};

export const isMachineEvent = (kind: string): boolean => kind in EDGE;

let latest: Pulse | null = null;
let counter = 0;
const subs = new Set<() => void>();

/** 返回这条事件点亮了哪条跃迁；未映射的 kind 返回 null，调用方据此决定要不要提示 */
export function pulseEvent(kind: string): Pulse | null {
  const e = EDGE[kind];
  if (!e) return null;
  latest = { ...e, kind, seq: ++counter };
  subs.forEach((fn) => fn());
  return latest;
}

function subscribe(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function useMachinePulse(): Pulse | null {
  return useSyncExternalStore(
    subscribe,
    () => latest,
    () => latest,
  );
}
