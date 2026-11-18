import { useEffect, useMemo, useRef, useState } from "react";
import {
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Play, Pause, ArrowsClockwise, ShieldCheck } from "@phosphor-icons/react";
import { Section } from "@/src/components/Section";
import { dur, prefersReduced, useReveals } from "@/src/lib/motion";
import { useMachinePulse, type Graph, type Pulse } from "@/src/lib/transitions";
import { cn } from "@/lib/utils";

/* ── 节点：固定宽度，列距 300/320，让路由只依赖实测出来的锚点 ── */

type Kind = "start" | "active" | "good" | "bad" | "risk";

const KIND: Record<Kind, { ring: string; dot: string; text: string }> = {
  start: { ring: "border-line", dot: "bg-muted", text: "text-quiet" },
  active: { ring: "border-quiet/40", dot: "bg-quiet", text: "text-fg" },
  good: { ring: "border-acid/55", dot: "bg-acid", text: "text-acid" },
  bad: { ring: "border-danger/50", dot: "bg-danger", text: "text-danger" },
  risk: { ring: "border-warn/50", dot: "bg-warn", text: "text-warn" },
};

type StateData = { label: string; desc: string; kind: Kind; hit: number; into: boolean };

const H = {
  tl: { type: "target", position: Position.Left, top: "38%" },
  tr: { type: "target", position: Position.Right, top: "68%" },
  sl: { type: "source", position: Position.Left, top: "68%" },
  sl2: { type: "source", position: Position.Left, top: "38%" },
  sr: { type: "source", position: Position.Right, top: "38%" },
  tt: { type: "target", position: Position.Top, left: "30%" },
  st: { type: "source", position: Position.Top, left: "30%" },
  tt2: { type: "target", position: Position.Top, left: "70%" },
  st2: { type: "source", position: Position.Top, left: "70%" },
  tb: { type: "target", position: Position.Bottom, left: "30%" },
  sb: { type: "source", position: Position.Bottom, left: "30%" },
  tb2: { type: "target", position: Position.Bottom, left: "70%" },
  sb2: { type: "source", position: Position.Bottom, left: "70%" },
} as const;

type HandleKey = keyof typeof H;

function StateNode({ data, selected }: NodeProps) {
  const d = data as unknown as StateData;
  const kind = KIND[d.kind];
  return (
    <div
      className={cn(
        "relative w-[196px] border bg-bg/92 px-3.5 py-3 transition-[border-color,box-shadow,transform] duration-300",
        selected ? "scale-[1.03] border-acid/75 shadow-[0_0_0_1px_var(--color-acid-tint)]" : kind.ring,
      )}
      style={{ borderRadius: "calc(var(--site-radius) - 3px)" }}
    >
      {d.hit > 0 && (
        <span
          key={d.hit}
          aria-hidden="true"
          className={cn(
            "node-hit pointer-events-none absolute inset-0 border",
            d.into ? "border-acid" : "border-quiet/60",
          )}
          style={{ borderRadius: "calc(var(--site-radius) - 3px)" }}
        />
      )}
      {Object.entries(H).map(([id, h]) => (
        <Handle
          key={id}
          id={id}
          type={h.type as "source" | "target"}
          position={h.position}
          style={"top" in h ? { top: h.top } : { left: h.left }}
          className="!size-1.5 !border-0 !bg-transparent"
        />
      ))}
      <div className="flex items-center gap-2">
        <span className={cn("size-1.5 shrink-0 rounded-full", selected ? "bg-acid" : kind.dot)} aria-hidden="true" />
        <span className={cn("num text-[14px] font-semibold tracking-[-0.02em]", selected ? "text-acid" : kind.text)}>
          {d.label}
        </span>
      </div>
      <p className="mt-1.5 text-[13px] leading-snug text-muted">{d.desc}</p>
    </div>
  );
}

const nodeTypes = { state: StateNode };

type XY = [number, number];
type Channel = null | ["x", number] | ["y", number];
type LabelOn = [number, number];
type RouteData = { label: string; ch: Channel; lp: LabelOn | null; lit: boolean; dash: boolean; hit: number };

const isHoriz = (k: HandleKey) => /[lr]$/.test(k.replace(/\d+$/, ""));

