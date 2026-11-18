import { ArrowSquareOut, GithubLogo, ShieldCheck } from "@phosphor-icons/react";
import { NAV } from "@/src/lib/nav";
import { scrollToSection } from "@/src/lib/motion";
import { HOST } from "@/src/data/evidence";
import { LogoMark } from "@/src/components/Logo";
import { Badge } from "@/components/ui/badge";

const REPO = "https://github.com/Deep-Octopus/gpu-scavenger";

export function SiteFooter() {
  return (
    <footer className="border-t border-line/80 bg-surface-3">
      <div className="mx-auto max-w-[1440px] px-5 py-14 md:px-8">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
          <div className="lg:col-span-6">
            <div className="flex flex-wrap items-center gap-3">
              <LogoMark size={36} />
              <span className="font-display text-[19px] font-bold tracking-[-0.035em] text-fg">
                <span className="text-acid">GPU</span> Scavenger
              </span>
              <Badge variant="outline" className="num border-acid/40 bg-acid-tint text-[11px] text-acid">
                <ShieldCheck size={12} weight="fill" className="mr-1" />
                Apache-2.0 / MIT 双许可开源
              </Badge>
            </div>
            <p className="mt-3.5 max-w-[52ch] text-[14px] leading-relaxed text-muted">
              零侵入宿主优先的弹性 GPU 算力控制平面。让实验室与研发团队闲置的显卡敢全速接活，宿主随时 472ms 确定性收回，并凭七元组内核级边界守住 100% 零误伤。
            </p>
            <p className="mt-2 max-w-[52ch] text-[12.5px] leading-relaxed text-quiet/80">
              图腾：撒哈拉耳廓狐（Fennec）——声呐巨耳 11ms 听见宿主归来，472ms 轻盈退让零误伤。
            </p>
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-5 inline-flex items-center gap-2 rounded-md border border-line bg-surface px-4 py-2 text-[13.5px] font-medium text-quiet transition-colors hover:border-acid/50 hover:text-acid"
            >
              <GithubLogo size={15} weight="duotone" />
              GitHub 源码仓库与全平台 Releases
              <ArrowSquareOut size={13} weight="bold" className="text-muted" />
            </a>
          </div>

          <nav className="lg:col-span-6" aria-label="页面章节">
            <p className="micro mb-4 text-acid">快速索引</p>
            <ul className="grid grid-cols-2 gap-y-2.5 sm:grid-cols-3">
              {NAV.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => scrollToSection(s.id)}
                    className="group flex w-full items-baseline gap-2.5 text-left"
                  >
                    <span className="num shrink-0 text-[12px] text-muted/65">{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-[14px] text-quiet transition-colors group-hover:text-acid">{s.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line/70 pt-6">
          <p className="micro">实证参考节点：{HOST.node}</p>
          <p className="micro">{HOST.gpus}</p>
          <p className="micro">NVIDIA Driver {HOST.driver}</p>
          <p className="micro text-cyan">100% Safe Rust · 0 unsafe</p>
          <p className="micro ml-auto">实测基准 · {HOST.date}</p>
        </div>
      </div>
    </footer>
  );
}
