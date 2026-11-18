import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ChartLineUp,
  CheckCircle,
  Copy,
  Cpu,
  Lightning,
  Lock,
  Package,
  Play,
  ShieldCheck,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { ShaderField } from "@/src/components/ShaderField";
import { FoxSlotHopper } from "@/src/components/FoxSlotHopper";
import { gsap, prefersReduced, scrollToSection, useReveals, useScrambleText, useWordRise } from "@/src/lib/motion";
import { useGpuFocus } from "@/src/lib/focus";
import { HERO_METRICS, HOST, INSTALL_CMD, RELEASE_TIMING as T, SNAPSHOT } from "@/src/data/evidence";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const TOTAL_MIB = 80_000;

const KPI_ICONS = [Lightning, ChartLineUp, ShieldCheck, Package] as const;

function HeroKpi({ item, index }: { item: (typeof HERO_METRICS)[number]; index: number }) {
  const numRef = useRef<HTMLSpanElement>(null);
  const Icon = KPI_ICONS[index];
  useScrambleText(numRef, item.value, { duration: 760, delay: 140 + index * 90 });

  const toneClass =
    item.tone === "cyan" ? "text-cyan" : item.tone === "warn" ? "text-warn" : "text-acid";

  return (
    <div className="surface-card group relative overflow-hidden p-4 transition-transform duration-300 hover:-translate-y-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-quiet">{item.label}</span>
        <Icon size={16} weight="duotone" className={toneClass} />
      </div>
      <div className="mt-2.5 flex items-baseline gap-1">
        <span
          ref={numRef}
          className={cn("num text-[clamp(1.45rem,2.4vw,1.9rem)] font-semibold leading-none tracking-[-0.04em]", toneClass)}
        >
          {item.value}
        </span>
      </div>
      <p className="mt-2 text-[12px] leading-snug text-muted">{item.sub}</p>
    </div>
  );
}

type PreviewPhase = "elastic" | "claiming" | "emptying" | "verified";

