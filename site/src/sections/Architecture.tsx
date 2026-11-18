import { useRef, useState } from "react";
import {
  ArrowDown,
  ArrowsLeftRight,
  Code,
  Cpu,
  Database,
  Desktop,
  HardDrives,
  Lock,
  ShieldCheck,
} from "@phosphor-icons/react";
import { Section } from "@/src/components/Section";
import { dur, useReveals } from "@/src/lib/motion";
import { ARCH } from "@/src/data/evidence";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const TOTAL_LOC = ARCH.reduce((a, n) => a + n.loc, 0);
const MAX_LOC = Math.max(...ARCH.map((a) => a.loc));

const LAYER_ICONS: Record<string, typeof Cpu> = {
  desktop: Desktop,
  controller: Database,
  protocol: ArrowsLeftRight,
  agent: HardDrives,
  core: Cpu,
};

export function Architecture() {
  const ref = useRef<HTMLElement>(null);
  const [active, setActive] = useState("controller");
  useReveals(ref);
  const cur = ARCH.find((n) => n.id === active) ?? ARCH[1];
  const ActiveIcon = LAYER_ICONS[cur.id] ?? Cpu;

  return (
    <Section
      id="arch"
      variant="inline"
      sectionRef={ref}
      eyebrow="五层解耦架构"
      title={
        <>
          五个高内聚 Crate，一条单向契约：
          <br className="hidden md:block" />
          纯函数内核驱动全集群安全。
        </>
      }
      lede="策略与 I/O 严格物理剥离：scavenger-core 零系统调用、不碰网络与驱动；Agent 仅通过出站 mTLS 双向流主动连接控制面，天然穿透 NAT 与内网防火墙。"
    >
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-10">
        {/* 左栏：五层交互式系统拓扑蓝图 */}
        <div className="reveal lg:col-span-6">
          <div className="surface-card grid-backdrop p-5 md:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-line/70 pb-3">
              <span className="micro text-acid">SYSTEM TOPOLOGY BLUEPRINT · 点击任意层透视契约</span>
              <span className="num text-[12px] text-muted">Total {TOTAL_LOC.toLocaleString()} LOC · 0 unsafe</span>
            </div>

            <div className="space-y-2.5">
              {ARCH.map((node, idx) => {
                const on = node.id === active;
                const Icon = LAYER_ICONS[node.id] ?? Cpu;
                const isProtocol = node.id === "protocol";

                return (
                  <div key={node.id}>
                    <button
                      type="button"
                      onClick={() => setActive(node.id)}
                      aria-pressed={on}
                      className={cn(
                        "group relative flex w-full items-center justify-between gap-4 rounded-md border px-4 py-3.5 text-left transition-all",
                        on
                          ? isProtocol
                            ? "border-cyan/65 bg-cyan-tint/70 shadow-[0_0_26px_-10px_var(--cyan)]"
                            : "border-acid/65 bg-acid-tint/75 shadow-[0_0_26px_-10px_var(--site-accent)]"
                          : "border-line/80 bg-surface-3/85 hover:border-quiet/40 hover:bg-surface",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-3.5">
                        <span
                          className={cn(
                            "flex size-10 shrink-0 items-center justify-center rounded-md border transition-colors",
                            on
                              ? isProtocol
                                ? "border-cyan/55 bg-cyan/15 text-cyan"
                                : "border-acid/55 bg-acid/15 text-acid"
                              : "border-line bg-surface text-quiet group-hover:text-fg",
                          )}
                        >
                          <Icon size={20} weight="duotone" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="num text-[14.5px] font-semibold text-fg">{node.name}</span>
                            <Badge
                              variant="outline"
                              className={cn(
                                "num text-[10.5px]",
                                on
                                  ? isProtocol
                                    ? "border-cyan/45 text-cyan"
                                    : "border-acid/45 text-acid"
                                  : "border-line text-muted",
                              )}
                            >
                              {node.badge}
                            </Badge>
                          </div>
                          <p className="mt-1 truncate text-[12.5px] text-muted">{node.layer}</p>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <span className={cn("num block text-[13px] font-semibold", on ? "text-acid" : "text-quiet")}>
                          {node.loc} <span className="text-[11px] font-normal text-muted">LOC</span>
                        </span>
                        <span className="num mt-0.5 block text-[10.5px] text-muted/80">
                          {Math.round((node.loc / TOTAL_LOC) * 100)}%
                        </span>
                      </div>
                    </button>

                    {idx < ARCH.length - 1 ? (
                      <div className="flex items-center justify-between px-6 py-1 text-[11px] text-muted/80" aria-hidden="true">
                        <div className="flex items-center gap-2">
                          <span className="h-3.5 w-px bg-line" />
                          <ArrowDown size={11} weight="bold" className={on ? "text-acid" : "text-muted/60"} />
                          <span className="num text-[10.5px]">
                            {idx === 0
                              ? "Dynamic Loopback / SSH Tunnel (127.0.0.1:0)"
                              : idx === 1
                                ? "Outbound mTLS 1.3 gRPC · TaskAssign ↓ / Heartbeat ↑"
                                : idx === 2
                                  ? "Typed Protobuf Frame · Monotonic command_seq"
                                  : "Zero-I/O Pure Rust Trait Boundary"}
                          </span>
                        </div>
                        {idx === 1 ? (
                          <span className="num flex items-center gap-1 text-[10.5px] text-cyan">
                            <Lock size={10} weight="bold" />
                            NAT 穿透出站连接
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 右栏：职责不变量 & 真实源码契约双视图检视台 */}
        <aside className="reveal lg:col-span-6">
          <div className="surface-card sticky top-20 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 pb-4">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-md border border-acid/45 bg-acid-tint text-acid">
                  <ActiveIcon size={18} weight="duotone" />
                </span>
                <div>
                  <h3 className="num text-[17px] font-semibold tracking-[-0.02em] text-fg">{cur.name}</h3>
                  <p className="num text-[12px] text-muted">{cur.path}</p>
                </div>
              </div>
              <Badge variant="outline" className="num border-acid/40 bg-acid-tint/60 text-[11px] text-acid">
                {cur.badge}
              </Badge>
            </div>

            <p className="mt-4 text-[14.5px] leading-relaxed text-quiet">{cur.role}</p>

            <Tabs defaultValue="invariants" className="mt-6">
              <TabsList className="grid w-full grid-cols-2 border border-line bg-surface-3">
                <TabsTrigger value="invariants" className="gap-1.5 text-[13px] data-[state=active]:bg-surface-2 data-[state=active]:text-acid">
                  <ShieldCheck size={14} weight="duotone" />
                  架构职责与安全不变量
                </TabsTrigger>
                <TabsTrigger value="code" className="gap-1.5 text-[13px] data-[state=active]:bg-surface-2 data-[state=active]:text-cyan">
                  <Code size={14} weight="duotone" />
                  核心源码与协议契约
                </TabsTrigger>
              </TabsList>

              <TabsContent value="invariants" className="mt-4">
                <ul className="space-y-3">
                  {cur.invariants.map((v, i) => (
                    <li
                      key={v}
                      className="flex items-start gap-3 rounded-md border border-line/70 bg-surface-3/85 p-3.5 text-[13.5px] leading-relaxed text-quiet"
                    >
                      <span className="num mt-0.5 shrink-0 rounded bg-acid-tint px-1.5 py-0.5 text-[11px] font-semibold text-acid">
                        INV-{i + 1}
                      </span>
                      <span>{v}</span>
                    </li>
                  ))}
                </ul>
              </TabsContent>

              <TabsContent value="code" className="mt-4">
                <div className="overflow-hidden rounded-md border border-line bg-surface-3">
                  <div className="flex items-center justify-between border-b border-line/70 px-3.5 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="size-2.5 rounded-full bg-danger/70" />
                      <span className="size-2.5 rounded-full bg-warn/70" />
                      <span className="size-2.5 rounded-full bg-acid/70" />
                      <span className="num ml-2 text-[11.5px] text-muted">{cur.path}</span>
                    </div>
                    <span className="num text-[11px] uppercase text-cyan">{cur.lang}</span>
                  </div>
                  <pre className="overflow-x-auto p-4 text-[12.5px] leading-[1.65] text-quiet">
                    <code className="num">{cur.snippet}</code>
                  </pre>
                </div>
              </TabsContent>
            </Tabs>

            <div className="mt-6 border-t border-line/70 pt-4">
              <div className="flex items-baseline justify-between">
                <span className="micro">模块代码占比</span>
                <span className="num text-[13px] text-quiet">
                  {cur.loc.toLocaleString()} / {TOTAL_LOC.toLocaleString()} 行 Rust & Proto3
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3" role="presentation">
                <div
                  className="h-full origin-left rounded-full bg-acid"
                  style={{
                    transform: `scaleX(${cur.loc / MAX_LOC})`,
                    transition: `transform ${dur(420) || 0.001}s`,
                  }}
                />
              </div>
              <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
                全工作区严格遵守 TigerStyle 与 Fail-Closed 工程规范：0 unsafe 块、0 panic 终止、全部异步通道强制容量上限 32。
              </p>
            </div>
          </div>
        </aside>
      </div>
    </Section>
  );
}
