import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Flip, dur, gsap, prefersReduced, scrollToSection, useSpotlight } from "@/src/lib/motion";
import { useGpuFocus } from "@/src/lib/focus";
import { ACTIONS, onAction } from "@/src/lib/bus";
import { isMachineEvent, pulseEvent } from "@/src/lib/transitions";
import { cn } from "@/lib/utils";
import { Section } from "@/src/components/Section";
import { FoxSlotHopper } from "@/src/components/FoxSlotHopper";
import { Badge } from "@/components/ui/badge";
import {
  advance,
  activateClaim,
  commitResult,
  dropController,
  enqueue,
  enqueueBurst,
  initialState,
  injectNvmlFailure,
  releaseClaim,
  reset,
  restoreProbe,
  SIM_CONSTANTS,
  summary,
  type SimState,
  type TaskState,
} from "@/src/lib/sim";
import {
  ArrowsClockwise,
  CheckCircle,
  Cpu,
  HardDrives,
  Lightning,
  LightningSlash,
  Lock,
  Play,
  PlugsConnected,
  ShieldWarning,
} from "@phosphor-icons/react";

const TOTAL_MIB = 80_000;

const STATE_TONE: Record<TaskState, string> = {
  queued: "text-muted border-line",
  leased: "text-quiet border-line",
  starting: "text-warn border-warn/40",
  running: "text-acid border-acid/50 bg-acid-tint/60",
  stopAcceptingWork: "text-warn border-warn/40",
  draining: "text-warn border-warn/40",
  checkpointing: "text-cyan border-cyan/50 bg-cyan-tint/60",
  stopping: "text-danger border-danger/45 bg-danger/10",
  verifyingRelease: "text-cyan border-cyan/45",
  requeued: "text-quiet border-line",
  succeeded: "text-acid border-acid/50 bg-acid-tint/60",
  failed: "text-danger border-danger/45",
};

const READABLE: Record<TaskState, string> = {
  queued: "Queued",
  leased: "Leased",
  starting: "Starting",
  running: "Running",
  stopAcceptingWork: "StopAcceptingWork",
  draining: "Draining",
  checkpointing: "Checkpointing",
  stopping: "Stopping",
  verifyingRelease: "VerifyingRelease",
  requeued: "Requeued",
  succeeded: "Succeeded",
  failed: "Failed",
};

const RATE_KEY = "gpu-scavenger-sandbox-rate";

const toneOf = (t?: "ok" | "warn" | "bad" | "accent") =>
  t === "bad"
    ? "text-danger"
    : t === "warn"
      ? "text-warn"
      : t === "accent"
        ? "text-acid"
        : t === "ok"
          ? "text-cyan"
          : "text-quiet";

function Btn({
  onClick,
  children,
  tone = "default",
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  tone?: "default" | "accent" | "danger" | "warn";
  disabled?: boolean;
}) {
  const tones = {
    default: "border-line bg-surface-3 text-quiet hover:border-quiet/50 hover:text-fg",
    accent: "border-acid/45 bg-acid-tint text-acid hover:border-acid/80",
    danger: "border-danger/40 bg-danger/10 text-danger hover:border-danger/75",
    warn: "border-warn/40 bg-warn/10 text-warn hover:border-warn/75",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1.5 border px-3 py-2 text-[13px] font-medium transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40",
        tones[tone],
      )}
      style={{ borderRadius: "calc(var(--site-radius) - 4px)" }}
    >
      {children}
    </button>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-l border-line/70 pl-4 first:border-l-0 first:pl-0">
      <span className="micro mr-0.5 shrink-0 text-muted/80">{label}</span>
      {children}
    </div>
  );
}

