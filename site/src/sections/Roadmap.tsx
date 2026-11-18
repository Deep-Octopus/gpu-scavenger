import { useRef } from "react";
import { CheckCircle, Cpu, RocketLaunch } from "@phosphor-icons/react";
import { Section } from "@/src/components/Section";
import { useReveals } from "@/src/lib/motion";
import { ROADMAP, type Track } from "@/src/data/evidence";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STAGE: Record<Track["state"], { badge: string; border: string; iconColor: string; dot: string }> = {
  core: {
    badge: "border-acid/50 bg-acid-tint text-acid",
    border: "border-acid/45",
    iconColor: "text-acid",
    dot: "bg-acid shadow-[0_0_8px_var(--site-accent)]",
  },
  scale: {
    badge: "border-cyan/45 bg-cyan-tint text-cyan",
    border: "border-cyan/35",
    iconColor: "text-cyan",
    dot: "bg-cyan",
  },
  frontier: {
    badge: "border-quiet/30 bg-surface-2 text-quiet",
    border: "border-line",
    iconColor: "text-quiet",
    dot: "bg-quiet",
  },
};

export function Roadmap() {
  const ref = useRef<HTMLElement>(null);
  useReveals(ref);

  return (
    <Section
      id="roadmap"
      sectionRef={ref}
      eyebrow="演进与产业路线"
      title={
        <>
          一套经过形式化验证的核，
          <br className="hidden md:block" />
          从单台 8 卡节点推向万卡异构算力联邦。
        </>
      }
      lede="坚持「语义不变、执行面平滑外扩」原则：状态机与 ReleaseVerifier 从单卡阶段即一次写对，随后无缝复制至整排机柜、容器双引擎、MIG 微切片与跨厂商国产异构卡。"
      className="bg-bg"
    >
      <div className="reveal relative mt-2">
        {/* 横向阶段轴线 */}
        <span
          className="absolute inset-x-0 top-6 hidden h-px bg-gradient-to-r from-acid/75 via-cyan/45 to-line lg:block"
          aria-hidden="true"
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {ROADMAP.map((lane, li) => {
            const st = STAGE[lane.state];
            const Icon = li === 0 ? CheckCircle : li === 1 ? RocketLaunch : Cpu;

            return (
              <div key={lane.state} className={cn("surface-card relative flex flex-col justify-between p-6", st.border)}>
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("num inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", st.badge)}>
                      <span className={cn("size-1.5 rounded-full", st.dot)} aria-hidden="true" />
                      {lane.phase}
                    </span>
                    <Icon size={18} weight="duotone" className={st.iconColor} />
                  </div>

                  <h3 className="mt-4 text-[clamp(1.15rem,2vw,1.45rem)] font-semibold leading-snug tracking-[-0.03em] text-fg">
                    {lane.label}
                  </h3>
                  <div className="mt-1.5 flex items-center justify-between text-[12px]">
                    <span className="text-muted">{lane.horizon}</span>
                    <span className={cn("num font-medium", st.iconColor)}>{lane.metric}</span>
                  </div>

                  <ul className="rows mt-5">
                    {lane.items.map((it) => (
                      <li key={it.title} className="py-3.5 first:pt-2 last:pb-0">
                        <h4 className="text-[14px] font-semibold tracking-[-0.01em] text-fg">{it.title}</h4>
                        <p className="mt-1 text-[13px] leading-relaxed text-muted">{it.body}</p>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-5 border-t border-line/70 pt-3">
                  <Badge variant="outline" className="num border-line bg-surface-3 text-[11px] text-muted">
                    Stage 0{li + 1} · {lane.horizon}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}
