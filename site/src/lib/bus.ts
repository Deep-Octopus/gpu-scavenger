/**
 * 跨小节动作总线：命令面板需要驱动沙盒，但不希望把沙盒状态下沉到 App 根。
 * 只用于离散动作，不承载连续数据。
 */
type Handler = () => void;

const handlers = new Map<string, Set<Handler>>();

export function onAction(name: string, fn: Handler): () => void {
  let set = handlers.get(name);
  if (!set) {
    set = new Set();
    handlers.set(name, set);
  }
  set.add(fn);
  return () => {
    set?.delete(fn);
    if (set && set.size === 0) handlers.delete(name);
  };
}

export function dispatchAction(name: string): boolean {
  const set = handlers.get(name);
  if (!set) return false;
  set.forEach((fn) => fn());
  return true;
}

export const ACTIONS = {
  claim: "sandbox.claim",
  unclaim: "sandbox.unclaim",
  enqueue: "sandbox.enqueue",
  enqueueCkpt: "sandbox.enqueue.ckpt",
  nvmlFail: "sandbox.nvml.fail",
  dropConn: "sandbox.conn.drop",
  reset: "sandbox.reset",
} as const;