function waypoints(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  sh: HandleKey,
  th: HandleKey,
  ch: Channel,
): XY[] {
  const sH = isHoriz(sh);
  if (sH !== isHoriz(th)) {
    return sH ? [[tx, sy]] : [[sx, ty]];
  }
  if (sH) {
    if (Math.abs(sy - ty) < 0.5) return [];
    const mx = ch?.[0] === "x" ? ch[1] : (sx + tx) / 2;
    return [[mx, sy], [mx, ty]];
  }
  if (Math.abs(sx - tx) < 0.5) return [];
  const my = ch?.[0] === "y" ? ch[1] : (sy + ty) / 2;
  return [[sx, my], [tx, my]];
}

function autoLabel(pts: XY[]): XY {
  let best: XY = pts[0];
  let len = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (d > len) {
      len = d;
      best = [(pts[i][0] + pts[i - 1][0]) / 2, (pts[i][1] + pts[i - 1][1]) / 2];
    }
  }
  return best;
}

function labelAt(pts: XY[], on: LabelOn | null): XY {
  if (!on) return autoLabel(pts);
  const [i, t] = on;
  const a = pts[Math.min(i, pts.length - 2)];
  const b = pts[Math.min(i + 1, pts.length - 1)];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function RoutedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourceHandleId,
  targetHandleId,
  markerEnd,
  style,
  data,
}: EdgeProps) {
  const d = data as unknown as RouteData;
  const sh = (sourceHandleId ?? "sr") as HandleKey;
  const th = (targetHandleId ?? "tl") as HandleKey;
  const pts: XY[] = [[sourceX, sourceY], ...waypoints(sourceX, sourceY, targetX, targetY, sh, th, d.ch), [targetX, targetY]];
  const path = pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
  const [lx, ly] = labelAt(pts, d.lp);
  return (
    <>
      <path id={id} className="react-flow__edge-path" d={path} fill="none" markerEnd={markerEnd} style={style} />
      {d.hit > 0 && (
        <path
          key={d.hit}
          className="flow-tracer"
          d={path}
          pathLength={100}
          fill="none"
          stroke="var(--color-acid)"
          strokeWidth={2.4}
          strokeLinecap="round"
        />
      )}
      <text
        x={lx}
        y={ly}
        textAnchor="middle"
        dominantBaseline="central"
        className="num"
        style={{
          fontSize: 13,
          fill: d.lit ? "var(--color-acid)" : "var(--site-muted)",
          paintOrder: "stroke",
          stroke: "var(--color-bg)",
          strokeWidth: 6,
          strokeLinejoin: "round",
          transition: `fill ${dur(220)}s ease`,
        }}
      >
        {d.label}
      </text>
    </>
  );
}

const edgeTypes = { routed: RoutedEdge };

type Spec = { id: string; label: string; desc: string; guard: string; kind: Kind; x: number; y: number };

const TASK_NODES: Spec[] = [
  { id: "Queued", label: "Queued", desc: "在 SQLite 队列里等待，未绑定设备", guard: "持久化于 SQLite WAL，等待具备全部三层能力的空闲 Agent", kind: "start", x: 0, y: 190 },
  { id: "Leased", label: "Leased", desc: "已发出租约与 lease_epoch，尚未启动", guard: "分配单调 lease_epoch 与 command_seq，超时自动退回队列不惩罚任务", kind: "active", x: 300, y: 190 },
  { id: "Running", label: "Running", desc: "进程在自有 scope 内运行，显存计入本任务", guard: "绑定七元组身份指纹，仅自有 cgroup v2 作用域可接受信号", kind: "active", x: 600, y: 190 },
  { id: "Stopping", label: "Stopping", desc: "收到抢占，正在停止自有边界内的进程", guard: "触发 SIGUSR1 / HardStop 并启动 50ms 有界轮询验证真释放", kind: "active", x: 900, y: 190 },
  { id: "Requeued", label: "Requeued", desc: "ReleaseVerified 通过，安全回到队列", guard: "必须通过 cgroup 为空 + PID=0 + 显存归零双采样才允许重排", kind: "start", x: 1250, y: 190 },
  { id: "Failed", label: "Failed", desc: "任务失败，不回收他人资源", guard: "仅清理本任务 scope 与进程树，不影响同卡其他用户进程", kind: "bad", x: 0, y: 30 },
  { id: "Succeeded", label: "Succeeded", desc: "结果提交后显存验证通过", guard: "强制前置条件：ResultCommit + 流式 SHA-256 必须先于 Succeeded", kind: "good", x: 900, y: 30 },
  { id: "Quarantined", label: "Quarantined", desc: "探针边界失效，停止向该 Agent 调度", guard: "Fail-Closed 门禁：观测失真立即停发新任务，拒绝盲猜清理", kind: "risk", x: 600, y: 330 },
];

type Spec2 = [string, string, string, HandleKey, HandleKey, Channel, LabelOn?, boolean?];

