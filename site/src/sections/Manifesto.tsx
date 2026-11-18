import { useEffect, useRef } from "react";
import { ArrowUpRight } from "@phosphor-icons/react";
import { HOST, VERIFIER, RELEASE_TIMING as T, CODE_STATS, ARTIFACTS } from "@/src/data/evidence";
import { gsap, prefersReduced, scrollToSection, flashSection, useReveals } from "@/src/lib/motion";

const FIGURES = [
  { value: `<${T.detectMs}`, unit: "ms", label: "ExplicitClaim 信号捕获至下发抢占", to: "sandbox" },
  { value: String(T.taskExitMs), unit: "ms", label: "自有 scope 进程树彻底清空", to: "hardware" },
  { value: String(T.releaseMs), unit: "ms", label: "双采样显存归零达成 ReleaseVerified", to: "scrub" },
  { value: `${HOST.elasticHbmGiB}`, unit: "GB", label: "单节点即可释放的弹性 HBM2e 算力池", to: "evidence" },
] as const;

const TRUTHS = [
  `${HOST.gpus} · ${HOST.totalHbmGiB} GB HBM2e Pool`,
  `Driver ${HOST.driver} · ${HOST.os}`,
  "systemd cgroup v2 独占边界隔离",
  "七元组内核级身份门禁 · 100% 零误伤",
  "Fail-Closed 熔断机制 · 异常态秒级 Quarantined",
  "mTLS 1.3 双向认证 · SIGHUP 证书零中断热轮换",
  `控制面断网本地自治 HardStop · ${VERIFIER.reconnectBackoff}`,
  `${CODE_STATS[0].value} 行 Safe Rust · 0 unsafe · 0 panic`,
  `${ARTIFACTS.length} 大跨平台原生发行产物`,
];

export function Manifesto() {
  const ref = useRef<HTMLElement>(null);
  const sweep = useRef<HTMLDivElement>(null);
  useReveals(ref);

  useEffect(() => {
    const el = sweep.current;
    const band = ref.current;
    if (!el || !band || prefersReduced()) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        el,
        { scaleX: 0 },
        {
          scaleX: 1,
          ease: "none",
          scrollTrigger: { trigger: band, start: "top 92%", end: "bottom 30%", scrub: true },
        },
      );
    }, band);
    return () => ctx.revert();
  }, []);

  return (
    <section
      id="manifesto"
      ref={ref}
      aria-label="算力范式宣言"
      className="relative isolate overflow-hidden py-16 md:py-24"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute inset-0 opacity-[0.45]"
          style={{
            backgroundImage:
              "linear-gradient(90deg, color-mix(in oklab, var(--site-border) 42%, transparent) 1px, transparent 1px), linear-gradient(0deg, color-mix(in oklab, var(--site-border) 26%, transparent) 1px, transparent 1px)",
            backgroundSize: "88px 64px",
            maskImage: "radial-gradient(76% 120% at 22% 46%, #000, transparent 72%)",
            WebkitMaskImage: "radial-gradient(76% 120% at 22% 46%, #000, transparent 72%)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(64% 130% at 82% 34%, #d7f26a12, transparent 70%)" }}
        />
      </div>

      <div className="mx-auto max-w-[1600px] px-5 pb-[clamp(2.5rem,7vw,5rem)] md:px-8">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1.06fr_1fr] lg:gap-16">
          <div>
            <p className="micro reveal mb-5 flex items-center gap-2.5 text-acid">
              <span className="h-px w-9 bg-acid" aria-hidden="true" />
              为什么高校实验室与 AI 团队需要它
            </p>
            <h2 className="reveal text-[clamp(2.1rem,5.2vw,4.25rem)] font-semibold leading-[1.04] tracking-[-0.045em] text-fg">
              让沉睡的 75% 算力，
              <br />
              变成随叫随还的
              <br />
              <span className="text-acid">确定性弹性池。</span>
            </h2>
            <p className="reveal mt-6 max-w-[40rem] text-[15px] leading-relaxed text-quiet md:text-[16.5px]" data-delay="80">
              传统 K8s 与 Slurm 太重，脚本抢占又极易误杀宿主训练进程——这就是实验室显卡常年闲置却不敢共享的根源。
              GPU Scavenger 将「借卡、断网自清、显存归零验证」沉淀为轻量级硬核协议，让每张闲置卡既敢全速接活，又能向主人毫秒级履约归还。
            </p>
          </div>

          <div className="relative flex items-center">
            <img
              src="/img/logo-mascot.webp"
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[340px] w-[340px] -translate-x-1/2 -translate-y-1/2 select-none object-contain opacity-[0.045]"
            />
            <ul
              className="reveal grid w-full grid-cols-2 gap-x-8 gap-y-10 self-center pt-6 md:gap-x-14 lg:pt-8"
              data-delay="120"
            >
              {FIGURES.map((f) => (
                <li key={f.label}>
                  <button
                    type="button"
                    onClick={() => {
                      scrollToSection(f.to);
                      flashSection(f.to);
                    }}
                    className="surface-card group block w-full p-5 text-left transition-all hover:border-acid/45"
                  >
                    <span className="flex items-baseline gap-1.5">
                      <span className="ghost-num text-[clamp(2.2rem,4.6vw,3.4rem)] leading-[0.9]">{f.value}</span>
                      <span className="num text-[13px] font-semibold text-acid">{f.unit}</span>
                    </span>
                    <span className="mt-3 flex items-start justify-between gap-2 text-[13px] leading-snug text-quiet transition-colors duration-300 group-hover:text-fg">
                      <span>{f.label}</span>
                      <ArrowUpRight
                        size={14}
                        className="mt-0.5 shrink-0 text-acid opacity-40 transition-all duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100"
                        aria-hidden="true"
                      />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-14 md:mt-16">
          <div className="relative h-px w-full bg-line/70" aria-hidden="true">
            <div ref={sweep} className="absolute inset-y-0 left-0 w-full origin-left bg-acid/75" />
          </div>
          <div className="marquee-mask mt-5 overflow-hidden">
            <p className="sr-only">工程与实机硬核特性：{TRUTHS.join("；")}。</p>
            <div className="marquee" aria-hidden="true">
              {[0, 1].map((track) => (
                <ul key={track} className="flex shrink-0 items-center pr-[6%]">
                  {TRUTHS.map((t) => (
                    <li key={t} className="num flex items-center whitespace-nowrap pr-10 text-[12.5px] text-quiet">
                      <span className="mr-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-acid/85" aria-hidden="true" />
                      {t}
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
