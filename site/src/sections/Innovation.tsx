import { useRef, useState } from "react";
import { ArrowRight, CheckCircle, LightningSlash, ShieldCheck, WarningOctagon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Section } from "@/src/components/Section";
import { flashSection, useReveals } from "@/src/lib/motion";
import { INNOVATIONS } from "@/src/data/evidence";
import { Badge } from "@/components/ui/badge";

type Side = "a" | "b";

export function Innovation() {
  const ref = useRef<HTMLElement>(null);
  useReveals(ref);
  const [focus, setFocus] = useState(INNOVATIONS[0].id);
  const [sides, setSides] = useState<Record<string, Side>>(() =>
    Object.fromEntries(INNOVATIONS.map((i) => [i.id, "b" as Side])),
  );

  const item = INNOVATIONS.find((i) => i.id === focus) ?? INNOVATIONS[0];
  const side = sides[item.id];
  const onA = INNOVATIONS.filter((i) => sides[i.id] === "a").length;

  const setSide = (id: string, next: Side) => setSides((s) => ({ ...s, [id]: next }));
  const flipAll = () =>
    setSides(() =>
      Object.fromEntries(INNOVATIONS.map((i) => [i.id, onA === INNOVATIONS.length ? ("b" as Side) : ("a" as Side)])),
    );

  return (
    <Section
      id="innovation"
      variant="right"
      sectionRef={ref}
      eyebrow="核心技术创新"
      title={<>六大底层架构首创：把「借卡共享」锻造成可证明的安全契约。</>}
      lede="不靠口头约定、不靠祈祷不碰撞。点击左侧任一创新机制，切到反面推演「如果缺少这条底层机制，系统会在哪一毫秒崩盘」。"
      aside={
        <div className="flex items-center gap-3">
          <span className="num text-[12.5px] text-muted">
            已退回传统脆弱路径：<strong className={onA ? "text-danger" : "text-acid"}>{onA}</strong> / {INNOVATIONS.length}
          </span>
          <button
            type="button"
            onClick={flipAll}
            className={cn(
              "surface-card flex items-center gap-2 px-3.5 py-2 text-[13px] font-medium transition-colors active:translate-y-px",
              onA === INNOVATIONS.length
                ? "border-acid/50 text-acid hover:brightness-110"
                : "text-quiet hover:border-danger/50 hover:text-danger",
            )}
          >
            {onA === INNOVATIONS.length ? <ShieldCheck size={14} weight="bold" /> : <LightningSlash size={14} weight="bold" />}
            {onA === INNOVATIONS.length ? "全部恢复 Scavenger 契约" : "模拟全部缺失事故"}
          </button>
        </div>
      }
      className="bg-surface/35"
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* 左侧：六大创新机制列表 */}
        <div className="reveal space-y-2.5 lg:col-span-4">
          {INNOVATIONS.map((i, n) => {
            const s = sides[i.id];
            const on = i.id === focus;
            return (
              <button
                key={i.id}
                type="button"
                onClick={() => setFocus(i.id)}
                className={cn(
                  "surface-card flex w-full items-center justify-between gap-3 p-4 text-left transition-all",
                  on
                    ? s === "a"
                      ? "border-danger/65 bg-danger/10"
                      : "border-acid/65 bg-acid-tint/70 shadow-[0_0_24px_-12px_var(--site-accent)]"
                    : "hover:border-quiet/40",
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={cn(
                      "num flex size-7 shrink-0 items-center justify-center rounded border text-[12px] font-semibold",
                      s === "a"
                        ? "border-danger/50 bg-danger/15 text-danger"
                        : on
                          ? "border-acid/60 bg-acid text-on-acid"
                          : "border-line bg-surface-3 text-muted",
                    )}
                  >
                    0{n + 1}
                  </span>
                  <div className="min-w-0">
                    <span className={cn("block truncate text-[14.5px] font-semibold", on ? "text-fg" : "text-quiet")}>
                      {i.short}
                    </span>
                    <span className="num mt-0.5 block text-[11px] tracking-[0.04em] text-muted">{i.tag}</span>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "num shrink-0 text-[10.5px]",
                    s === "a" ? "border-danger/50 text-danger" : "border-acid/45 text-acid",
                  )}
                >
                  {s === "a" ? "PATH A · 风险" : "PATH B · 安全"}
                </Badge>
              </button>
            );
          })}
        </div>

        {/* 右侧：A/B 架构路径对抗推演对比舞台 */}
        <div className="reveal lg:col-span-8">
          <div className="surface-card p-6 md:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line/70 pb-5">
              <div>
                <span className="micro text-cyan">触发场景 · {item.trigger}</span>
                <h3 className="mt-1.5 text-[clamp(1.25rem,2.4vw,1.75rem)] font-semibold leading-snug tracking-[-0.03em] text-fg">
                  {item.title}
                </h3>
              </div>
              <div className="flex rounded-md border border-line bg-surface-3 p-1">
                <button
                  type="button"
                  onClick={() => setSide(item.id, "b")}
                  className={cn(
                    "rounded-xs px-3 py-1 text-[12.5px] font-medium transition-colors",
                    side === "b" ? "bg-acid text-on-acid font-semibold" : "text-muted hover:text-fg",
                  )}
                >
                  Scavenger 机制
                </button>
                <button
                  type="button"
                  onClick={() => setSide(item.id, "a")}
                  className={cn(
                    "rounded-xs px-3 py-1 text-[12.5px] font-medium transition-colors",
                    side === "a" ? "bg-danger text-bg font-semibold" : "text-muted hover:text-fg",
                  )}
                >
                  传统缺失对比
                </button>
              </div>
            </div>

            {/* 双路并排比较视图 */}
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Path A: 传统脆弱做法 */}
              <div
                onClick={() => setSide(item.id, "a")}
                className={cn(
                  "cursor-pointer rounded-md border p-4 transition-all",
                  side === "a"
                    ? "border-danger/70 bg-danger/10 shadow-[0_0_24px_-12px_var(--danger)]"
                    : "border-line/70 bg-surface-3/65 opacity-65 hover:opacity-95",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="num text-[12px] font-semibold text-danger">{item.a.label}</span>
                  <WarningOctagon size={16} weight="duotone" className="text-danger" />
                </div>
                <pre className="mt-3 overflow-x-auto rounded border border-danger/25 bg-bg/90 p-2.5 text-[11.5px] text-danger">
                  <code className="num">{item.a.code}</code>
                </pre>
                <p className="mt-3 text-[13px] leading-relaxed text-quiet">{item.a.note}</p>
                <div className="mt-4 rounded border border-danger/35 bg-danger/10 px-3 py-2 text-[12px] font-medium text-danger">
                  事故结局：{item.a.outcome}
                </div>
              </div>

              {/* Path B: GPU Scavenger 核心契约 */}
              <div
                onClick={() => setSide(item.id, "b")}
                className={cn(
                  "cursor-pointer rounded-md border p-4 transition-all",
                  side === "b"
                    ? "border-acid/70 bg-acid-tint/65 shadow-[0_0_24px_-12px_var(--site-accent)]"
                    : "border-line/70 bg-surface-3/65 opacity-65 hover:opacity-95",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="num text-[12px] font-semibold text-acid">{item.b.label}</span>
                  <CheckCircle size={16} weight="fill" className="text-acid" />
                </div>
                <pre className="mt-3 overflow-x-auto rounded border border-acid/30 bg-bg/90 p-2.5 text-[11.5px] text-acid">
                  <code className="num">{item.b.code}</code>
                </pre>
                <p className="mt-3 text-[13px] leading-relaxed text-quiet">{item.b.note}</p>
                <div className="mt-4 rounded border border-cyan/40 bg-cyan-tint/70 px-3 py-2 text-[12px] font-medium text-cyan">
                  保障结局：{item.b.outcome}
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-line/70 pt-5">
              <div className="min-w-[16rem] flex-1">
                <span className="micro text-acid">实机基准表现</span>
                <p className="num mt-1.5 text-[12.5px] leading-relaxed text-quiet">{item.proof}</p>
              </div>
              <button
                type="button"
                onClick={() => flashSection(item.see.id)}
                className="group inline-flex items-center gap-2 rounded-md border border-acid/45 bg-acid-tint px-3.5 py-2 text-[13px] font-medium text-acid transition hover:brightness-110"
              >
                {item.see.label}
                <ArrowRight size={13} weight="bold" className="transition-transform group-hover:translate-x-1" />
              </button>
            </div>

            {onA === INNOVATIONS.length ? (
              <p className="num mt-5 rounded-md border border-danger/55 bg-danger/10 p-3.5 text-[12.5px] leading-relaxed text-danger">
                警报：六项底层安全机制全部失效。在没有七元组身份、双采样释放验证与断网自治的情况下，GPU 虽然“能接任务”，却没有任何团队敢将生产实验机器接入共享池。
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </Section>
  );
}
