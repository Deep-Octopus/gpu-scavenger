import { useRef, useState } from "react";
import {
  ArrowsCounterClockwise,
  ChartBar,
  Cpu,
  Lock,
  ShieldCheck,
  ShieldWarning,
  TerminalWindow,
  WarningOctagon,
} from "@phosphor-icons/react";
import { Section } from "@/src/components/Section";
import { gsap, prefersReduced, useReveals } from "@/src/lib/motion";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const DANGERS = [
  {
    id: "mem",
    icon: ChartBar,
    tag: "COLLATERAL KILL",
    signal: "按显存峰值清理",
    cmd: "$ kill -9 $(top_vram_pid)",
    failure: "误杀邻居正在运行的 69.7 GiB DDP 主训练进程",
    breaks: "单卡或同机多进程共享显存空间，最大占用者往往是机器主人或合作者的重要实验。",
  },
  {
    id: "pid",
    icon: ArrowsCounterClockwise,
    tag: "PID WRAP RACE",
    signal: "按单个 PID 追踪终止",
    cmd: "$ kill -9 30211  # 已回绕复用",
    failure: "PID 30211 已被内核分配给宿主 sshd 守护进程",
    breaks: "进程退出与管理动作之间存在毫秒级时间窗，PID 编号被 Linux 内核复用后必触发误杀。",
  },
  {
    id: "name",
    icon: TerminalWindow,
    tag: "BLAST RADIUS",
    signal: "按进程名通配匹配",
    cmd: "$ pkill -f 'python.*train'",
    failure: "同时击毁同机 4 个无关 Python 训练与推理作业",
    breaks: "AI 工作站上 python / torchrun / vllm 进程名撞车概率接近 100%，极易造成全机雪崩。",
  },
  {
    id: "index",
    icon: Cpu,
    tag: "INDEX DRIFT",
    signal: "按 GPU Index 序号定位",
    cmd: "$ CUDA_VISIBLE_DEVICES=2",
    failure: "驱动热更新或重启后 Index 2 漂移至另一块物理卡",
    breaks: "PCIe 枚举顺序与 MIG 配置变更都会重写逻辑序号，仅凭数字下标极易指错目标硬件。",
  },
] as const;

const TUPLE = [
  {
    key: "task_id",
    source: "SQLite WAL 主键",
    note: "精确绑定控制面下发的唯一任务切片，彻底隔离跨批次重排产生的迟到事件。",
  },
  {
    key: "lease_epoch",
    source: "单调递增租约纪元",
    note: "断线重连后旧连接的延迟 ACK 会被 lease_epoch 守卫瞬间拒止，绝不伤害新租约。",
  },
  {
    key: "pid",
    source: "/proc/<pid>",
    note: "仅作为基础定位索引，必须与 start_time_ticks、uid 及 cgroup 同时对齐才生效。",
  },
  {
    key: "process_start_time",
    source: "/proc/<pid>/stat[22]",
    note: "锁定内核 jiffies 启动时钟滴答，从数学上根除 PID 回绕复用导致的身份冒认。",
  },
  {
    key: "uid",
    source: "Linux Cred / UID",
    note: "强校验进程属主身份，在多用户共用工作站上将外部研究者的进程隔离在作用域外。",
  },
  {
    key: "cgroup_id",
    source: "cgroup2fs inode",
    note: "停止信号直接投递至 Agent 亲手创建的 systemd scope，fork/setsid 子树全清。",
  },
  {
    key: "device_uuid",
    source: "NVML 物理 GPU UUID",
    note: "绑定不可变的出厂硬件指纹 GPU-524bcc1c…，无视驱动升级或总线重排导致的序号漂移。",
  },
] as const;

