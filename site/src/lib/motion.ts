/**
 * 动效底座：全站只有一条时间轴（GSAP ticker）驱动滚动平滑、揭示与沙盒过渡。
 * reduced-motion 是唯一开关：关闭平滑滚动、关闭 ScrollTrigger 动画、揭示元素保持可见。
 */
import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { Flip } from "gsap/Flip";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger, SplitText, Flip, ScrambleTextPlugin);

export { gsap, ScrollTrigger, Flip, ScrambleTextPlugin };

const reducedQuery = "(prefers-reduced-motion: reduce)";

export function prefersReduced(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(reducedQuery).matches;
}

/** 设计参数 --site-motion 与系统偏好共同决定时长，0 表示瞬时 */
export function dur(ms: number): number {
  if (prefersReduced()) return 0;
  const scale = readCssNumber("--site-motion", 1);
  return (ms * scale) / 1000;
}

export function readCssNumber(name: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

let lenis: Lenis | null = null;

export function getLenis(): Lenis | null {
  return lenis;
}

export function scrollToSection(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  if (lenis && !prefersReduced()) {
    lenis.scrollTo(el, { offset: -72, duration: 1.1 });
  } else {
    el.scrollIntoView({ behavior: prefersReduced() ? "auto" : "smooth", block: "start" });
  }
}

/** 跳转到某个板块并短暂点亮它的左边缘，用于跨板块引用 */
export function flashSection(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  scrollToSection(id);
  if (prefersReduced()) return;
  el.setAttribute("data-flash", "1");
  window.setTimeout(() => el.removeAttribute("data-flash"), 1500);
}

/** 挂载平滑滚动，并与 ScrollTrigger 共用同一个 raf，避免两套滚动采样打架 */
export function useSmoothScroll(): void {
  useEffect(() => {
    if (prefersReduced()) {
      ScrollTrigger.update();
      return;
    }
    const instance = new Lenis({
      duration: 1.05,
      easing: (t) => 1 - Math.pow(1 - t, 3.2),
      wheelMultiplier: 1,
      touchMultiplier: 1.6,
      infinite: false,
    });
    lenis = instance;
    instance.on("scroll", ScrollTrigger.update);
    const raf = (time: number) => instance.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    let fontCancelled = false;
    document.fonts?.ready.then(() => {
      if (!fontCancelled) ScrollTrigger.refresh();
    });
    return () => {
      fontCancelled = true;
      gsap.ticker.remove(raf);
      instance.destroy();
      lenis = null;
    };
  }, []);
}

/**
 * 入场揭示：默认 CSS 已让 .reveal 可见，只有加害者 .reveal-ready 存在时隐藏，
 * 因此脚本失效或 reduced-motion 下内容不会消失。
 */
export function useReveals(scope: React.RefObject<HTMLElement | null>, deps: unknown[] = []): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const root = scope.current;
    if (!root) return;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(".reveal"));
    if (!nodes.length) return;
    if (prefersReduced()) {
      nodes.forEach((n) => gsap.set(n, { opacity: 1, y: 0 }));
      return;
    }
    root.classList.add("reveal-ready");
    const ctx = gsap.context(() => {
      nodes.forEach((node) => {
        gsap.fromTo(
          node,
          { opacity: 0, y: 22 },
          {
            opacity: 1,
            y: 0,
            duration: dur(760),
            ease: "power3.out",
            delay: dur(Number(node.dataset.delay ?? 0)),
            scrollTrigger: { trigger: node, start: "top 88%", once: true },
          },
        );
      });
    }, root);
    ScrollTrigger.refresh();
    return () => ctx.revert();
  }, deps);
}

/** 标题按词拆分上浮；reduced-motion 下只补空格不做动画 */
export function useWordRise(
  ref: React.RefObject<HTMLElement | null>,
  opts: { delay?: number; stagger?: number } = {},
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReduced()) return;
    let cancelled = false;
    let split: SplitText | undefined;
    let tween: gsap.core.Tween | undefined;

    const init = () => {
      if (cancelled || !el.isConnected) return;
      split = new SplitText(el, { type: "words", wordsClass: "inline-block" });
      tween = gsap.from(split.words, {
        yPercent: 116,
        opacity: 0,
        duration: dur(820),
        ease: "expo.out",
        stagger: dur(opts.stagger ?? 42),
        delay: dur(opts.delay ?? 0),
        scrollTrigger: { trigger: el, start: "top 90%", once: true },
      });
    };

    if (document.fonts && document.fonts.status !== "loaded") {
      document.fonts.ready.then(init);
    } else {
      init();
    }

    return () => {
      cancelled = true;
      tween?.scrollTrigger?.kill();
      tween?.kill();
      split?.revert();
    };
  }, [ref, opts.delay, opts.stagger]);
}

/** 指针跟随的边框高光：只在容器内更新两个 CSS 变量，不进入 React 状态 */
export function useSpotlight<T extends HTMLElement>(ref: React.RefObject<T | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    el.addEventListener("pointermove", onMove, { passive: true });
    return () => el.removeEventListener("pointermove", onMove);
  }, [ref]);
}

/** 数字滚动：只在进入视口时跑一次，避免常驻微动画 */
export function useCountUp(
  ref: React.RefObject<HTMLElement | null>,
  to: number,
  opts: { decimals?: number; duration?: number } = {},
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const decimals = opts.decimals ?? 0;
    if (prefersReduced()) {
      el.textContent = to.toFixed(decimals);
      return;
    }
    const obj = { v: 0 };
    const tween = gsap.to(obj, {
      v: to,
      duration: dur(opts.duration ?? 1100),
      ease: "power2.out",
      onUpdate: () => {
        el.textContent = obj.v.toFixed(decimals);
      },
      scrollTrigger: { trigger: el, start: "top 92%", once: true },
    });
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [ref, to, opts.decimals, opts.duration]);
}

/** 数字/哈希矩阵解码动效：进入视口时跑一次，reduced-motion 下直接展示目标文本 */
export function useScrambleText(
  ref: React.RefObject<HTMLElement | null>,
  text: string,
  opts: { duration?: number; chars?: string; delay?: number } = {},
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReduced()) {
      el.textContent = text;
      return;
    }
    const tween = gsap.to(el, {
      duration: dur(opts.duration ?? 780),
      delay: dur(opts.delay ?? 0),
      scrambleText: {
        text,
        chars: opts.chars ?? "0123456789ABCDEF%ms.",
        speed: 0.65,
        revealDelay: 0.08,
      },
      scrollTrigger: { trigger: el, start: "top 92%", once: true },
    });
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [ref, text, opts.duration, opts.chars, opts.delay]);
}

export function refreshScrollTriggers(): void {
  ScrollTrigger.refresh();
}
