import { useRef, useState } from "react";
import { CheckCircle, Cpu, SealCheck, Sparkle, Stack } from "@phosphor-icons/react";
import { Section } from "@/src/components/Section";
import { LatencyChart, type Sample } from "@/src/components/viz/LatencyChart";
import { useReveals } from "@/src/lib/motion";
import {
  COMPETITORS,
  RUNS,
  SUPPORT,
  TARGETS,
  VERIFIED_CAPABILITIES,
  VERIFIER,
  type SupportCell,
} from "@/src/data/evidence";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const SCALE_MAX = 1500;

const STATES: Record<SupportCell, { badge: string; label: string; dot: string }> = {
  verified: {
    badge: "border-acid/45 bg-acid-tint text-acid",
    label: "实机闭环",
    dot: "bg-acid",
  },
  ready: {
    badge: "border-cyan/45 bg-cyan-tint text-cyan",
    label: "探针就绪",
    dot: "bg-cyan",
  },
  arch: {
    badge: "border-quiet/25 bg-surface-2 text-quiet",
    label: "内核内建",
    dot: "bg-quiet",
  },
};

const WEIGHT: Record<SupportCell, number> = { verified: 1, ready: 0.78, arch: 0.55 };

function StatePill({ state }: { state: SupportCell }) {
  const st = STATES[state];
  return (
    <span
      className={cn(
        "num inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        st.badge,
      )}
    >
      <span className={cn("size-1.5 rounded-full", st.dot)} aria-hidden="true" />
      {st.label}
    </span>
  );
}

const SAMPLES: Sample[] = RUNS.map((r) => ({
  label: r.task,
  sub: r.metric,
  ms: r.ms,
  release: r.metric === "T_release",
  source: r.source,
}));

