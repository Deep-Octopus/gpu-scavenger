import { useEffect, useLayoutEffect, useRef } from "react";
import { gsap, prefersReduced } from "@/src/lib/motion";
import { cn } from "@/lib/utils";

type Tone = "acid" | "warn" | "cyan";

const TONE_CLS: Record<Tone, string> = {
  acid: "border-acid/75 bg-bg/95 shadow-[0_0_16px_-3px_rgba(215,242,106,0.72)]",
  warn: "border-warn/80 bg-bg/95 shadow-[0_0_16px_-3px_rgba(245,185,66,0.72)]",
  cyan: "border-cyan/80 bg-bg/95 shadow-[0_0_16px_-3px_rgba(45,212,191,0.72)]",
};

/**
 * 2D 跨槽位抛物线跳卡徽标：
 * 配合 3D 舞台的 useGpuFocus()，在首屏 8 槽位条与控制台 8×A800 矩阵之间同步执行抛物线跃迁。
 */
export function FoxSlotHopper({
  containerRef,
  activeIndex,
  slotSelector = "[data-gpu-slot]",
  tone = "acid",
  size = 22,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  activeIndex: number;
  slotSelector?: string;
  tone?: Tone;
  size?: number;
}) {
  const hopperRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const prevIdxRef = useRef(activeIndex);
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  const measureTarget = (index: number): { x: number; y: number } | null => {
    const container = containerRef.current;
    if (!container) return null;
    const btn = container.querySelector<HTMLElement>(`${slotSelector}[data-gpu-slot="${index}"]`);
    if (!btn) return null;
    const cr = container.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    if (cr.width === 0 || br.width === 0) return null;
    return {
      x: br.right - cr.left - size * 0.78,
      y: br.top - cr.top - size * 0.45,
    };
  };

  useLayoutEffect(() => {
    const el = hopperRef.current;
    if (!el) return;
    const target = measureTarget(activeIndex);
    if (!target) return;

    if (!mountedRef.current || prefersReduced() || prevIdxRef.current === activeIndex) {
      mountedRef.current = true;
      prevIdxRef.current = activeIndex;
      tlRef.current?.kill();
      gsap.set(el, { x: target.x, y: target.y, opacity: 1, scale: 1, rotation: 0 });
      return;
    }

    prevIdxRef.current = activeIndex;
    tlRef.current?.kill();

    const startX = Number(gsap.getProperty(el, "x")) || target.x;
    const startY = Number(gsap.getProperty(el, "y")) || target.y;
    const peakY = Math.min(startY, target.y) - 22;
    const lean = target.x >= startX ? 12 : -12;

    const tl = gsap.timeline();
    tl.to(
      el,
      {
        x: target.x,
        duration: 0.44,
        ease: "power2.inOut",
      },
      0,
    )
      .to(
        el,
        {
          y: peakY,
          scale: 1.24,
          rotation: lean,
          duration: 0.21,
          ease: "power2.out",
        },
        0,
      )
      .to(
        el,
        {
          y: target.y,
          scale: 1,
          rotation: 0,
          duration: 0.25,
          ease: "bounce.out",
        },
        0.21,
      );

    tlRef.current = tl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, containerRef, slotSelector]);

  useEffect(() => {
    const container = containerRef.current;
    const el = hopperRef.current;
    if (!container || !el) return;
    const ro = new ResizeObserver(() => {
      if (tlRef.current?.isActive()) return;
      const target = measureTarget(prevIdxRef.current);
      if (target) gsap.set(el, { x: target.x, y: target.y, opacity: 1 });
    });
    ro.observe(container);
    return () => {
      ro.disconnect();
      tlRef.current?.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, slotSelector]);

  return (
    <div
      ref={hopperRef}
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute left-0 top-0 z-20 flex items-center justify-center rounded-full border p-[2px] opacity-0 transition-colors duration-200",
        TONE_CLS[tone],
      )}
      style={{ width: size, height: size }}
    >
      <img
        src="/img/logo-mascot.webp"
        alt=""
        className={cn(
          "h-full w-full select-none object-contain transition-[filter] duration-200",
          tone === "warn" && "hue-rotate-[-32deg] saturate-150",
        )}
      />
    </div>
  );
}
