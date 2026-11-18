import { cn } from "@/lib/utils";

/**
 * 品牌图腾：撒哈拉耳廓狐（Fennec Fox）。
 * 荒漠生态中最敏锐的夜间拾荒精灵——标志性超大声呐双耳隐喻 11ms 捕捉宿主 ExplicitClaim，
 * 遇宿主归来 472ms 轻盈退避且凭七元组边界 100% 零误伤。
 */
export function LogoMark({
  size = 30,
  bare = false,
  className,
}: {
  size?: number;
  bare?: boolean;
  className?: string;
}) {
  if (bare) {
    return (
      <img
        src="/img/logo-mascot.webp"
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        className={cn("logo-mascot object-contain select-none", className)}
      />
    );
  }

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-[8px] border border-acid/30 bg-surface-2/95 p-[3px] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_18px_-7px_rgba(215,242,106,0.5)]",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <img
        src="/img/logo-mascot.webp"
        alt=""
        width={size}
        height={size}
        className="logo-mascot h-full w-full object-contain select-none"
      />
    </span>
  );
}

export function Wordmark({ tagline, className }: { tagline?: string; className?: string }) {
  return (
    <span className={cn("group inline-flex shrink-0 items-center gap-2.5", className)}>
      <LogoMark size={30} />
      <span className="flex items-baseline gap-2">
        <span className="font-display text-[16px] font-bold tracking-[-0.035em] text-fg">
          <span className="text-acid">GPU</span> Scavenger
        </span>
        {tagline ? <span className="micro hidden sm:inline">{tagline}</span> : null}
      </span>
    </span>
  );
}