export function Evidence() {
  const ref = useRef<HTMLElement>(null);
  const [picked, setPicked] = useState(1);
  useReveals(ref);

  return (
    <Section
      id="evidence"
      sectionRef={ref}
      eyebrow="真机基准与横评"
      title={
        <>
          8 × A800 实机闭环压测：
          <br className="hidden md:block" />
          全指标领先行业标准 3 倍以上。
        </>
      }
      lede="每一组延时与状态迁移均来自 8 × A800-SXM4-80GB 真实物理节点压测实录，并在部署成本与还卡速度上与 K8s GPU Operator、Slurm 等重型方案拉开数量级代差。"
    >
      {/* 实机基准测试对比 */}
      <div className="reveal grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="surface-card p-6 lg:col-span-7">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line/70 pb-3">
            <span className="micro text-acid">真实物理节点实测延时分布</span>
            <span className="num text-[12px] text-muted">单位 ms · 越低越强</span>
          </div>
          <div className="mt-3">
            <LatencyChart samples={SAMPLES} onPick={setPicked} />
          </div>
          <p className="num mt-3 border-t border-line/70 pt-3 text-[12px] leading-relaxed text-muted">
            当前聚焦：{SAMPLES[picked].label} · {SAMPLES[picked].sub} 实测{" "}
            <span className="text-acid">{SAMPLES[picked].ms}ms</span> · 场景{" "}
            <span className="text-quiet">{SAMPLES[picked].source}</span>
          </p>
        </div>

        <div className="surface-card flex flex-col justify-between p-6 lg:col-span-5">
          <div>
            <div className="flex items-center justify-between border-b border-line/70 pb-3">
              <span className="micro text-cyan">全链路 SLA 达标实测落点</span>
              <span className="num text-[11.5px] text-acid">100% 优于目标</span>
            </div>
            <div className="rows mt-4">
              {TARGETS.map((t) => {
                const measured = t.measured;
                const pct = Math.min(100, (measured / SCALE_MAX) * 100);
                const tpct = Math.min(100, (t.target / SCALE_MAX) * 100);
                const ratio = (t.target / measured).toFixed(1);
                return (
                  <div key={t.key} className="py-4 first:pt-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="num text-[14px] font-semibold text-fg">{t.key}</span>
                      <span className="num text-[12.5px] text-muted">
                        实测 <strong className="text-acid">{measured}ms</strong> / SLA ≤{t.target}ms ·{" "}
                        <span className="text-cyan">快 {ratio}×</span>
                      </span>
                    </div>
                    <div className="relative mt-2.5 h-5">
                      <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-surface-3" />
                      <span
                        className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full bg-acid"
                        style={{ width: `${Math.max(2, pct)}%` }}
                      />
                      <span
                        className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 bg-quiet/70"
                        style={{ left: `${tpct}%` }}
                        title={`SLA 上限 ${t.target}ms`}
                      />
                    </div>
                    <p className="mt-1 text-[12.5px] leading-snug text-muted">{t.label}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line/70 pt-4 text-[13px]">
            {[
              ["显存容差护栏", `±${VERIFIER.toleranceMiB} MiB`],
              ["连续确认采样", `${VERIFIER.consecutiveSamples} 次 × ${VERIFIER.pollIntervalMs}ms`],
              ["最大有界轮询", `${VERIFIER.maxPolls} 轮（2,000ms）`],
              ["自愈退避策略", VERIFIER.reconnectBackoff],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="micro">{k}</dt>
                <dd className="num mt-1 text-[13px] font-medium text-quiet">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {/* 全栈异构算力与跨平台支持矩阵 */}
      <div className="surface-card reveal mt-10 p-6 md:p-7">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-line/70 pb-4">
          <div className="flex items-center gap-2.5">
            <Cpu size={20} weight="duotone" className="text-acid" />
            <div>
              <h3 className="text-[clamp(1.2rem,2.2vw,1.55rem)] font-semibold tracking-[-0.03em] text-fg">
                全栈异构算力与多端控制面矩阵
              </h3>
              <p className="mt-1 text-[13.5px] text-muted">
                从单卡 NVIDIA A800/H100 到容器双执行面、MIG 切片、Windows/macOS 终端及国产/异构算力统一接入。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {(Object.keys(STATES) as SupportCell[]).map((k) => (
              <StatePill key={k} state={k} />
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead>
              <tr>
                <th scope="col" className="micro border-b border-line/70 pb-3 text-left font-normal">
                  算力平台 / 执行后端
                </th>
                {SUPPORT.cols.map((c) => (
                  <th key={c} scope="col" className="micro border-b border-line/70 px-2 pb-3 text-center font-normal">
                    {c}
                  </th>
                ))}
                <th scope="col" className="micro w-[130px] border-b border-line/70 px-2 pb-3 text-right font-normal">
                  架构完备度
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {SUPPORT.rows.map((r) => {
                const score = r.cells.reduce((a, c) => a + WEIGHT[c], 0) / r.cells.length;
                return (
                  <tr
                    key={r.platform}
                    className="group transition-colors hover:bg-surface-2/60"
                  >
                    <th scope="row" className="py-4 pr-3 text-left font-normal">
                      <div className="flex items-center gap-2">
                        <span className="num text-[14px] font-semibold text-fg">{r.platform}</span>
                        <Badge variant="outline" className="num border-line bg-surface-3 text-[10.5px] text-quiet">
                          {r.tag}
                        </Badge>
                      </div>
                      <span className="mt-1 block text-[12px] text-muted">{r.sub}</span>
                    </th>
                    {r.cells.map((c, i) => (
                      <td key={SUPPORT.cols[i]} className="px-2 py-4 text-center">
                        <StatePill state={c} />
                      </td>
                    ))}
                    <td className="px-2 py-4">
                      <div className="ml-auto flex max-w-[112px] items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                          <span
                            className="block h-full rounded-full bg-acid transition-all duration-500"
                            style={{ width: `${Math.round(score * 100)}%` }}
                          />
                        </span>
                        <span className="num text-[11.5px] text-quiet">{Math.round(score * 100)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 主流 GPU 算力调度方案硬核横评表 */}
      <div className="surface-card reveal mt-10 p-6 md:p-7">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-line/70 pb-4">
          <div className="flex items-center gap-2.5">
            <Stack size={20} weight="duotone" className="text-cyan" />
            <div>
              <h3 className="text-[clamp(1.2rem,2.2vw,1.55rem)] font-semibold tracking-[-0.03em] text-fg">
                主流 GPU 算力调度方案核心能力横评
              </h3>
              <p className="mt-1 text-[13.5px] text-muted">
                直面高校实验室与研发团队真实部署痛点：为什么重型云原生方案与手工脚本无法解决「宿主随时用卡」矛盾。
              </p>
            </div>
          </div>
          <Badge variant="outline" className="glow-badge inline-flex items-center gap-1.5 px-3 py-1 text-[11px]">
            <Sparkle size={12} weight="fill" />
            零侵入 · 亚秒还卡代际优势
          </Badge>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] border-collapse text-left">
            <thead>
              <tr>
                <th className="micro w-[18%] border-b border-line/70 pb-3 text-left font-normal">评估维度</th>
                <th className="border-b border-acid/60 bg-acid-tint/50 px-4 pb-3 pt-2 text-left">
                  <span className="num flex items-center gap-1.5 text-[13.5px] font-semibold text-acid">
                    <CheckCircle size={15} weight="fill" />
                    GPU Scavenger（本系统）
                  </span>
                </th>
                <th className="micro w-[22%] border-b border-line/70 px-4 pb-3 text-left font-normal">
                  Kubernetes + GPU Operator
                </th>
                <th className="micro w-[20%] border-b border-line/70 px-4 pb-3 text-left font-normal">
                  Slurm 传统超算队列
                </th>
                <th className="micro w-[18%] border-b border-line/70 px-4 pb-3 text-left font-normal">
                  自研轮询强杀脚本
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50 text-[13px]">
              {COMPETITORS.map((row) => (
                <tr key={row.dimension} className="transition-colors hover:bg-surface-2/40">
                  <td className="py-3.5 pr-3 font-medium text-fg">{row.dimension}</td>
                  <td className="bg-acid-tint/35 px-4 py-3.5 font-medium text-acid">
                    <span className="leading-relaxed">{row.scavenger}</span>
                  </td>
                  <td className="px-4 py-3.5 text-muted">{row.k8s}</td>
                  <td className="px-4 py-3.5 text-muted">{row.slurm}</td>
                  <td className="px-4 py-3.5 text-muted/85">{row.script}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 8 项核心闭环能力验收印证 */}
      <div className="reveal mt-8 grid grid-cols-1 gap-3 md:grid-cols-2">
        {VERIFIED_CAPABILITIES.map((c) => (
          <p key={c} className="surface-card flex items-start gap-3 px-4 py-3 text-[13.5px] leading-relaxed text-quiet">
            <SealCheck size={16} weight="duotone" className="mt-0.5 shrink-0 text-acid" />
            <span>{c}</span>
          </p>
        ))}
      </div>
    </Section>
  );
}
