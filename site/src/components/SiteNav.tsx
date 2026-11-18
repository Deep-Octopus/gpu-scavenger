import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { GithubLogo, Keyboard, List, Lightning, TerminalWindow } from "@phosphor-icons/react";
import { getLenis, gsap, ScrollTrigger, scrollToSection } from "@/src/lib/motion";
import { NAV } from "@/src/lib/nav";
import { Wordmark } from "@/src/components/Logo";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const REPO = "https://github.com/Deep-Octopus/gpu-scavenger";

export function SiteNav({ onOpenPalette }: { onOpenPalette: () => void }) {
  const [active, setActive] = useState(NAV[0].id);
  const [past, setPast] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const barRef = useRef<HTMLElement>(null);
  const lineRef = useRef<HTMLSpanElement>(null);
  const progressRef = useRef<HTMLSpanElement>(null);
  const pastRef = useRef(false);
  const linksRef = useRef<Record<string, HTMLAnchorElement | null>>({});

  useEffect(() => {
    const triggers = NAV.map((s, i) =>
      ScrollTrigger.create({
        trigger: `#${s.id}`,
        start: "top 45%",
        end: "bottom 45%",
        onToggle: (self) => {
          if (self.isActive) setActive(s.id);
          else if (i === NAV.length - 1 && self.direction === -1) setActive(NAV[NAV.length - 2].id);
        },
      }),
    );
    const head = ScrollTrigger.create({
      trigger: document.body,
      start: "top top+=0",
      end: "bottom bottom",
      onUpdate: (self) => {
        const nextPast = self.scroll() > 24;
        if (nextPast !== pastRef.current) {
          pastRef.current = nextPast;
          setPast(nextPast);
        }
        if (progressRef.current) progressRef.current.style.transform = `scaleX(${self.progress})`;
      },
    });
    return () => {
      triggers.forEach((t) => t.kill());
      head.kill();
    };
  }, []);

  useLayoutEffect(() => {
    const el = linksRef.current[active];
    const line = lineRef.current;
    if (!el || !line) return;
    const target = { x: el.offsetLeft, w: el.offsetWidth };
    if (line.dataset.x === undefined) {
      gsap.set(line, { x: target.x, width: target.w });
      line.dataset.x = String(target.x);
      return;
    }
    gsap.to(line, { x: target.x, width: target.w, duration: 0.42, ease: "power3.inOut" });
    line.dataset.x = String(target.x);
  }, [active]);

  useEffect(() => {
    const lenis = getLenis();
    if (!lenis) return;
    if (sheetOpen) lenis.stop();
    else lenis.start();
    return () => {
      lenis.start();
    };
  }, [sheetOpen]);

  const jump = (id: string) => {
    getLenis()?.start();
    setSheetOpen(false);
    requestAnimationFrame(() => scrollToSection(id));
  };

  return (
    <header
      ref={barRef}
      className={cn(
        "fixed inset-x-0 top-0 z-50 h-14 transition-colors duration-300",
        past ? "border-b border-line/70 bg-bg/88 backdrop-blur-md" : "bg-transparent",
      )}
    >
      <div className="mx-auto flex h-full max-w-[1440px] items-center gap-3 px-5 md:px-8">
        <a
          href="#hero"
          onClick={(e) => {
            e.preventDefault();
            scrollToSection("hero");
          }}
          aria-label="GPU Scavenger 首页"
          className="flex items-center gap-3"
        >
          <Wordmark />
          <span className="glow-badge hidden items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium tracking-[0.04em] md:inline-flex">
            <span className="pulse-dot size-1.5 rounded-full bg-acid" aria-hidden="true" />
            <span className="num">v0.1.0 · Safe Rust</span>
          </span>
        </a>

        <nav className="relative ml-auto hidden items-center lg:flex" aria-label="页面章节">
          {NAV.map((s) => (
            <a
              key={s.id}
              ref={(n) => {
                linksRef.current[s.id] = n;
              }}
              href={`#${s.id}`}
              data-active={active === s.id || undefined}
              onClick={(e) => {
                e.preventDefault();
                scrollToSection(s.id);
              }}
              className={cn(
                "px-2 py-2 text-[13px] tracking-[-0.01em] transition-colors xl:px-2.5 xl:text-[13.5px]",
                active === s.id ? "font-medium text-fg" : "text-muted hover:text-quiet",
              )}
            >
              {s.label}
            </a>
          ))}
          <span
            ref={lineRef}
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 left-0 h-[2px] w-6 bg-acid shadow-[0_0_8px_var(--site-accent)]"
          />
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-3">
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="GitHub 仓库"
            className="hidden h-8 w-8 items-center justify-center rounded-md border border-line/80 bg-surface/70 text-muted transition-colors hover:border-acid/45 hover:text-fg sm:inline-flex"
          >
            <GithubLogo size={15} weight="duotone" />
          </a>

          <button
            type="button"
            onClick={onOpenPalette}
            className="flex h-8 items-center gap-1.5 rounded-md border border-line/80 bg-surface/70 px-2.5 text-[12.5px] text-muted transition-colors hover:border-acid/45 hover:text-fg"
            aria-label="打开命令面板"
          >
            <Keyboard size={14} weight="duotone" />
            <kbd className="num hidden sm:inline">⌘K</kbd>
          </button>

          <button
            type="button"
            onClick={() => scrollToSection("sandbox")}
            className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap bg-acid px-3 text-[13px] font-semibold text-on-acid shadow-[0_0_20px_-6px_var(--site-accent)] transition hover:brightness-110 active:translate-y-px"
            style={{ borderRadius: "calc(var(--site-radius) - 3px)" }}
          >
            <TerminalWindow size={14} weight="bold" />
            <span>
              <span className="hidden sm:inline">交互</span>控制台
            </span>
          </button>

          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="打开导航菜单"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface text-quiet transition-colors hover:border-acid/45 hover:text-fg lg:hidden"
              >
                <List size={17} weight="bold" />
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[300px] border-l border-line bg-bg text-fg">
              <SheetHeader className="border-b border-line/70 pb-4 text-left">
                <SheetTitle className="flex items-center gap-2 text-fg">
                  <Wordmark />
                </SheetTitle>
                <p className="micro mt-1 text-acid/90">零侵入宿主优先 GPU 控制平面</p>
              </SheetHeader>
              <div data-lenis-prevent className="flex flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-4 py-4">
                {NAV.map((s, idx) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => jump(s.id)}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-[14px] transition-colors",
                      active === s.id
                        ? "bg-acid-tint font-medium text-acid"
                        : "text-quiet hover:bg-surface hover:text-fg",
                    )}
                  >
                    <span className="num text-[12px] text-muted">{String(idx + 1).padStart(2, "0")}</span>
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
              <div className="border-t border-line/70 p-4">
                <button
                  type="button"
                  onClick={() => jump("sandbox")}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-acid py-2.5 text-[13.5px] font-semibold text-on-acid"
                >
                  <Lightning size={15} weight="fill" />
                  立即进入抢占演练台
                </button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
      <span
        aria-hidden="true"
        ref={progressRef}
        className="absolute bottom-0 left-0 h-px w-full origin-left scale-x-0 bg-acid/80"
      />
    </header>
  );
}
