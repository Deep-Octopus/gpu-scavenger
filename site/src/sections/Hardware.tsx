import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CubeFocus, Lock, Play, ShieldCheck, Wrench } from "@phosphor-icons/react";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";
import { Section } from "@/src/components/Section";
import { prefersReduced, useReveals } from "@/src/lib/motion";
import { useGpuFocus } from "@/src/lib/focus";
import { HOST, SNAPSHOT, VERIFIER, RELEASE_TIMING as T } from "@/src/data/evidence";
import { LAYERS, type Slot } from "@/src/three/SxmModule";
import type { ViewMode } from "@/src/components/GpuStage";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const GpuStage = lazy(() => import("@/src/components/GpuStage"));

const MAX_MEM = 80_000;
const BASE = SNAPSHOT.baseline;
const TOL = VERIFIER.toleranceMiB;
const DEMO_MIB = T.injectedMiB;

const VIEWS: { id: ViewMode; label: string; icon: typeof CubeFocus; hint: string }[] = [
  { id: "board", label: "整机", icon: CubeFocus, hint: "八张卡的实时水位" },
  { id: "module", label: "单卡", icon: Play, hint: "凑近看选中这张" },
  { id: "explode", label: "拆开", icon: Wrench, hint: "分层看它由什么组成" },
];

type Phase = "idle" | "running" | "exiting" | "verifying" | "released";

function verdict(usedMiB: number) {
  if (usedMiB <= BASE + TOL) {
    return {
      tone: "text-acid",
      state: "弹性空闲 · 可借",
      why: "NVML 探针读到基线显存、无外部宿主进程、三层能力门禁全部通过，可立即承接计算分片。",
    };
  }
  return {
    tone: "text-warn",
    state: "宿主负载 · 只读保护",
    why: "七元组门禁识别到非本系统启动的宿主工作负载。控制面严守只读观测边界，永不下发停止动作。",
  };
}

