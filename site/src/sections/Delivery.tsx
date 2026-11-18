import { useRef, useState } from "react";
import { Check, Copy, FileArrowDown, ShieldCheck, Stack, TerminalWindow } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Section } from "@/src/components/Section";
import { useReveals, useSpotlight } from "@/src/lib/motion";
import { ARTIFACTS, CODE_STATS, HOST, INSTALL_CMD } from "@/src/data/evidence";
import { Badge } from "@/components/ui/badge";

function StatCell({ stat }: { stat: (typeof CODE_STATS)[number] }) {
  const ref = useRef<HTMLDivElement>(null);
  useSpotlight(ref);
  return (
    <div ref={ref} className="surface-card spot relative p-4">
      <div className="flex items-baseline gap-1.5">
        <span className="num text-[clamp(1.6rem,3vw,2.2rem)] font-semibold leading-none tracking-[-0.04em] text-acid">
          {stat.value}
        </span>
        <span className="num text-[12px] text-quiet">{stat.unit}</span>
      </div>
      <p className="mt-2 text-[13.5px] font-semibold text-fg">{stat.label}</p>
      <p className="mt-1 text-[12px] leading-snug text-muted">{stat.note}</p>
    </div>
  );
}

export function Delivery() {
  const ref = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);
  useReveals(ref);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_CMD);
      setCopied(true);
      toast.success("Linux 一键安装与 SHA256 校验脚本已复制");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("浏览器拒绝了剪贴板访问，请手动选择文本");
    }
  };

  return (
    <Section
      id="delivery"
      variant="inline"
      sectionRef={ref}
      eyebrow="工程质量与一键交付"
      title={
        <>
          5.95MB 单包 · 0 unsafe Rust：
          <br className="hidden md:block" />
          四端原生编译产物开箱即用。
        </>
      }
      lede="零 Docker 依赖、零 Rust 编译等待、不侵入宿主 systemd 全局服务。install.sh 仅落盘独立前缀目录，验证 SHA256 后 10 秒拉起整机弹性节点。"
      aside={
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-2 rounded-md border border-acid/50 bg-acid-tint px-4 py-2 text-[13.5px] font-medium text-acid transition hover:brightness-110 active:translate-y-px"
        >
          {copied ? <Check size={14} weight="bold" /> : <Copy size={14} weight="bold" />}
          {copied ? "脚本已复制" : "复制一键部署脚本"}
        </button>
      }
    >
      <div className="reveal grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* 左栏：精密终端窗口 + 6 大代码质量硬核指标 */}
        <div className="space-y-6 lg:col-span-7">
          <div className="surface-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line/70 bg-surface-3 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-danger/70" />
                <span className="size-2.5 rounded-full bg-warn/70" />
                <span className="size-2.5 rounded-full bg-acid/70" />
                <TerminalWindow size={14} weight="duotone" className="ml-2 text-acid" />
                <span className="num text-[12px] text-muted">deploy-linux-x86_64.sh</span>
              </div>
              <Badge variant="outline" className="num border-cyan/35 bg-cyan-tint/60 text-[10.5px] text-cyan">
                SHA256 Verified
              </Badge>
            </div>
            <pre className="overflow-x-auto bg-surface-3/60 p-5 text-[13px] leading-[1.75] text-quiet">
              <code className="num whitespace-pre">{INSTALL_CMD}</code>
            </pre>
            <div className="border-t border-line/70 bg-surface-3/90 px-4 py-3 text-[12.5px] text-muted">
              支持安装到 <span className="num text-quiet">/share/gpu-scavenger</span> 等独立挂载盘；默认仅监听回环地址，通过 SSH 隧道或 mTLS 暴露安全控制面。
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
            {CODE_STATS.map((s) => (
              <StatCell key={s.label} stat={s} />
            ))}
          </div>
        </div>

        {/* 右栏：四端原生构建产物 + 硬件实测节点档案 */}
        <div className="space-y-5 lg:col-span-5">
          <div className="surface-card p-5">
            <div className="flex items-baseline justify-between gap-3 border-b border-line/70 pb-3">
              <span className="micro flex items-center gap-2 text-acid">
                <FileArrowDown size={15} weight="duotone" />
                CI 自动发布产物（v0.1.0）
              </span>
              <span className="num text-[11.5px] text-muted">GitHub Releases</span>
            </div>
            <ul className="rows mt-2">
              {ARTIFACTS.map((a) => (
                <li key={a.file} className="py-3.5 first:pt-2 last:pb-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="num text-[13px] font-semibold text-fg">{a.file}</span>
                    <Badge variant="outline" className="num border-line bg-surface-3 text-[10.5px] text-acid">
                      {a.size}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[12.5px] text-muted">{a.kind}</p>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(a.sha);
                        toast.success(`${a.platform} SHA256 已复制`);
                      } catch {
                        toast.error("浏览器拒绝了剪贴板访问");
                      }
                    }}
                    title="点击复制完整 SHA256"
                    className="num mt-1.5 flex w-full items-center gap-1.5 truncate text-left text-[11.5px] text-muted/80 transition-colors hover:text-cyan"
                  >
                    <ShieldCheck size={12} weight="duotone" className="shrink-0 text-cyan" />
                    <span className="truncate">sha256:{a.sha}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="surface-card overflow-hidden p-5">
            <div className="flex items-center justify-between gap-3 border-b border-line/70 pb-3">
              <span className="micro flex items-center gap-2 text-cyan">
                <Stack size={15} weight="duotone" />
                实证参考物理节点铭牌
              </span>
              <span className="num text-[11.5px] text-muted">{HOST.date}</span>
            </div>
            <div className="mt-4 flex items-center gap-4">
              <img
                src="/img/gpu-module.webp"
                alt="NVIDIA A800 SXM4 模组细节图"
                className="h-20 w-24 shrink-0 rounded border border-line object-cover"
              />
              <dl className="grid flex-1 grid-cols-[54px_1fr] gap-y-1.5 text-[12.5px]">
                {[
                  ["主机名", HOST.node],
                  ["加速卡", HOST.gpus],
                  ["内核", HOST.os],
                  ["驱动", HOST.driver],
                  ["隔离", HOST.cgroup],
                ].map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="micro text-[10.5px]">{k}</dt>
                    <dd className="num truncate text-quiet">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
