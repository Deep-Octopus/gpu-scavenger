import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { folio } from "@/src/lib/nav";

/** 板块滚到视口中段算「当前」，页码和眉标据此点亮 */
export function useMidView(node: React.RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const el = node.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setActive(e?.isIntersecting ?? false), {
      rootMargin: "-45% 0px -45% 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [node]);
  return active;
}

/** 章节眉标：空心页码 + 酸绿指示灯与刻度线 + 标签，板块进入视口时页码充上电 */
export function Eyebrow({
  id,
  label,
  active = false,
  reverse = false,
}: {
  id: string;
  label: string;
  active?: boolean;
  reverse?: boolean;
}) {
  const num = folio(id);
  const dot = (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full transition-colors duration-500",
        active ? "bg-acid shadow-[0_0_8px_var(--site-accent)]" : "bg-muted/45",
      )}
      aria-hidden="true"
    />
  );
  const tick = (
    <span
      className="h-px w-8 origin-left bg-acid/85 transition-transform duration-500"
      style={{ transform: `scaleX(${active ? 1 : 0.45})` }}
      aria-hidden="true"
    />
  );
  const tag = (
    <span className={cn("transition-colors duration-500", active ? "text-acid" : "text-muted")}>
      {label}
    </span>
  );
  return (
    <p className="micro mb-3.5 flex items-center gap-2.5">
      {reverse ? (
        <>
          {tag}
          {tick}
          {dot}
          {num ? (
            <span className="folio -mt-0.5" aria-hidden="true">
              {num}
            </span>
          ) : null}
        </>
      ) : (
        <>
          {num ? (
            <span className="folio -mt-0.5" aria-hidden="true">
              {num}
            </span>
          ) : null}
          {dot}
          {tick}
          {tag}
        </>
      )}
    </p>
  );
}

/* text-balance 是必须的：中文大字标题在容器内保持行宽均衡 */
const TITLE =
  "text-[clamp(1.75rem,3.6vw,2.75rem)] font-semibold leading-[1.12] tracking-[-0.035em] text-fg text-balance";
const LEDE = "text-[15px] leading-relaxed text-quiet md:text-[16px]";

/**
 * 三种开场，避免每个板块都是「眉标 + 两行标题 + 一段导语」：
 * lead   标题与导语叠在左栏，控件靠右
 * inline 标题在左，导语与控件同排压在右下，横向铺开
 * right  整块右对齐，给下一屏的左对齐正文留出落差
 */
export type SectionVariant = "lead" | "inline" | "right";

export function Section({
  id,
  eyebrow,
  title,
  lede,
  aside,
  children,
  className,
  wide = false,
  variant = "lead",
  sectionRef,
}: {
  id: string;
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  /** 标题区右侧的补充说明或操作 */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  wide?: boolean;
  variant?: SectionVariant;
  sectionRef?: React.Ref<HTMLElement>;
}) {
  const inner = useRef<HTMLElement | null>(null);
  const active = useMidView(inner);

  function attach(node: HTMLElement | null) {
    inner.current = node;
    if (typeof sectionRef === "function") sectionRef(node);
    else if (sectionRef) (sectionRef as React.RefObject<HTMLElement | null>).current = node;
  }

  const head = eyebrow ? <Eyebrow id={id} label={eyebrow} active={active} reverse={variant === "right"} /> : null;

  return (
    <section
      id={id}
      ref={attach}
      data-active={active ? "1" : undefined}
      className={cn("relative scroll-mt-14 py-20 md:py-28", className)}
    >
      <div className={cn("mx-auto px-5 md:px-8", wide ? "max-w-[1600px]" : "max-w-[1440px]")}>
        <header className="reveal mb-10 md:mb-14">
          {variant === "inline" ? (
            <div>
              {head}
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
                <h2 className={cn(TITLE, "max-w-[40rem]")}>{title}</h2>
                <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:gap-8">
                  {lede ? <p className={cn(LEDE, "max-w-[32rem]")}>{lede}</p> : null}
                  {aside ? <div className="shrink-0">{aside}</div> : null}
                </div>
              </div>
            </div>
          ) : variant === "right" ? (
            <div className="flex flex-col items-end gap-3 text-right">
              {head}
              <h2 className={cn(TITLE, "max-w-[44rem]")}>{title}</h2>
              {lede ? <p className={cn(LEDE, "max-w-[38rem]")}>{lede}</p> : null}
              {aside ? <div className="mt-3">{aside}</div> : null}
            </div>
          ) : (
            <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div className="max-w-[48rem]">
                {head}
                <h2 className={TITLE}>{title}</h2>
                {lede ? <p className={cn(LEDE, "mt-4 max-w-[42rem]")}>{lede}</p> : null}
              </div>
              {aside ? <div className="shrink-0 md:pb-1">{aside}</div> : null}
            </div>
          )}
        </header>
        {children}
      </div>
    </section>
  );
}

export function Hairline({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="hair flex-1" aria-hidden="true" />
      {label ? <span className="micro">{label}</span> : null}
      <span className="hair flex-1" aria-hidden="true" />
    </div>
  );
}