const TASK_EDGES: Spec2[] = [
  ["Queued", "Leased", "LeaseGranted", "sr", "tl", null],
  ["Leased", "Running", "Started", "sr", "tl", null],
  ["Running", "Stopping", "StopRequested", "sr", "tl", null],
  ["Stopping", "Requeued", "ReleaseVerified", "sr", "tl", null],
  ["Running", "Failed", "TaskFailed", "st", "tt", ["y", 0]],
  ["Running", "Succeeded", "ReleaseVerified", "st2", "tt", ["y", 0]],
  ["Running", "Quarantined", "ProbeFailure", "sl", "tl", ["x", 556], undefined, true],
  ["Stopping", "Quarantined", "ProbeFailure", "sb", "tr", null, undefined, true],
  ["Leased", "Requeued", "LeaseExpired", "sb", "tb", ["y", 440]],
  ["Requeued", "Queued", "重新入队", "sb", "tb", ["y", 478], undefined, true],
];

const NODE_NODES: Spec[] = [
  { id: "Disconnected", label: "Disconnected", desc: "出站流断开，退避 250ms→5s", guard: "控制面离线时 Agent 本地自动 HardStop 自有 scope 归还 GPU", kind: "start", x: 0, y: 230 },
  { id: "Ready", label: "Ready", desc: "三层门禁通过，schedulable=true", guard: "NVML 探针、7 元组身份与 cgroup v2 边界同时健康方允许接活", kind: "good", x: 615, y: 230 },
  { id: "Quarantined", label: "Quarantined", desc: "停止调度，直到探针恢复", guard: "重连默认先进入安全隔离态或边界失真立即熔断，严禁盲目派发", kind: "risk", x: 1230, y: 30 },
  { id: "Degraded", label: "Degraded", desc: "连续暂态失败，暂停派发", guard: "捕获 NVML 瞬态故障立即暂停派单，等待探针自愈或降级隔离", kind: "active", x: 1230, y: 400 },
];

const NODE_EDGES: Spec2[] = [
  ["Disconnected", "Ready", "ProbeHealthy", "sr", "tl", null, [0, 0.2]],
  ["Ready", "Disconnected", "ConnectionLost", "sl", "tr", null, [0, 0.39], true],
  ["Disconnected", "Quarantined", "Connected", "st", "tl", null, [1, 0.45]],
  ["Quarantined", "Ready", "ProbeHealthy", "sl", "tt", null, [0, 0.55]],
  ["Ready", "Quarantined", "ProbeBoundaryFailure", "st2", "tb", ["y", 160], [1, 0.5]],
  ["Ready", "Degraded", "ProbeTransientFailure", "sb2", "tt", ["y", 355], [1, 0.5]],
  ["Degraded", "Ready", "ProbeHealthy", "sl2", "tb", null, [0, 0.45]],
  ["Degraded", "Quarantined", "ProbeBoundaryFailure", "st2", "tb2", null, [0, 0.5], true],
  ["Degraded", "Disconnected", "ConnectionLost", "sl", "tb", null, [0, 0.5], true],
];

const PATHS: Record<"task" | "node", string[][]> = {
  task: [
    ["Queued", "Leased"],
    ["Leased", "Running"],
    ["Running", "Stopping"],
    ["Stopping", "Requeued"],
    ["Requeued", "Queued"],
  ],
  node: [
    ["Disconnected", "Quarantined"],
    ["Quarantined", "Ready"],
    ["Ready", "Degraded"],
    ["Degraded", "Ready"],
  ],
};

type Hit = { key: string; from: string; to: string; seq: number } | null;

function build(specs: Spec[], visited: Set<string>, hit: Hit): Node[] {
  return specs.map((s) => ({
    id: s.id,
    type: "state",
    position: { x: s.x, y: s.y },
    selected: visited.has(s.id),
    data: {
      label: s.label,
      desc: s.desc,
      kind: s.kind,
      hit: hit && (s.id === hit.from || s.id === hit.to) ? hit.seq : 0,
      into: hit?.to === s.id,
    },
  }));
}

