import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";
import { SiteNav } from "@/src/components/SiteNav";
import { SiteFooter } from "@/src/components/SiteFooter";
import { CommandPalette } from "@/src/components/CommandPalette";
import { useSmoothScroll } from "@/src/lib/motion";
import { GpuFocusProvider } from "@/src/lib/focus";
import { Hero } from "@/src/sections/Hero";
import { Problem } from "@/src/sections/Problem";
import { TimelineScrub } from "@/src/sections/TimelineScrub";
import { Architecture } from "@/src/sections/Architecture";
import { Manifesto } from "@/src/sections/Manifesto";
import { Hardware } from "@/src/sections/Hardware";
import { StateMachine } from "@/src/sections/StateMachine";
import { Sandbox } from "@/src/sections/Sandbox";
import { Evidence } from "@/src/sections/Evidence";
import { Innovation } from "@/src/sections/Innovation";
import { Delivery } from "@/src/sections/Delivery";
import { Roadmap } from "@/src/sections/Roadmap";
import { Submit } from "@/src/sections/Submit";

export default function App() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  useSmoothScroll();

  return (
    <>
      <a href="#hero" className="skip-link">
        跳到正文
      </a>
      <SiteNav onOpenPalette={() => setPaletteOpen(true)} />
      <GpuFocusProvider>
        <main>
          <Hero />
          <Problem />
          <ErrorBoundary
            fallback={(reset) => (
              <section id="scrub" className="border-y border-line/70 bg-surface-3 px-5 py-16 text-center md:px-8">
                <p className="num text-[14px] text-quiet">472ms 时序示波器面板渲染异常，已隔离保护整页视图。</p>
                <button
                  type="button"
                  onClick={reset}
                  className="mt-3 rounded-md border border-acid/45 bg-acid-tint px-3.5 py-1.5 text-[13px] text-acid"
                >
                  重新挂载时序示波器
                </button>
              </section>
            )}
          >
            <TimelineScrub />
          </ErrorBoundary>
          <Architecture />
          <Manifesto />
          <Hardware />
          <ErrorBoundary
            fallback={(reset) => (
              <section id="machine" className="px-5 py-16 text-center md:px-8">
                <p className="num text-[14px] text-quiet">状态机拓扑画布渲染异常，已隔离保护整页视图。</p>
                <button
                  type="button"
                  onClick={reset}
                  className="mt-3 rounded-md border border-acid/45 bg-acid-tint px-3.5 py-1.5 text-[13px] text-acid"
                >
                  重新挂载状态机拓扑
                </button>
              </section>
            )}
          >
            <StateMachine />
          </ErrorBoundary>
          <Sandbox />
          <Evidence />
          <Innovation />
          <Delivery />
          <Roadmap />
          <Submit />
        </main>
      </GpuFocusProvider>
      <SiteFooter />
      <CommandPalette open={paletteOpen} setOpen={setPaletteOpen} />
      <Toaster theme="dark" position="bottom-right" />
    </>
  );
}