export function Problem() {
  const ref = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const [missing, setMissing] = useState<number | null>(null);
  useReveals(ref);

  const pick = (i: number | null) => {
    setMissing(i);
    const el = detailRef.current;
    if (!el || prefersReduced()) return;
    gsap.fromTo(el, { opacity: 0.4, y: 6 }, { opacity: 1, y: 0, duration: 0.28, ease: "power2.out" });
  };

  const open = missing === null;

  return (
    <Section
      id="problem"
      sectionRef={ref}
      eyebrow="核心安全痛点"
      title={
        <>
          借出闲置算力不难，难的是
          <br className="hidden md:block" />
          亚秒撤退时绝不误伤宿主一根汗毛。
        </>
      }
      lede="共享 GPU 迟迟无法落地的最大障碍不是调度算法，而是「信任赤字」。传统清理脚本依赖单一脆弱信号，在真实生产环境中屡屡引发误杀灾难。"
      className="bg-surface/35"
    >
      <div>
        {/* 上半部：四大传统清理事故现场 */}
        <div className="reveal grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {DANGERS.map((d, i) => {
            const Icon = d.icon;
            return (
              <div
                key={d.id}
                className="surface-card group flex flex-col justify-between p-5 transition-all duration-300 hover:border-danger/45"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex size-9 items-center justify-center rounded-md border border-danger/30 bg-danger/10 text-danger">
                      <Icon size={18} weight="duotone" />
                    </span>
                    <Badge variant="outline" className="num border-danger/35 bg-danger/8 text-[10.5px] text-danger">
                      {d.tag}
                    </Badge>
                  </div>
                  <h3 className="mt-4 text-[16px] font-semibold tracking-[-0.02em] text-fg">{d.signal}</h3>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{d.breaks}</p>
                </div>

                <div className="mt-4 rounded-md border border-line/80 bg-surface-3 p-3">
                  <div className="flex items-center justify-between text-[11px] text-muted">
                    <span className="num">{d.cmd}</span>
                    <span className="num text-muted/60">0{i + 1}</span>
                  </div>
                  <p className="mt-2 flex items-start gap-1.5 text-[12px] font-medium leading-snug text-danger">
                    <WarningOctagon size={14} weight="fill" className="mt-0.5 shrink-0" />
                    <span>{d.failure}</span>
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* 下半部：七元组内核级身份门禁联锁控制台 */}
        <div className="surface-card reveal mt-10 p-6 md:p-8">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line/70 pb-5">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck size={18} weight="duotone" className="text-acid" />
                <h3 className="text-[18px] font-semibold tracking-[-0.02em] text-fg">
                  GPU Scavenger 解法：七元组内核级身份门禁（7-Tuple Gate）
                </h3>
              </div>
              <p className="mt-1.5 max-w-[60ch] text-[14px] leading-relaxed text-quiet">
                所有字段必须在内核与控制面双重全等验证通过，才允许对专属 systemd scope 下发停止指令。点击任意字段或注入故障测试 Fail-Closed 拦截：
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => pick(null)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                  open
                    ? "border-acid/60 bg-acid-tint text-acid"
                    : "border-line bg-surface-3 text-quiet hover:border-acid/40",
                )}
              >
                7/7 全匹配放行
              </button>
              <button
                type="button"
                onClick={() => pick(3)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                  missing === 3
                    ? "border-danger/60 bg-danger/12 text-danger"
                    : "border-line bg-surface-3 text-muted hover:border-danger/45 hover:text-danger",
                )}
              >
                模拟 PID 回绕攻击
              </button>
              <button
                type="button"
                onClick={() => pick(1)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                  missing === 1
                    ? "border-danger/60 bg-danger/12 text-danger"
                    : "border-line bg-surface-3 text-muted hover:border-danger/45 hover:text-danger",
                )}
              >
                模拟过期租约指令
              </button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-8">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
                {TUPLE.map((t, i) => {
                  const isBad = missing === i;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => pick(isBad ? null : i)}
                      aria-pressed={isBad}
                      data-bad={isBad ? "1" : "0"}
                      className={cn(
                        "gate-slot flex flex-col justify-between rounded-md border p-3 text-left transition-all",
                        isBad
                          ? "border-danger/65 bg-danger/10 text-danger"
                          : "border-line/80 bg-surface-3/85 text-quiet hover:border-acid/50 hover:text-fg",
                      )}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className={cn("size-2 rounded-full", isBad ? "bg-danger" : "bg-acid shadow-[0_0_8px_var(--site-accent)]")}
                            aria-hidden="true"
                          />
                          <span className="num text-[10px] uppercase text-muted/80">
                            {isBad ? "MISMATCH" : "PASS"}
                          </span>
                        </div>
                        <span className="num mt-2.5 block break-all text-[12px] font-semibold leading-tight">
                          {t.key}
                        </span>
                      </div>
                      <span className="mt-3 block text-[10.5px] leading-tight text-muted">{t.source}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 flex items-center gap-3">
                <span className="hair flex-1" aria-hidden="true" />
                <span className="micro text-quiet">AND 硬件逻辑联锁门</span>
                <span className="hair flex-1" aria-hidden="true" />
              </div>

              <div
                className={cn(
                  "mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3.5 transition-colors duration-300",
                  open ? "border-acid/55 bg-acid-tint" : "border-danger/55 bg-danger/10",
                )}
              >
                <div className="flex items-center gap-2.5">
                  {open ? (
                    <ShieldCheck size={18} weight="fill" className="text-acid" />
                  ) : (
                    <ShieldWarning size={18} weight="fill" className="text-danger" />
                  )}
                  <span className={cn("num text-[13.5px] font-semibold", open ? "text-acid" : "text-danger")}>
                    {open
                      ? "GATE OPEN · STOP → gpu-scavenger-<task>.scope"
                      : `FAIL-CLOSED · 检测到「${TUPLE[missing].key}」异常，拒绝执行终止`}
                  </span>
                </div>
                <span className="num text-[12px] text-quiet">
                  {open ? "same_process() == true" : "Result::Err(IdentityMismatch)"}
                </span>
              </div>
            </div>

            <div className="lg:col-span-4">
              <div
                ref={detailRef}
                className="flex h-full flex-col justify-between rounded-md border border-line/80 bg-surface-3/90 p-5"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="micro text-acid">
                      {missing === null ? "7/7 身份契约锁定" : `失配项 · ${TUPLE[missing].key}`}
                    </span>
                    <Lock size={14} weight="duotone" className={open ? "text-acid" : "text-danger"} />
                  </div>
                  <p className="mt-3 text-[15px] font-medium leading-relaxed text-fg">
                    {missing === null
                      ? "七个内核与协议维度的指纹完全对齐。停止指令严格收敛在专属 cgroup scope 内，同卡或同机上的宿主进程永不被触及。"
                      : TUPLE[missing].note}
                  </p>
                </div>

                <div className="mt-5 border-t border-line/70 pt-4">
                  <div className="mb-2 flex items-center justify-between text-[11.5px]">
                    <span className="num text-muted">Rust Core 身份校验比特位</span>
                    <span className={cn("num font-semibold", open ? "text-acid" : "text-danger")}>
                      {open ? "1111111" : TUPLE.map((_, idx) => (missing === idx ? "0" : "1")).join("")}
                    </span>
                  </div>
                  <div className="grid grid-cols-7 gap-1.5">
                    {TUPLE.map((t, i) => (
                      <span
                        key={t.key}
                        className={cn(
                          "h-2 rounded-xs transition-colors",
                          missing === i ? "bg-danger" : "bg-acid/75",
                        )}
                        aria-hidden="true"
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
