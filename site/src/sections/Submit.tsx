import { useRef, useState } from "react";
import { ArrowRight, ArrowSquareOut, CheckCircle, Copy, DownloadSimple, GithubLogo, Link, PlayCircle } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Section } from "@/src/components/Section";
import { scrollToSection, useReveals } from "@/src/lib/motion";
import { STEPS } from "@/src/data/evidence";
import { ACTIONS, dispatchAction } from "@/src/lib/bus";

const REPO_URL = "https://github.com/Deep-Octopus/gpu-scavenger";
const RELEASES_URL = "https://github.com/Deep-Octopus/gpu-scavenger/releases";

const ROUTE = [
  "打开本页交互演练台（30 秒零环境体验）",
  "点击「4 卡并发 + 宿主 472ms 抢占」或入队分片",
  "观察 5 张空闲 A800 并发分配租约，3 张宿主卡纹丝不动",
  "触发宿主 Claim，目睹 SIGUSR1 检查点与 339ms 边界清空",
  "472ms 显存归零 ReleaseVerified，任务无损安全回队",
];

export function Submit() {
  const ref = useRef<HTMLElement>(null);
  const [urlCopied, setUrlCopied] = useState(false);
  useReveals(ref);

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      if (what === "url") setUrlCopied(true);
      toast.success("已复制到剪贴板");
      window.setTimeout(() => setUrlCopied(false), 2000);
    } catch {
      toast.error("浏览器拒绝了剪贴板访问，请手动选择文本");
    }
  };

  const quickDemo = () => {
    scrollToSection("sandbox");
    window.setTimeout(() => {
      dispatchAction(ACTIONS.reset);
      dispatchAction(ACTIONS.enqueue);
      dispatchAction(ACTIONS.enqueueCkpt);
    }, 520);
  };

  return (
    <Section
      id="submit"
      variant="right"
      sectionRef={ref}
      eyebrow="快速上手"
      title={<>5 分钟部署真实集群，30 秒在浏览器完成完整推演。</>}
      lede="无需配置 Kubernetes 或改造现有训练框架。按下方五步即可将实验室与团队的闲置显卡安全并网，或直接在浏览器中零门槛体验完整抢占闭环。"
      className="bg-surface/35"
    >
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-10">
        <ol className="space-y-3 lg:col-span-7">
          {STEPS.map((s, i) => (
            <li key={s.verb} className="surface-card reveal group grid grid-cols-[48px_1fr] items-start gap-4 p-5 transition-colors hover:border-acid/45">
              <span className="num flex size-10 items-center justify-center rounded-md border border-line bg-surface-3 text-[15px] font-semibold text-acid transition-colors group-hover:border-acid/60 group-hover:bg-acid-tint">
                0{i + 1}
              </span>
              <div>
                <h3 className="text-[clamp(1rem,1.8vw,1.2rem)] font-semibold tracking-[-0.025em] text-fg">{s.verb}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="space-y-5 lg:col-span-5">
          <div className="surface-card reveal p-6">
            <span className="micro flex items-center gap-2 text-acid">
              <PlayCircle size={15} weight="duotone" />
              30 秒零环境交互体验
            </span>
            <ol className="mt-4 space-y-2.5">
              {ROUTE.map((r, i) => (
                <li key={r} className="flex items-start gap-3 text-[13.5px] leading-relaxed text-quiet">
                  <CheckCircle size={14} weight="duotone" className="mt-1 shrink-0 text-cyan" />
                  <span>
                    <span className="num mr-1.5 text-[12px] text-muted">{i + 1}.</span>
                    {r}
                  </span>
                </li>
              ))}
            </ol>
            <button
              type="button"
              onClick={quickDemo}
              className="mt-5 flex w-full items-center justify-center gap-2 bg-acid px-4 py-3 text-[14px] font-semibold text-on-acid shadow-[0_0_24px_-8px_var(--site-accent)] transition hover:brightness-110 active:translate-y-px"
              style={{ borderRadius: "calc(var(--site-radius) - 2px)" }}
            >
              <PlayCircle size={16} weight="fill" />
              直达演练台并自动入队双策略任务
              <ArrowRight size={14} weight="bold" />
            </button>
          </div>

          <div className="surface-card reveal p-6">
            <span className="micro flex items-center gap-2 text-cyan">
              <GithubLogo size={15} weight="duotone" />
              获取 GPU Scavenger
            </span>
            <ul className="mt-4 space-y-2.5 text-[13.5px]">
              {[
                { label: "开源协议", value: "Apache-2.0 / MIT 双许可" },
                { label: "支持平台", value: "Linux x86_64 · macOS · Windows" },
                { label: "部署形态", value: "5.95 MB 单二进制 · 零容器依赖" },
              ].map((m) => (
                <li key={m.label} className="flex items-baseline justify-between gap-3 border-b border-line/60 pb-2.5 last:border-0">
                  <span className="micro shrink-0">{m.label}</span>
                  <span className="num truncate text-right text-[12px] text-quiet">{m.value}</span>
                </li>
              ))}
            </ul>

            <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center justify-center gap-2 rounded-md border border-acid/45 bg-acid-tint/70 px-3.5 py-2.5 text-[13px] font-medium text-acid transition hover:brightness-110"
              >
                <GithubLogo size={15} weight="duotone" />
                <span>GitHub 仓库</span>
                <ArrowSquareOut size={12} weight="bold" />
              </a>
              <a
                href={RELEASES_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center justify-center gap-2 rounded-md border border-line bg-surface-3 px-3.5 py-2.5 text-[13px] font-medium text-quiet transition hover:border-cyan/50 hover:text-cyan"
              >
                <DownloadSimple size={15} weight="duotone" />
                <span>下载 v0.1.0</span>
                <ArrowSquareOut size={12} weight="bold" />
              </a>
            </div>

            <button
              type="button"
              onClick={() => void copy(origin, "url")}
              className="mt-3 flex w-full items-center gap-2 border border-line bg-surface-3 px-3 py-2.5 text-left transition-colors hover:border-acid/45"
              style={{ borderRadius: "calc(var(--site-radius) - 4px)" }}
              title="复制项目主页链接"
            >
              <Link size={13} weight="bold" className="shrink-0 text-acid" />
              <span className="num min-w-0 flex-1 truncate text-[12.5px] text-quiet">{origin || "项目主页链接"}</span>
              <Copy size={13} weight="bold" className="shrink-0 text-muted" />
            </button>
            <p className="mt-2.5 text-[12px] leading-relaxed text-muted">
              {urlCopied ? "项目主页地址已复制，欢迎分享给团队伙伴。" : "点击复制项目主页链接，或按 ⌘K 呼出快捷命令面板。"}
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}