function BaseboardShowcase() {
  const { gpu: picked, setGpu: setPicked } = useGpuFocus();
  const [phase, setPhase] = useState<PreviewPhase>("elastic");
  const [simMs, setSimMs] = useState(0);
  const timerRef = useRef<number[]>([]);
  const matrixRef = useRef<HTMLDivElement>(null);

  const clearTimers = () => {
    timerRef.current.forEach(window.clearTimeout);
    timerRef.current = [];
  };

  useEffect(() => () => clearTimers(), []);

  const triggerPreview = () => {
    clearTimers();
    setPhase("claiming");
    setSimMs(T.detectMs);
    if (picked === 0 || picked === 1 || picked === 6) {
      setPicked(2);
    }
    const t1 = window.setTimeout(() => {
      setPhase("emptying");
      setSimMs(T.taskExitMs);
    }, 520);
    const t2 = window.setTimeout(() => {
      setPhase("verified");
      setSimMs(T.releaseMs);
    }, 1050);
    const t3 = window.setTimeout(() => {
      setPhase("elastic");
      setSimMs(0);
    }, 4200);
    timerRef.current.push(t1, t2, t3);
  };

  const initialUsed = SNAPSHOT.initial[picked];
  const isProtectedHost = SNAPSHOT.hostProtectedSlots.includes(picked as 0 | 1 | 6);
  const liveUsed = isProtectedHost
    ? initialUsed
    : phase === "elastic"
      ? 24_576 + initialUsed
      : phase === "claiming"
        ? 24_576 + initialUsed
        : phase === "emptying"
          ? 1_480
          : SNAPSHOT.baseline;

  const pct = Math.min(100, Math.max(1.5, (liveUsed / TOTAL_MIB) * 100));

  const statusMeta = isProtectedHost
    ? {
        badge: "宿主高优先级任务 · 物理只读保护",
        tone: "border-warn/45 bg-warn/10 text-warn",
        barColor: "bg-warn/85",
        desc: "七元组门禁识别为外部宿主进程，控制面严格只读采样，绝对不触碰、不中断。",
      }
    : phase === "claiming"
      ? {
          badge: `ExplicitClaim ${T.detectMs}ms 捕获 · 发送 SIGUSR1`,
          tone: "border-danger/50 bg-danger/12 text-danger",
          barColor: "bg-danger",
          desc: "宿主发起用卡声明，立即冻结新租约并向自有 systemd scope 发送平滑退让信号。",
        }
      : phase === "emptying"
        ? {
            badge: `Scope 进程树清空 ${T.taskExitMs}ms · 等待基线双采样`,
            tone: "border-warn/50 bg-warn/12 text-warn",
            barColor: "bg-warn",
            desc: "systemd scope 与所有衍生子进程已彻底回收，正在执行 ±64 MiB 连续显存采样。",
          }
        : phase === "verified"
          ? {
              badge: `ReleaseVerified ${T.releaseMs}ms · 显存已归零`,
              tone: "border-cyan/55 bg-cyan-tint text-cyan",
              barColor: "bg-cyan",
              desc: "连续 2 次采样确认显存回到 2 MiB 基线，显卡正式交还宿主，原弹性任务安全无损回队。",
            }
          : {
              badge: "弹性算力池可调度 · 正在承接混合分片",
              tone: "border-acid/45 bg-acid-tint text-acid",
              barColor: "bg-acid",
              desc: "三层能力门禁（NVML / 七元组身份 / cgroup v2）全通过，可随时亚秒级归还宿主。",
            };

  return (
    <div className="reveal surface-card relative overflow-hidden">
      {/* 顶部 HUD 状态栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 bg-surface-3/90 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="pulse-dot size-2 rounded-full bg-acid" aria-hidden="true" />
          <span className="num text-[12px] font-medium text-fg">{HOST.node}</span>
          <span className="hidden text-line sm:inline">|</span>
          <span className="num hidden text-[11px] text-muted sm:inline">
            {HOST.totalHbmGiB}GB HBM2e · {HOST.elasticHbmGiB}GB 弹性
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="num border-cyan/35 bg-cyan-tint/80 text-[10.5px] text-cyan">
            mTLS 1.3 · LIVE
          </Badge>
          <button
            type="button"
            onClick={triggerPreview}
            disabled={phase !== "elastic"}
            className="flex items-center gap-1.5 rounded-full border border-acid/45 bg-acid-tint px-2.5 py-0.5 text-[11px] font-medium text-acid transition hover:brightness-110 disabled:opacity-60"
          >
            <Lightning size={11} weight="fill" />
            {phase === "elastic" ? "预览 472ms 还卡" : `抢占中 ${simMs}ms`}
          </button>
        </div>
      </div>

      {/* 高精硬件渲染图 + 遥测 HUD 视窗 */}
      <div className="relative h-[240px] w-full overflow-hidden bg-surface-3 sm:h-[275px]">
        <img
          src="/img/gpu-baseboard.webp"
          alt="8 × NVIDIA A800-SXM4-80GB 节点基板高精度渲染视图"
          className="h-full w-full object-cover object-center opacity-90 transition-transform duration-700 hover:scale-[1.02]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-bg via-bg/25 to-transparent"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-bg/55 via-transparent to-bg/40"
        />

        {/* 左上硬件铭牌 */}
        <div className="absolute left-3.5 top-3.5 flex flex-wrap gap-2">
          <span className="num rounded border border-line/80 bg-bg/92 px-2 py-1 text-[11px] text-quiet">
            NVSwitch 600 GB/s · Driver {HOST.driver}
          </span>
          <span className="num rounded border border-line/80 bg-bg/92 px-2 py-1 text-[11px] text-acid">
            systemd-cgroup-v2
          </span>
        </div>

        {/* 右下实时抢占延迟角标 */}
        <div className="absolute bottom-3.5 right-3.5 rounded-md border border-line/80 bg-bg/92 px-3 py-2">
          <p className="micro text-[10px]">实机闭环时延</p>
          <div className="num mt-0.5 flex items-baseline gap-3 text-[12.5px]">
            <span className="text-quiet">
              Detect <strong className="text-acid">{T.detectMs}ms</strong>
            </span>
            <span className="text-quiet">
              Exit <strong className="text-acid">{T.taskExitMs}ms</strong>
            </span>
            <span className="text-quiet">
              Release <strong className="text-cyan">{T.releaseMs}ms</strong>
            </span>
          </div>
        </div>
      </div>

      {/* 8 槽位实时可交互状态矩阵条 */}
      <div className="border-t border-line/70 bg-surface-3 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="micro text-[10.5px]">8 槽位实时水位矩阵 · 点击切换聚焦设备</span>
          <span className="num text-[11.5px] text-muted">
            <span className="text-acid">● 弹性可借 (5)</span>
            <span className="ml-3 text-warn">● 宿主保护 (3)</span>
          </span>
        </div>
        <div ref={matrixRef} className="relative grid grid-cols-4 gap-1.5 sm:grid-cols-8">
          <FoxSlotHopper
            containerRef={matrixRef}
            activeIndex={picked}
            tone={isProtectedHost ? "warn" : phase === "verified" ? "cyan" : "acid"}
            size={20}
          />
          {SNAPSHOT.initial.map((val, idx) => {
            const host = SNAPSHOT.hostProtectedSlots.includes(idx as 0 | 1 | 6);
            const selected = picked === idx;
            const slotUsed = host
              ? val
              : phase === "elastic" || phase === "claiming"
                ? idx === picked
                  ? 24_578
                  : idx % 2 === 0
                    ? 16_386
                    : 2
                : phase === "emptying"
                  ? idx === picked
                    ? 1_480
                    : 2
                  : 2;
            const barPct = Math.min(100, Math.max(4, (slotUsed / TOTAL_MIB) * 100));

            return (
              <Tooltip key={idx}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-gpu-slot={idx}
                    onClick={() => setPicked(idx)}
                    aria-pressed={selected}
                    className={cn(
                      "flex flex-col gap-1 rounded-md border px-2 py-1.5 text-left transition-all",
                      selected
                        ? host
                          ? "border-warn/70 bg-warn/10 shadow-[0_0_0_1px_rgba(245,185,66,0.25)]"
                          : "border-acid/70 bg-acid-tint shadow-[0_0_0_1px_rgba(215,242,106,0.25)]"
                        : "border-line/70 bg-bg/70 hover:border-muted/60",
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="num text-[11px] font-semibold text-fg">G{idx}</span>
                      {host ? (
                        <Lock size={10} weight="bold" className="text-warn" />
                      ) : (
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            phase === "verified" ? "bg-cyan" : "bg-acid",
                          )}
                        />
                      )}
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
                      <div
                        className={cn(
                          "h-full transition-all duration-300",
                          host ? "bg-warn/80" : phase === "verified" ? "bg-cyan" : "bg-acid",
                        )}
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="border border-line bg-surface-3 text-fg">
                  <span className="num text-[11.5px]">
                    GPU{idx} · {host ? "宿主受保护负载" : "Scavenger 弹性池"} · {Math.round(slotUsed).toLocaleString()} MiB
                  </span>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* 当前聚焦单卡读数 */}
        <div className="mt-3 flex flex-col justify-between gap-3 rounded-md border border-line/70 bg-bg/70 p-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="num text-[14px] font-semibold text-fg">GPU{picked}</span>
              <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", statusMeta.tone)}>
                {statusMeta.badge}
              </span>
            </div>
            <p className="mt-1.5 text-[12.5px] leading-snug text-muted">{statusMeta.desc}</p>
          </div>
          <div className="shrink-0 sm:text-right">
            <div className="num flex items-baseline gap-1 sm:justify-end">
              <span className="text-[22px] font-semibold leading-none tracking-[-0.04em] text-fg">
                {liveUsed.toLocaleString()}
              </span>
              <span className="text-[11.5px] text-muted">/ 80,000 MiB</span>
            </div>
            <div className="mt-1.5 h-1.5 w-36 overflow-hidden rounded-full bg-surface-2 sm:ml-auto">
              <div
                className={cn("h-full transition-all duration-300", statusMeta.barColor)}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Hero() {
  const h1Ref = useRef<HTMLHeadingElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  useWordRise(h1Ref, { delay: 100, stagger: 30 });
  useReveals(rootRef);

  useEffect(() => {
    if (prefersReduced()) return;
    gsap.fromTo(
      "#hero .hero-eyebrow",
      { opacity: 0, y: -8 },
      { opacity: 1, y: 0, duration: 0.65, ease: "power2.out", delay: 0.08 },
    );
  }, []);

  const copyInstall = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_CMD);
      toast.success("Linux 单包一键部署脚本已复制到剪贴板");
    } catch {
      toast.error("剪贴板访问受限，请前往交付章节复制");
    }
  };

  return (
    <section
      id="hero"
      ref={rootRef}
      className="relative isolate flex min-h-[100dvh] items-center overflow-hidden bg-bg pt-16 pb-10"
    >
      <ShaderField className="pointer-events-none absolute inset-0 z-0" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.045]"
        style={{ backgroundImage: "url(/img/grain.jpg)", backgroundSize: "520px" }}
      />

      <div className="relative z-10 mx-auto w-full max-w-[1440px] px-5 py-8 md:px-8 lg:py-12">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-10">
          {/* 左栏：核心命题与行动指令 */}
          <div className="lg:col-span-6">
            <div className="hero-eyebrow mb-6 flex flex-wrap items-center gap-2">
              <span className="glow-badge inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold tracking-[0.05em] sm:text-[11.5px]">
                <Cpu size={13} weight="duotone" />
                HOST-FIRST GPU CONTROL PLANE
              </span>
              <span className="num rounded-full border border-line bg-surface/80 px-2.5 py-1 text-[11.5px] text-quiet">
                8 × A800-SXM4 实机闭环
              </span>
            </div>

            <h1
              ref={h1Ref}
              className="text-[clamp(2.15rem,4.1vw,3.75rem)] font-semibold leading-[1.08] tracking-[-0.04em] text-fg"
            >
              闲置 GPU 全速接活，
              <br />
              <span className="text-acid">宿主归来亚秒还卡。</span>
            </h1>

            <p className="mt-5 max-w-[56ch] text-[15.5px] leading-relaxed text-quiet md:text-[17px]">
              <strong className="font-semibold text-fg">GPU Scavenger</strong>{" "}
              无需 Kubernetes、Slurm 或修改任何训练代码，5.95MB 单包即可将实验室与 AI
              团队沉睡的散装显卡池化为高利用弹性算力网。宿主随时用卡，
              <span className="num font-medium text-acid">472ms</span>{" "}
              确定性归还并完成显存归零双采样，七元组内核级边界守住{" "}
              <span className="num font-medium text-cyan">100% 零误伤</span>。
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => scrollToSection("sandbox")}
                className="group flex items-center gap-2 bg-acid px-5 py-3 text-[14px] font-semibold text-on-acid shadow-[0_0_28px_-6px_var(--site-accent)] transition hover:brightness-110 active:translate-y-px"
                style={{ borderRadius: "var(--site-radius)" }}
              >
                <Play size={15} weight="fill" className="transition-transform group-hover:translate-x-0.5" />
                跑一遍交互控制台
                <ArrowRight size={14} weight="bold" className="opacity-70 transition-transform group-hover:translate-x-0.5" />
              </button>

              <button
                type="button"
                onClick={() => scrollToSection("evidence")}
                className="surface-card flex items-center gap-2 px-5 py-3 text-[14px] font-medium text-fg transition hover:border-acid/50 active:translate-y-px"
              >
                <CheckCircle size={15} weight="duotone" className="text-cyan" />
                实机数据与竞品横评
              </button>

              <button
                type="button"
                onClick={copyInstall}
                className="flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] text-muted transition-colors hover:text-acid"
                title="复制 Linux 5.95MB 一键部署命令"
              >
                <Copy size={14} weight="duotone" />
                <span className="num">5.95MB 一键部署</span>
              </button>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line/70 pt-5 text-[12.5px] text-muted">
              <span className="flex items-center gap-1.5 text-quiet">
                <CheckCircle size={14} weight="duotone" className="text-acid" />
                100% Safe Rust (0 unsafe)
              </span>
              <span className="flex items-center gap-1.5 text-quiet">
                <CheckCircle size={14} weight="duotone" className="text-cyan" />
                SIGUSR1 断点续跑 + SHA-256 校验
              </span>
              <span className="flex items-center gap-1.5 text-quiet">
                <CheckCircle size={14} weight="duotone" className="text-acid" />
                Linux / macOS / Windows 三端协同
              </span>
            </div>
          </div>

          {/* 右栏：8×A800 实机高精数字视窗 */}
          <div className="lg:col-span-6">
            <BaseboardShowcase />
          </div>
        </div>

        {/* 底部 4 项核心指标 KPI 带 */}
        <div className="reveal mt-10 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          {HERO_METRICS.map((item, idx) => (
            <HeroKpi key={item.label} item={item} index={idx} />
          ))}
        </div>
      </div>
    </section>
  );
}