export function Hardware() {
  const ref = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [ready, setReady] = useState(false);
  const [stageKey, setStageKey] = useState(0);
  const { gpu: selected, setGpu: setSelected } = useGpuFocus();
  const [mode, setMode] = useState<ViewMode>("board");
  const [layer, setLayer] = useState<number | null>(null);
  const [ours, setOurs] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [ms, setMs] = useState(0);
  const raf = useRef(0);
  const reduced = prefersReduced();
  useReveals(ref);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    cancelAnimationFrame(raf.current);
    setOurs(0);
    setPhase("idle");
    setMs(0);
  }, [selected]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const cur = SNAPSHOT.initial[selected];
  const external = cur > BASE + TOL;
  const slot: Slot = {
    index: selected,
    label: `GPU${selected}`,
    usedMiB: Math.max(cur, BASE) + ours,
    oursMiB: ours,
    external,
  };
  const slots: Slot[] = SNAPSHOT.initial.map((usedMiB, index) =>
    index === selected ? slot : { index, label: `GPU${index}`, usedMiB, external: usedMiB > BASE + TOL },
  );
  const v = verdict(cur);

  const runRelease = useCallback(() => {
    if (external) {
      toast.error("GPU" + selected + " 正承载宿主高优先级负载", {
        description: "七元组身份门禁拒绝向外部进程下发任何终止动作，保证宿主零误伤。",
      });
      return;
    }
    cancelAnimationFrame(raf.current);
    const start = performance.now();
    const wasInjected = ours === 0;
    if (wasInjected) setOurs(DEMO_MIB);
    setPhase("exiting");
    setMs(0);
    const step = () => {
      const dt = performance.now() - start;
      setMs(dt);
      if (dt < T.taskExitMs) {
        raf.current = requestAnimationFrame(step);
        return;
      }
      if (dt < T.releaseMs) {
        setPhase("verifying");
        const k = (dt - T.taskExitMs) / (T.releaseMs - T.taskExitMs);
        setOurs(DEMO_MIB * (1 - Math.min(1, k)));
        raf.current = requestAnimationFrame(step);
        return;
      }
      setOurs(0);
      setMs(T.releaseMs);
      setPhase("released");
    };
    raf.current = requestAnimationFrame(step);
  }, [external, ours, selected]);

  const polls = Math.min(T.maxPolls, Math.floor(ms / T.pollMs));
  const showMs = phase === "idle" ? 0 : ms;

  return (
    <Section
      id="hardware"
      sectionRef={ref}
      eyebrow="3D 硬件数字孪生"
      title={
        <>
          八槽位 SXM4 物理映射：
          <br className="hidden md:block" />
          显存水位与物理隔离一目了然。
        </>
      }
      lede="实时映射 8 × A800-SXM4-80GB 基板（共 640 GB HBM2e）：酸绿高亮槽位代表可安全调度，宿主受保护槽位处于物理只读隔离。支持 3D 拖拽旋转、单卡聚焦与模组炸裂拆解。"
      wide
      aside={
        <div className="flex items-center gap-1 rounded-md border border-line bg-surface p-1" role="group" aria-label="模型视角">
          {VIEWS.map((view) => {
            const on = mode === view.id;
            return (
              <button
                key={view.id}
                type="button"
                onClick={() => setMode(view.id)}
                aria-pressed={on}
                title={view.hint}
                className={cn(
                  "relative rounded-xs px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                  on ? "bg-acid text-on-acid font-semibold" : "text-muted hover:text-fg",
                )}
              >
                <view.icon size={13} weight={on ? "fill" : "regular"} className="mr-1.5 inline align-[-1.5px]" />
                {view.label}
              </button>
            );
          })}
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* 3D 视窗 */}
        <div className="surface-card reveal relative overflow-hidden lg:col-span-8">
          <div
            className="absolute inset-0 bg-bg"
            style={{
              backgroundImage: "url(/img/gpu-baseboard.webp)",
              backgroundSize: "cover",
              backgroundPosition: "center",
              opacity: ready ? 0 : 0.92,
              transition: "opacity 700ms ease",
            }}
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-linear-to-t from-bg to-transparent"
            aria-hidden="true"
          />

          {/* 3D 视窗左上 HUD 遥测浮标 */}
          <div className="pointer-events-none absolute left-4 top-4 z-10 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="num border-line bg-bg/92 text-[11px] text-acid">
              DIGITAL TWIN · NVSwitch 600 GB/s
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "num border-line bg-bg/92 text-[11px]",
                external ? "border-warn/45 text-warn" : "border-acid/40 text-quiet",
              )}
            >
              <img
                src="/img/logo-mascot.webp"
                alt=""
                aria-hidden="true"
                className="mr-1.5 size-3.5 object-contain"
              />
              {external
                ? `GPU${selected} 宿主保护 · 哨兵磁悬浮只读隔离中`
                : `Fennec 哨兵驻守 GPU${selected} · 点击任意槽位跃迁`}
            </Badge>
          </div>

          <div ref={host} className="relative h-[380px] w-full sm:h-[440px] lg:h-[520px]">
            {inView ? (
              <ErrorBoundary
                resetKey={stageKey}
                onError={() => setReady(false)}
                fallback={(reset) => (
                  <div className="pointer-events-none absolute inset-0 flex items-end justify-end p-4">
                    <button
                      type="button"
                      onClick={() => {
                        setStageKey((k) => k + 1);
                        reset();
                      }}
                      className="pointer-events-auto rounded-full border border-line bg-bg/92 px-3 py-1.5 text-[12px] text-quiet backdrop-blur-sm transition-colors hover:border-acid/50 hover:text-acid"
                    >
                      3D 视窗已切换至高精静态渲染 · 点击重试
                    </button>
                  </div>
                )}
              >
                <Suspense fallback={null}>
                  <GpuStage
                    key={stageKey}
                    slots={slots}
                    selected={selected}
                    mode={mode}
                    layer={layer}
                    lift={phase === "verifying" ? 0.05 : phase === "released" ? 0.012 : 0}
                    stamp={`${HOST.node} · ${HOST.date}`}
                    reduced={reduced}
                    onSelect={setSelected}
                    onReady={() => setReady(true)}
                  />
                </Suspense>
              </ErrorBoundary>
            ) : null}
          </div>

          {/* 爆炸态层图例 */}
          {mode === "explode" ? (
            <div className="absolute right-4 top-4 z-10 w-[196px] rounded-md border border-line bg-surface-3/95 p-2.5">
              <p className="micro mb-1.5 text-acid">SXM4 硬件分层解剖</p>
              <ul className="space-y-0.5">
                {LAYERS.map((name, i) => (
                  <li key={name}>
                    <button
                      type="button"
                      onMouseEnter={() => setLayer(i)}
                      onMouseLeave={() => setLayer(null)}
                      onFocus={() => setLayer(i)}
                      onBlur={() => setLayer(null)}
                      className={cn(
                        "flex w-full items-baseline gap-2 rounded-xs px-2 py-1 text-left text-[12.5px] transition-colors",
                        layer === i ? "bg-acid/15 text-acid font-medium" : "text-muted hover:text-fg",
                      )}
                    >
                      <span className="num text-[11px] text-muted/70">0{i + 1}</span>
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="relative grid grid-cols-4 gap-px border-t border-line/70 bg-line/60 sm:grid-cols-8">
            {slots.map((s) => {
              const idle = !s.external && (s.oursMiB ?? 0) === 0 && s.usedMiB <= BASE + TOL;
              const on = selected === s.index;
              return (
                <button
                  key={s.index}
                  type="button"
                  onClick={() => setSelected(s.index)}
                  aria-pressed={on}
                  className={cn(
                    "group flex flex-col gap-1.5 px-3 py-3 text-left transition-colors",
                    on ? "bg-surface-2" : "bg-bg hover:bg-surface/70",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className={cn("num text-[12.5px] font-semibold", on ? "text-fg" : "text-quiet")}>
                      {s.label}
                    </span>
                    {s.external ? (
                      <Lock size={11} weight="bold" className="text-warn/85" />
                    ) : (
                      <span className="size-1.5 rounded-full bg-acid" />
                    )}
                  </div>
                  <span className={cn("num text-[12px]", idle ? "text-acid" : "text-muted")}>
                    {Math.round(s.usedMiB).toLocaleString()}
                    <span className="ml-0.5 text-[11px] text-muted/70">MiB</span>
                  </span>
                  <span className="mt-0.5 block h-1 w-full overflow-hidden rounded-full bg-surface-3" role="presentation">
                    <span
                      className={cn("block h-full origin-left", idle ? "bg-acid/70" : "bg-warn/75")}
                      style={{ transform: `scaleX(${Math.max(0.03, s.usedMiB / MAX_MEM)})` }}
                    />
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 右侧硬件透视与释放演练面板 */}
        <div className="space-y-5 lg:col-span-4">
          <div className="surface-card spot p-5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="num text-[16px] font-semibold text-fg">{slot.label} · 物理槽位详情</span>
              <span className={cn("num text-[12.5px] font-semibold", ours > 0 ? "text-acid" : v.tone)}>
                {ours > 0 ? "弹性任务运行中" : v.state}
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-1.5">
              <span
                className={cn(
                  "num text-[clamp(2rem,4.5vw,2.8rem)] font-semibold leading-none tracking-[-0.05em]",
                  ours > 0 ? "text-acid" : v.tone,
                )}
              >
                {Math.round(slot.usedMiB).toLocaleString()}
              </span>
              <span className="num text-[13px] text-muted">MiB / 80,000</span>
            </div>
            <div className="mt-4 flex h-1.5 w-full overflow-hidden rounded-full bg-surface-3" role="presentation">
              <div
                className="h-full bg-warn/80"
                style={{
                  width: `${Math.max(0.5, ((slot.usedMiB - ours) / MAX_MEM) * 100)}%`,
                  transition: "width 200ms linear",
                }}
              />
              <div
                className="h-full bg-acid"
                style={{ width: `${(ours / MAX_MEM) * 100}%`, transition: "width 200ms linear" }}
              />
            </div>
            <p className="mt-4 text-[13.5px] leading-relaxed text-quiet">
              {ours > 0 ? "该块显存由本项目专属 systemd scope 申请，完全处于可亚秒抢占的安全边界内。" : v.why}
            </p>
          </div>

          <div className="surface-card reveal p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="micro text-acid">单卡 472ms 释放回放</p>
              {phase !== "idle" ? (
                <p className="num text-[13px] text-fg">
                  {Math.round(showMs)}
                  <span className="ml-0.5 text-[11px] text-muted">ms</span>
                  <span className="ml-2 text-[12px] text-cyan">{polls} 次双采样</span>
                </p>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={runRelease}
                className={cn(
                  "flex items-center gap-2 rounded-md px-4 py-2.5 text-[13.5px] font-semibold transition active:translate-y-px",
                  external
                    ? "border border-warn/40 bg-warn/10 text-warn hover:bg-warn/15"
                    : "bg-acid text-on-acid hover:brightness-110",
                )}
              >
                {external ? <Lock size={14} weight="bold" /> : <Play size={14} weight="fill" />}
                {external ? "宿主卡 · 拒绝抢占" : phase === "released" ? "再演练一遍" : "注入任务并释放"}
              </button>
              <span className="text-[12px] text-muted">
                {external ? "七元组识别为外部进程，禁止操作" : "24 GiB 负载按真机时延回放"}
              </span>
            </div>

            <ol className="mt-4 space-y-2.5">
              {[
                { key: "exiting", at: T.taskExitMs, label: "隔离边界回收（scope 为空）", sub: `${T.taskExitMs}ms` },
                {
                  key: "verifying",
                  at: T.releaseMs,
                  label: `每 ${T.pollMs}ms 采样 · 连续 ${VERIFIER.consecutiveSamples} 次基线确认`,
                  sub: `${T.releaseMs}ms`,
                },
              ].map((step, i) => {
                const done = phase === "released" || (phase === "verifying" && i === 0);
                const live = phase === step.key;
                const at = i === 0 ? T.taskExitMs : T.releaseMs;
                return (
                  <li key={step.key} className="grid grid-cols-[72px_1fr] items-baseline gap-3">
                    <span className={cn("num text-[12px]", done ? "text-acid" : live ? "text-fg" : "text-muted/70")}>
                      {done ? `≤ ${at}` : live ? Math.round(Math.min(ms, at)) : at}
                      <span className="text-[11px]">ms</span>
                    </span>
                    <span className="flex flex-col">
                      <span className={cn("text-[13px]", done || live ? "text-quiet" : "text-muted/80")}>{step.label}</span>
                      <span className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-3" role="presentation">
                        <span
                          className={cn("block h-full origin-left transition-transform duration-150", done ? "bg-acid" : live ? "bg-cyan" : "bg-transparent")}
                          style={{
                            transform: `scaleX(${done ? 1 : live ? Math.min(1, Math.max(0, (ms - (i === 0 ? 0 : T.taskExitMs)) / (at - (i === 0 ? 0 : T.taskExitMs)))) : 0})`,
                          }}
                        />
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>

            {phase === "released" ? (
              <p className="mt-4 flex items-center gap-1.5 text-[12.5px] font-medium text-cyan">
                <ShieldCheck size={15} weight="fill" />
                显存已确认回归 {BASE} MiB 基线，SXM 插座下方的 LGA 触点可见。
              </p>
            ) : null}
          </div>

          <div className="surface-card reveal overflow-hidden">
            <div className="border-b border-line/70 px-4 py-2.5">
              <span className="micro">节点硬件探针契约</span>
            </div>
            <dl className="divide-y divide-line/60">
              {[
                ["显存探针", "NVML 逐 UUID 设备只读采样"],
                ["进程归属", "/proc 启动滴答 + cgroup v2 inode"],
                ["安全门禁", "探针、身份、隔离三层全通过方才调度"],
                ["动作边界", "SIGUSR1 与 HardStop 严格限定自有 scope"],
              ].map(([k, d]) => (
                <div key={k} className="grid grid-cols-[76px_1fr] gap-3 px-4 py-2.5">
                  <dt className="micro">{k}</dt>
                  <dd className="text-[13px] leading-relaxed text-quiet">{d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </Section>
  );
}