export function Sandbox() {
  const state = useRef<SimState>(initialState());
  const [, force] = useState(0);
  const [rate, setRate] = useState(() => {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(RATE_KEY);
    return raw === "8" || raw === "24" ? Number(raw) : 1;
  });
  const [scenarioNote, setScenarioNote] = useState<string | null>(null);
  const scenarioTimers = useRef<number[]>([]);
  const lastSeq = useRef(0);
  const pendingFlip = useRef<ReturnType<typeof Flip.getState> | null>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const animSeq = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const rackRef = useRef<HTMLDivElement>(null);
  useSpotlight(panelRef);

  const commit = () => force((v) => v + 1);

  const scanSeq = useRef(0);
  const chain = useRef<number[]>([]);
  const syncMachine = () => {
    const evs = state.current.events;
    const kinds: string[] = [];
    for (const e of evs) {
      if (e.seq > scanSeq.current && isMachineEvent(e.kind)) kinds.push(e.kind);
    }
    if (evs.length) scanSeq.current = Math.max(scanSeq.current, evs[evs.length - 1].seq);
    if (!kinds.length) return;
    chain.current.forEach(window.clearTimeout);
    chain.current = [];
    kinds.slice(-4).forEach((kind, i) => {
      if (i === 0) pulseEvent(kind);
      else chain.current.push(window.setTimeout(() => pulseEvent(kind), i * 380));
    });
  };

  const clearScenario = () => {
    scenarioTimers.current.forEach(window.clearTimeout);
    scenarioTimers.current = [];
  };

  useEffect(
    () => () => {
      chain.current.forEach(window.clearTimeout);
      clearScenario();
    },
    [],
  );

  useEffect(() => {
    try {
      localStorage.setItem(RATE_KEY, String(rate));
    } catch {
      /* 忽略隐私模式 */
    }
  }, [rate]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const before = state.current.seq;
      state.current = advance(state.current, 40 * rate);
      if (clockRef.current) {
        clockRef.current.textContent = `${(state.current.t / 1000).toFixed(2)}s`;
      }
      if (state.current.seq !== before) {
        syncMachine();
        const nodes = document.querySelectorAll<HTMLElement>("[data-flip-id]");
        if (nodes.length && !prefersReduced()) pendingFlip.current = Flip.getState(Array.from(nodes));
        lastSeq.current = state.current.seq;
        commit();
      }
    }, 40);
    return () => window.clearInterval(id);
  }, [rate]);

  useLayoutEffect(() => {
    if (!pendingFlip.current) return;
    const st = pendingFlip.current;
    pendingFlip.current = null;
    Flip.from(st, {
      absolute: true,
      duration: dur(460) || 0.001,
      ease: "power3.inOut",
      stagger: dur(24) || 0,
    });
  });

  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    if (prefersReduced()) {
      animSeq.current = state.current.seq;
      return;
    }
    const fresh = el.querySelectorAll<HTMLElement>("[data-seq]");
    fresh.forEach((n) => {
      if (Number(n.dataset.seq) <= animSeq.current) return;
      gsap.from(n, { opacity: 0, x: -10, duration: dur(260) || 0.001, ease: "power2.out" });
    });
    animSeq.current = state.current.seq;
  });

  const act = (fn: (s: SimState) => SimState) => {
    state.current = fn(state.current);
    syncMachine();
    const nodes = document.querySelectorAll<HTMLElement>("[data-flip-id]");
    if (nodes.length && !prefersReduced()) pendingFlip.current = Flip.getState(Array.from(nodes));
    commit();
  };

  const doReset = () => {
    clearScenario();
    setScenarioNote(null);
    state.current = reset();
    animSeq.current = 0;
    scanSeq.current = 0;
    commit();
  };

  /** 一键场景剧本演练 */
  const runScenario = (kind: "burst-claim" | "fault" | "disconnect") => {
    doReset();
    const waitScale = rate >= 8 ? 160 : 750;
    if (kind === "burst-claim") {
      setScenarioNote("剧本执行中：向 4 张空闲 A800 并发下发混合负载 → 宿主触发 Claim → SIGUSR1 检查点保存与 472ms 归零重排");
      act(enqueueBurst);
      const t1 = window.setTimeout(() => {
        act(activateClaim);
      }, waitScale);
      const t2 = window.setTimeout(() => {
        setScenarioNote("剧本已完成：5 张弹性卡全部归零，4 个任务零丢失安全重排回队列，3 张宿主卡全程零扰动。点击「解除」可恢复全池调度。");
      }, waitScale + (rate >= 8 ? 600 : 1400));
      scenarioTimers.current.push(t1, t2);
    } else if (kind === "fault") {
      setScenarioNote("剧本执行中：下发分片 → 注入 NVML 驱动探针失败 → 节点瞬时 Degraded → 600ms 触发 Fail-Closed Quarantined 熔断");
      act((st) => enqueue(st, "stateless"));
      const t1 = window.setTimeout(() => {
        act(injectNvmlFailure);
      }, 220);
      scenarioTimers.current.push(t1);
    } else {
      setScenarioNote("剧本执行中：分片运行中突发控制面失联 → Agent 本地自治 HardStop 归还 GPU → 有界指数退避重连与 session_id 自愈");
      act((st) => enqueue(st, "checkpointed"));
      const t1 = window.setTimeout(() => {
        act(dropController);
      }, waitScale);
      scenarioTimers.current.push(t1);
    }
  };

  useEffect(() => {
    const offs = [
      onAction(ACTIONS.enqueue, () => act((s) => enqueue(s, "stateless"))),
      onAction(ACTIONS.enqueueCkpt, () => act((s) => enqueue(s, "checkpointed"))),
      onAction(ACTIONS.claim, () => act(activateClaim)),
      onAction(ACTIONS.unclaim, () => act(releaseClaim)),
      onAction(ACTIONS.nvmlFail, () => act(injectNvmlFailure)),
      onAction(ACTIONS.dropConn, () => act(dropController)),
      onAction(ACTIONS.reset, doReset),
    ];
    return () => offs.forEach((o) => o());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = state.current;
  const sum = summary(s);
  const running = s.tasks.filter((t) => t.state === "running");
  const { gpu: picked, setGpu: setPicked } = useGpuFocus();
  const focusedDevice = s.devices[picked] ?? s.devices[2];

  return (
    <Section
      id="sandbox"
      variant="inline"
      eyebrow="全集群交互控制台"
      title={
        <>
          8 × A800 弹性抢占演练台：
          <br className="hidden md:block" />
          亲手按通 472 毫秒闭环。
        </>
      }
      aside={
        <div className="flex items-center gap-2">
          <span className="micro">仿真倍速</span>
          <div className="flex gap-px overflow-hidden border border-line" style={{ borderRadius: "calc(var(--site-radius) - 4px)" }}>
            {[1, 8, 24].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRate(r)}
                aria-pressed={rate === r}
                className={cn(
                  "num px-2.5 py-1.5 text-[13px] transition-colors",
                  rate === r ? "bg-acid text-on-acid font-semibold" : "bg-surface text-muted hover:text-quiet",
                )}
              >
                {r}×
              </button>
            ))}
          </div>
          <Btn onClick={doReset}>
            <ArrowsClockwise size={13} weight="bold" />
            重置
          </Btn>
        </div>
      }
      lede="驱动与 scavenger-core 完全同源的状态机与释放验证逻辑。一键触发多卡并发推理、宿主亚秒级抢占、NVML 探针熔断或控制面断网自愈，上方双状态机将同步电脉冲点亮。"
      className="bg-surface/35"
      wide
    >
      {/* 顶部：一键场景演练栏 */}
      <div className="surface-card reveal mb-5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="pulse-dot size-2 rounded-full bg-acid" aria-hidden="true" />
            <span className="micro text-acid">一键场景演练（GUIDED SCENARIOS）</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => runScenario("burst-claim")}
              className="flex items-center gap-1.5 rounded-md bg-acid px-3.5 py-2 text-[13px] font-semibold text-on-acid transition hover:brightness-110"
            >
              <Play size={13} weight="fill" />
              4 卡并发 + 宿主 472ms 抢占
            </button>
            <button
              type="button"
              onClick={() => runScenario("fault")}
              className="flex items-center gap-1.5 rounded-md border border-warn/45 bg-warn/10 px-3 py-2 text-[13px] font-medium text-warn transition hover:bg-warn/18"
            >
              <ShieldWarning size={13} weight="duotone" />
              NVML 降级熔断演练
            </button>
            <button
              type="button"
              onClick={() => runScenario("disconnect")}
              className="flex items-center gap-1.5 rounded-md border border-cyan/45 bg-cyan-tint/70 px-3 py-2 text-[13px] font-medium text-cyan transition hover:brightness-110"
            >
              <PlugsConnected size={13} weight="duotone" />
              控制面断网自愈演练
            </button>
          </div>
        </div>
        {scenarioNote ? (
          <p className="num mt-3 border-t border-line/70 pt-2.5 text-[12.5px] text-quiet">{scenarioNote}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="space-y-5 xl:col-span-8">
          {/* 原子控制指令簇 */}
          <div className="surface-card reveal flex flex-wrap items-center gap-x-4 gap-y-3 p-3.5">
            <Group label="下发分片">
              <Btn tone="accent" onClick={() => act((st) => enqueue(st, "stateless"))}>
                <Cpu size={14} weight="bold" />
                入队 stateless
              </Btn>
              <Btn tone="accent" onClick={() => act((st) => enqueue(st, "checkpointed"))}>
                <Lightning size={14} weight="bold" />
                入队 checkpointed
              </Btn>
            </Group>
            <Group label="宿主抢占">
              <Btn tone="danger" disabled={s.claim.active} onClick={() => act(activateClaim)}>
                <LightningSlash size={14} weight="bold" />
                激活宿主 Claim
              </Btn>
              <Btn tone="warn" disabled={!s.claim.active} onClick={() => act(releaseClaim)}>
                <ArrowsClockwise size={14} weight="bold" />
                解除
              </Btn>
            </Group>
            <Group label="容灾故障注入">
              <Btn tone="warn" onClick={() => act(injectNvmlFailure)}>
                <ShieldWarning size={14} weight="bold" />
                注入 NVML 失败
              </Btn>
              <Btn onClick={() => act(restoreProbe)}>恢复探针</Btn>
              <Btn tone="danger" disabled={!s.connected} onClick={() => act(dropController)}>
                <PlugsConnected size={14} weight="bold" />
                断开 Controller
              </Btn>
            </Group>
          </div>

          {/* 8×A800 实时机架遥测矩阵面板 */}
          <div className="surface-card reveal p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line/70 pb-3">
              <div className="flex items-center gap-2.5">
                <HardDrives size={18} weight="duotone" className="text-acid" />
                <div>
                  <span className="num text-[14px] font-semibold text-fg">
                    d1n41a25g01 · 8 × A800-SXM4-80GB 实时算力机架
                  </span>
                  <p className="text-[12px] text-muted">
                    5 张弹性算力卡（400 GB）可并发调度 · 3 张宿主正在运行高负载实验（受七元组隔离只读保护）
                  </p>
                </div>
              </div>
              <div className="num flex items-center gap-3 text-[12px]">
                <span className="text-acid">弹性已用 {sum.elasticUsedGiB} GB</span>
                <span className="text-line">|</span>
                <span className="text-quiet">运行中 {sum.running} 分片</span>
              </div>
            </div>

            <div ref={rackRef} className="relative grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <FoxSlotHopper
                containerRef={rackRef}
                activeIndex={picked}
                tone={focusedDevice.externalProcs > 0 ? "warn" : "acid"}
                size={24}
              />
              {s.devices.map((d, idx) => {
                const hostProtected = d.externalProcs > 0;
                const activeTask = s.tasks.find((t) => t.deviceId === d.id && t.state !== "queued" && t.state !== "succeeded");
                const oursMiB = d.taskPids > 0 ? Math.max(0, d.usedMiB - d.baselineUsedMiB) : 0;
                const hostPct = hostProtected ? (d.baselineUsedMiB / TOTAL_MIB) * 100 : 0;
                const ourPct = (oursMiB / TOTAL_MIB) * 100;
                const selected = picked === idx;

                return (
                  <button
                    key={d.id}
                    type="button"
                    data-gpu-slot={idx}
                    onClick={() => setPicked(idx)}
                    aria-pressed={selected}
                    className={cn(
                      "flex flex-col justify-between rounded-md border p-3.5 text-left transition-all",
                      selected
                        ? "border-acid/70 bg-surface-2 shadow-[0_0_0_1px_rgba(215,242,106,0.2)]"
                        : "border-line/80 bg-surface-3/85 hover:border-quiet/40",
                    )}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="num text-[13.5px] font-semibold text-fg">{d.id}</span>
                        {hostProtected ? (
                          <Badge variant="outline" className="num border-warn/40 bg-warn/10 px-1.5 py-0 text-[10px] text-warn">
                            <Lock size={9} weight="bold" className="mr-1" />
                            宿主保护
                          </Badge>
                        ) : activeTask ? (
                          <Badge variant="outline" className="num border-acid/50 bg-acid-tint px-1.5 py-0 text-[10px] text-acid">
                            {READABLE[activeTask.state]}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="num border-cyan/35 bg-cyan-tint/50 px-1.5 py-0 text-[10px] text-cyan">
                            空闲可借
                          </Badge>
                        )}
                      </div>

                      <p className="num mt-1 truncate text-[10.5px] text-muted">{d.uuid}</p>

                      <div className="mt-3 flex items-baseline justify-between">
                        <span className={cn("num text-[16px] font-semibold", hostProtected ? "text-warn" : oursMiB > 0 ? "text-acid" : "text-quiet")}>
                          {Math.round(d.usedMiB).toLocaleString()}
                          <span className="ml-1 text-[11px] font-normal text-muted">MiB</span>
                        </span>
                        <span className="num text-[11px] text-muted">
                          {Math.round((d.usedMiB / TOTAL_MIB) * 100)}%
                        </span>
                      </div>

                      <div className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-surface">
                        {hostProtected ? (
                          <div className="h-full bg-warn/85" style={{ width: `${hostPct}%` }} />
                        ) : (
                          <div
                            className="h-full bg-acid transition-all duration-300"
                            style={{ width: `${Math.max(2, ourPct)}%` }}
                          />
                        )}
                      </div>
                    </div>

                    <div className="mt-3 border-t border-line/60 pt-2 text-[11px]">
                      {hostProtected ? (
                        <span className="num block truncate text-muted">{d.hostLabel ?? "宿主进程 · 只读隔离"}</span>
                      ) : activeTask ? (
                        <span className="num block truncate text-acid">
                          {activeTask.id} · ep={activeTask.leaseEpoch}
                        </span>
                      ) : (
                        <span className="num block text-muted/80">systemd scope idle · 2 MiB 基线</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-3 text-[12.5px]">
              <span className="num text-quiet">
                聚焦设备：<strong className="text-acid">{focusedDevice.id}</strong> ({focusedDevice.uuid})
              </span>
              <span className="text-muted">
                {focusedDevice.externalProcs > 0
                  ? "检测到外部宿主任务占用：控制面仅只读观测，绝不下发信号或停止动作。"
                  : focusedDevice.taskPids > 0
                    ? `由本机 Agent 创建的专属 scope 运行中，显存占用 ${focusedDevice.usedMiB.toLocaleString()} MiB。`
                    : "显存已稳固在 2 MiB 基线，三层能力门禁全部通过，可随时承接下一任务。"}
              </span>
            </div>
          </div>

          {/* 任务账本 */}
          <div ref={panelRef} className="surface-card reveal spot overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 px-4 py-3">
              <span className="micro text-acid">SQLite WAL 持久化任务账本</span>
              <span className="num text-[12px] text-muted">
                queued {sum.queued} · running {sum.running} · succeeded {sum.succeeded} · 可调度 Agent {sum.schedulable}
              </span>
            </div>
            <div className="grid grid-cols-[1.2fr_76px_1.1fr_80px_64px] gap-2 border-b border-line/60 bg-surface-3/60 px-4 py-2">
              {["Task ID", "Policy", "State", "Device", "Lease"].map((h) => (
                <span key={h} className="micro">
                  {h}
                </span>
              ))}
            </div>
            <div className="relative divide-y divide-line/60">
              {s.tasks.length === 0 ? (
                <p className="px-4 py-10 text-center text-[13.5px] text-muted">
                  账本为空。点击上方「4 卡并发 + 宿主 472ms 抢占」剧本或「入队」按钮，即时观察多卡租约下发与回收闭环。
                </p>
              ) : null}
              {[...s.tasks].reverse().map((t) => (
                <div
                  key={t.id}
                  data-flip-id={t.id}
                  className="grid grid-cols-[1.2fr_76px_1.1fr_80px_64px] items-center gap-2 px-4 py-2.5"
                >
                  <span className="num truncate text-[13px] font-medium text-fg">{t.id}</span>
                  <span className="micro text-[11px]">{t.policy}</span>
                  <span
                    className={cn(
                      "num inline-flex w-fit items-center border px-2 py-0.5 text-[11.5px] tracking-[-0.01em]",
                      STATE_TONE[t.state],
                    )}
                    style={{ borderRadius: "calc(var(--site-radius) - 6px)" }}
                  >
                    {READABLE[t.state]}
                  </span>
                  <span className="num text-[12.5px] text-quiet">{t.deviceId ?? "—"}</span>
                  <span className="num text-[12.5px] text-muted">{t.state === "queued" ? "0" : t.leaseEpoch}</span>
                  {t.state === "running" ? (
                    <button
                      type="button"
                      onClick={() => act((st) => commitResult(st, t.id))}
                      className="col-span-full mt-1 flex w-fit items-center gap-1.5 border border-acid/45 bg-acid-tint/60 px-2.5 py-0.5 text-[11.5px] font-medium text-acid hover:brightness-110"
                      style={{ borderRadius: "calc(var(--site-radius) - 6px)" }}
                    >
                      <CheckCircle size={12} weight="bold" />
                      提交 ResultCommit (SHA-256)
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 右侧：实时事件流与遥测读数 */}
        <div className="space-y-5 xl:col-span-4">
          <div className="surface-card reveal overflow-hidden">
            <div className="flex items-center justify-between border-b border-line/70 bg-surface-3/80 px-4 py-3">
              <span className="micro text-acid">实时控制流事件日志</span>
              <span className="num text-[12px] text-muted">
                <span ref={clockRef}>0.00s</span> · seq {s.seq}
              </span>
            </div>
            <div ref={logRef} data-lenis-prevent className="sb-log h-[280px] overflow-y-auto px-4 py-3">
              {s.events.length === 0 ? (
                <div className="flex h-full flex-col justify-between gap-4">
                  <div className="flex gap-2 py-1">
                    <span className="num shrink-0 text-[11.5px] text-muted/60">000</span>
                    <span className="min-w-0 text-[13px] leading-snug text-muted">
                      所有事件按单调 seq 记录。点击带下划线的事件名，将直接跳转上方形式化状态机并脉冲点亮该跳跃迁。
                    </span>
                  </div>
                  <p className="num flex items-center gap-2 text-[12.5px] text-muted/65">
                    <span className="sb-caret inline-block size-2 shrink-0 bg-acid/85" aria-hidden="true" />
                    awaiting lease / claim signal...
                  </p>
                </div>
              ) : null}
              {s.events.map((e) => (
                <div key={e.seq} data-seq={e.seq} className="flex gap-2.5 py-1.5">
                  <span className="num shrink-0 text-[11.5px] text-muted/70">{String(e.seq).padStart(3, "0")}</span>
                  <span className="min-w-0">
                    {isMachineEvent(e.kind) ? (
                      <button
                        type="button"
                        title="跳到状态机点亮这一跳"
                        onClick={() => {
                          scrollToSection("machine");
                          window.setTimeout(() => pulseEvent(e.kind), 620);
                        }}
                        className={cn(
                          "num text-[12.5px] font-medium underline decoration-line decoration-1 underline-offset-4 transition-colors hover:decoration-acid",
                          toneOf(e.tone),
                        )}
                      >
                        {e.kind}
                      </button>
                    ) : (
                      <span className={cn("num text-[12.5px] font-medium", toneOf(e.tone))}>{e.kind}</span>
                    )}
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{e.detail}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="surface-card reveal grid grid-cols-2 gap-x-6 gap-y-5 p-5">
            {[
              { k: "T_detect", v: s.metrics.tDetect, note: "Claim 信号即时捕获", unit: "ms" },
              { k: "T_task_exit", v: s.metrics.tTaskExit, note: "systemd scope 彻底为空", unit: "ms" },
              { k: "T_release", v: s.metrics.tRelease, note: "双采样归零 ReleaseVerified", unit: "ms" },
            ].map((m) => (
              <div key={m.k}>
                <span className="micro">{m.k}</span>
                <div className="mt-1.5 flex items-baseline gap-1">
                  <span className={cn("num text-[24px] font-semibold leading-none tracking-[-0.04em]", m.v ? "text-acid" : "text-muted/45")}>
                    {m.v ?? "—"}
                  </span>
                  <span className="num text-[11.5px] text-muted">{m.unit}</span>
                </div>
                <p className="mt-1.5 text-[11.5px] leading-snug text-muted/80">{m.note}</p>
              </div>
            ))}
            <div>
              <span className="micro">宿主 Claim</span>
              <p className={cn("num mt-1.5 text-[17px] font-semibold", s.claim.active ? "text-danger" : "text-quiet")}>
                {s.claim.active ? "ACTIVE" : "NONE"}
              </p>
              <p className="mt-1.5 text-[11.5px] leading-snug text-muted/80">epoch {s.claim.epoch} · 最高抢占优先级</p>
            </div>
            <div className="col-span-2 border-t border-line/70 pt-3">
              <div className="flex items-center justify-between">
                <span className="micro">mTLS 1.3 控制流状态</span>
                <span className={cn("num text-[13px] font-semibold", s.connected ? "text-cyan" : "text-warn")}>
                  {s.connected ? "ESTABLISHED" : "RECONNECTING"}
                </span>
              </div>
              <p className="num mt-1 text-[11.5px] text-muted">
                退避 {s.backoffMs}ms (上限 {SIM_CONSTANTS.BACKOFF_CAP}ms) · 有界通道容量 {SIM_CONSTANTS.CHANNEL_CAPACITY}
              </p>
            </div>
          </div>

          <div className="surface-card reveal p-5">
            <span className="micro mb-3 block text-acid">Agent 能力画像握手（AgentHello）</span>
            {s.agents.map((a) => (
              <div key={a.id} className="border-t border-line/70 py-3 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="num text-[13.5px] font-semibold text-fg">{a.id}</span>
                  <span
                    className={cn(
                      "num border px-2 py-0.5 text-[11px] font-medium",
                      a.health === "ready"
                        ? "border-acid/45 bg-acid-tint/60 text-acid"
                        : a.health === "degraded"
                          ? "border-warn/45 bg-warn/10 text-warn"
                          : "border-danger/45 bg-danger/10 text-danger",
                    )}
                    style={{ borderRadius: "calc(var(--site-radius) - 6px)" }}
                  >
                    {a.health.toUpperCase()}
                  </span>
                </div>
                <div className="micro mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px]">
                  <span>{a.os}/{a.arch}</span>
                  <span>{a.backend}</span>
                  <span>{a.isolation}</span>
                </div>
                <p className="mt-2 text-[12px] leading-snug text-muted">
                  schedulable={String(a.schedulable)} ·{" "}
                  {a.schedulable
                    ? `管理 ${a.deviceIds.length} 张弹性 A800，全门禁就绪`
                    : "桌面操控终端，只承担远程操作控制面，不承接本地推理任务"}
                </p>
              </div>
            ))}
            {running.length ? (
              <p className="num mt-2 border-t border-line/70 pt-3 text-[12px] text-acid">
                并行运行中：{running.map((t) => `${t.id}@${t.deviceId}`).join(" · ")}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </Section>
  );
}