function edgesFor(specs: Spec2[], lit: Set<string>, reduced: boolean, hit: Hit): Edge[] {
  return specs.map(([from, to, label, sh, th, ch, lp, dashed], i) => {
    const key = `${from}->${to}`;
    const on = lit.has(key);
    const stroke = on ? "var(--color-acid)" : "rgba(237,241,235,0.28)";
    return {
      id: `${from}-${to}-${i}`,
      source: from,
      target: to,
      sourceHandle: sh,
      targetHandle: th,
      type: "routed",
      animated: on && !reduced,
      markerEnd: { type: MarkerType.ArrowClosed, width: 9, height: 9, color: stroke },
      style: {
        stroke,
        strokeWidth: on ? 1.7 : 1.25,
        strokeDasharray: dashed && !on ? "4 4" : undefined,
        transition: `stroke ${dur(220)}s ease`,
      },
      data: {
        label,
        ch,
        lp: lp ?? null,
        lit: on,
        dash: !!dashed,
        hit: hit?.key === key ? hit.seq : 0,
      } satisfies RouteData,
    };
  });
}

export function StateMachine() {
  const ref = useRef<HTMLElement>(null);
  useReveals(ref);
  const [which, setWhich] = useState<Graph>("task");
  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [inspectedId, setInspectedId] = useState<string>("Running");
  const reduced = prefersReduced();

  const pulse = useMachinePulse();
  const [flash, setFlash] = useState<Pulse | null>(null);
  const [ghost, setGhost] = useState<Graph | null>(null);
  const seen = useRef(0);
  const whichRef = useRef(which);
  whichRef.current = which;
  useEffect(() => {
    if (!pulse || pulse.seq === seen.current) return;
    seen.current = pulse.seq;
    if (pulse.graph === whichRef.current) setFlash(pulse);
    else setGhost(pulse.graph);
    const a = window.setTimeout(() => setFlash((p) => (p?.seq === pulse.seq ? null : p)), 1500);
    const b = window.setTimeout(() => setGhost((g) => (g === pulse.graph ? null : g)), 2600);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [pulse]);

  const hit: Hit = useMemo(
    () => (flash && flash.graph === which ? { key: `${flash.from}->${flash.to}`, from: flash.from, to: flash.to, seq: flash.seq } : null),
    [flash, which],
  );

  const specs = which === "task" ? TASK_NODES : NODE_NODES;
  const pairs = which === "task" ? TASK_EDGES : NODE_EDGES;
  const inspected = specs.find((s) => s.id === inspectedId) ?? specs[0];

  const lit = useMemo(() => {
    const s = new Set<string>();
    if (step >= 0) PATHS[which].slice(0, step + 1).forEach(([a, b]) => s.add(`${a}->${b}`));
    if (hit) s.add(hit.key);
    return s;
  }, [which, step, hit]);

  const visited = useMemo(() => {
    const s = new Set<string>();
    if (step >= 0) PATHS[which].slice(0, step + 1).forEach(([a, b]) => (s.add(a), s.add(b)));
    if (hit) (s.add(hit.from), s.add(hit.to));
    return s;
  }, [which, step, hit]);

  const nodes = useMemo(() => build(specs, visited, hit), [specs, visited, hit]);
  const edges = useMemo(() => edgesFor(pairs, lit, reduced, hit), [pairs, lit, reduced, hit]);

  useEffect(() => {
    if (!playing) return;
    const len = PATHS[which].length;
    const id = window.setInterval(() => {
      setStep((v) => {
        if (v + 1 >= len) {
          setPlaying(false);
          return v;
        }
        return v + 1;
      });
    }, 900);
    return () => window.clearInterval(id);
  }, [playing, which]);

  const play = () => {
    if (step >= PATHS[which].length - 1) setStep(-1);
    setPlaying(true);
  };

  return (
    <Section
      id="machine"
      variant="right"
      sectionRef={ref}
      eyebrow="形式化双状态机"
      title={<>纯函数穷举跃迁表：非法状态转换一律返回 Invalid。</>}
      lede="任务生命周期与节点健康度严格正交解耦，统一收口于 scavenger-core::apply_*_event。支持下方交互控制台实时电脉冲联动，点击任意节点可查看其进入守卫条件。"
      aside={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-px overflow-hidden border border-line" style={{ borderRadius: "calc(var(--site-radius) - 4px)" }}>
            {(["task", "node"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setWhich(k);
                  setInspectedId(k === "task" ? "Running" : "Ready");
                  setStep(-1);
                  setPlaying(false);
                  setFlash(null);
                  setGhost(null);
                }}
                aria-pressed={which === k}
                title={ghost === k ? "这台机器刚有跃迁" : undefined}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-[13px] transition-colors",
                  which === k ? "bg-acid text-on-acid font-semibold" : "bg-surface text-muted hover:text-quiet",
                )}
              >
                {k === "task" ? "任务" : "节点"}
                {ghost === k ? (
                  <span className="ghost-dot size-1.5 shrink-0 rounded-full bg-acid" aria-hidden="true" />
                ) : null}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={playing ? () => setPlaying(false) : play}
            className="flex items-center gap-2 border border-line bg-surface px-3 py-1.5 text-[13px] text-quiet transition-colors hover:border-acid/45 active:translate-y-px"
            style={{ borderRadius: "calc(var(--site-radius) - 4px)" }}
          >
            {playing ? <Pause size={12} weight="bold" /> : <Play size={12} weight="fill" />}
            {playing ? "暂停" : "走一遍回收路径"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep(-1);
              setPlaying(false);
            }}
            className="flex items-center gap-2 border border-line px-3 py-1.5 text-[13px] text-muted transition-colors hover:text-quiet"
            style={{ borderRadius: "calc(var(--site-radius) - 4px)" }}
          >
            <ArrowsClockwise size={12} weight="bold" />
            复位
          </button>
        </div>
      }
    >
      <div className="reveal">
        <div className="surface-card -mx-2 hidden overflow-hidden md:block md:mx-0">
          <div className="h-[480px] w-full">
            <ReactFlow
              key={which}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={(_, node) => setInspectedId(node.id)}
              fitView
              fitViewOptions={{ padding: "4%", includeHiddenNodes: true }}
              nodesConnectable={false}
              nodesDraggable={false}
              deleteKeyCode={null}
              minZoom={0.4}
              maxZoom={1.2}
              selectionOnDrag={false}
            />
          </div>
          {/* 状态节点形式化守卫详情条 */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line/70 bg-surface-3/90 px-4 py-2.5">
            <div className="flex items-center gap-2.5 text-[12.5px]">
              <ShieldCheck size={15} weight="duotone" className="text-acid" />
              <span className="num font-semibold text-fg">{inspected.label}</span>
              <span className="text-muted">守卫条件：</span>
              <span className="text-quiet">{inspected.guard}</span>
            </div>
            <span className="num text-[11.5px] text-muted">点击图中节点切换校验规则</span>
          </div>
        </div>

        {/* 窄屏线性表 */}
        <ul className="rows md:hidden">
          {pairs.map(([from, to, label]) => (
            <li
              key={`${from}-${to}-${label}`}
              className={cn(
                "flex flex-wrap items-baseline gap-x-2 gap-y-1 px-1.5 py-2 transition-colors duration-500",
                hit?.key === `${from}->${to}` ? "bg-acid-tint" : "bg-transparent",
              )}
            >
              <span className="num text-[13px] text-quiet">{from}</span>
              <span className="micro text-muted">→</span>
              <span className="num text-[13px] text-quiet">{to}</span>
              <span className="num ml-auto text-[12.5px] text-acid">{label}</span>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 md:flex-nowrap">
          <span className="micro">实线 = 正常确定性跃迁</span>
          <span className="micro">虚线 = 容灾恢复或熔断隔离</span>
          <span
            className={cn("num ml-auto flex shrink-0 items-center gap-2 text-[12.5px]", flash ? "text-acid" : "text-muted/70")}
            aria-live="polite"
          >
            <span
              className={cn("size-1.5 shrink-0 rounded-full", flash ? "bg-acid" : "border border-line")}
              aria-hidden="true"
            />
            {flash ? `${flash.kind} · ${flash.from} → ${flash.to}` : "下方交互控制台每产生一次跃迁，这里同步脉冲点亮"}
          </span>
          <span className="num w-full shrink-0 text-[12px] text-muted md:w-auto">
            {which === "task"
              ? `${TASK_NODES.length} 状态 · ${TASK_EDGES.length} 条跃迁`
              : `${NODE_NODES.length} 状态 · ${NODE_EDGES.length} 条跃迁`}
          </span>
        </div>
      </div>

      <div className="reveal mt-8 grid gap-4 md:grid-cols-3">
        {[
          ["释放与退出严格解耦", "Stopping 必须跨越 ReleaseVerified 双采样才可跃迁至 Requeued，彻底根除异步回收竞态。"],
          ["租约超时零惩罚无损回队", "Leased 遇到 LeaseExpired 直接回归队列并更新纪元，避免网络瞬断导致有效分片误判失败。"],
          ["熔断隔离不干扰退让", "Quarantined 冻结新任务派发的同时，仍允许已有任务完成本地回收释放，保障宿主用卡优先。"],
        ].map(([h, b]) => (
          <div key={h} className="surface-card p-4">
            <h3 className="text-[14px] font-semibold tracking-[-0.015em] text-fg">{h}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{b}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
