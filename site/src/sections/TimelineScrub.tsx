import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { ArrowCounterClockwise, CheckCircle, Play } from "@phosphor-icons/react";
import { gsap, prefersReduced } from "@/src/lib/motion";
import { Eyebrow, useMidView } from "@/src/components/Section";
import { VERIFIER } from "@/src/data/evidence";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

echarts.use([LineChart, GridComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);

const END = 472;
const START_MEM = 683;
const BASE_MEM = 2;

const MARKS = [
  { t: 0, state: "ExplicitClaim", text: "宿主发起 Claim（11ms 内本地事件环捕获），立即冻结新任务租约。" },
  { t: 120, state: "SIGUSR1 / Drain", text: "checkpointed 任务写入原子检查点并提交 ACK；stateless 立即进入回收。" },
  { t: 339, state: "ScopeEmpty", text: "自有 systemd scope 与所有 fork/setsid 子进程同步清空，宿主零扰动。" },
  { t: 422, state: "Sample #1", text: `第 1 次轮询命中显存基线 ±${VERIFIER.toleranceMiB} MiB 绿色安全容差带。` },
  { t: 472, state: "ReleaseVerified", text: `连续 ${VERIFIER.consecutiveSamples} 次采样通过！显卡正式归还宿主，任务无损回队。` },
];

const STATES = ["Running", "Claimed", "Draining", "ScopeEmpty", "Sampling", "ReleaseVerified"];

/** 真机 472ms 显存与上下文回收高精度采样波形 */
const WAVE_POINTS: Array<[number, number]> = [
  [0, 683],
  [45, 683],
  [120, 680],
  [190, 560],
  [260, 412],
  [339, 178],
  [378, 52],
  [422, 2],
  [472, 2],
];

function memAt(ms: number): number {
  if (ms <= WAVE_POINTS[0][0]) return WAVE_POINTS[0][1];
  for (let i = 1; i < WAVE_POINTS.length; i++) {
    const [x0, y0] = WAVE_POINTS[i - 1];
    const [x1, y1] = WAVE_POINTS[i];
    if (ms <= x1) {
      const k = (ms - x0) / Math.max(1, x1 - x0);
      return Math.round(y0 + (y1 - y0) * k);
    }
  }
  return BASE_MEM;
}

export function TimelineScrub() {
  const root = useRef<HTMLElement>(null);
  const chartEl = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const active = useMidView(root);
  const msRef = useRef<HTMLSpanElement>(null);
  const memRef = useRef<HTMLSpanElement>(null);
  const sliderLabelRef = useRef<HTMLSpanElement>(null);
  const rangeRef = useRef<HTMLInputElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const cursorLineRef = useRef<HTMLDivElement>(null);
  const currentMsRef = useRef(0);
  const verifiedRef = useRef(false);
  const [verified, setVerified] = useState(false);
  const [playing, setPlaying] = useState(false);
  const playRaf = useRef(0);

  const paint = useCallback((ms: number) => {
    const clamped = Math.max(0, Math.min(END, ms));
    const t = Math.round(clamped);
    const mem = memAt(clamped);
    const pct = (clamped / END) * 100;

    currentMsRef.current = t;
    const nextVerified = t >= END;
    if (nextVerified !== verifiedRef.current) {
      verifiedRef.current = nextVerified;
      setVerified(nextVerified);
    }

    if (msRef.current) msRef.current.textContent = String(t);
    if (memRef.current) memRef.current.textContent = String(mem);
    if (sliderLabelRef.current) sliderLabelRef.current.textContent = `${t} / ${END} ms`;
    if (rangeRef.current) {
      rangeRef.current.value = String(t);
      rangeRef.current.style.background = `linear-gradient(90deg, var(--site-accent) ${pct}%, var(--surface-2) ${pct}%)`;
    }
    if (headRef.current) headRef.current.style.left = `${pct}%`;

    const chart = chartRef.current;
    if (chart && cursorLineRef.current) {
      const px = chart.convertToPixel({ xAxisIndex: 0 }, clamped);
      if (typeof px === "number" && Number.isFinite(px)) {
        cursorLineRef.current.style.transform = `translateX(${px}px)`;
        cursorLineRef.current.style.opacity = "1";
      }
    }

    const el = root.current;
    if (!el) return;
    el.querySelectorAll<HTMLElement>("[data-mark]").forEach((m) => {
      m.dataset.on = t >= Number(m.dataset.mark) ? "1" : "0";
    });
    el.querySelectorAll<HTMLElement>("[data-state]").forEach((s) => {
      s.dataset.on = t >= Number(s.dataset.at) ? "1" : "0";
    });
  }, []);

  useEffect(() => {
    const dom = chartEl.current;
    if (!dom) return;
    const chart = echarts.init(dom, undefined, { renderer: "canvas" });
    chartRef.current = chart;

    chart.setOption({
      animation: false,
      grid: { left: 48, right: 20, top: 28, bottom: 28 },
      tooltip: {
        trigger: "axis",
        backgroundColor: "#0c100e",
        borderColor: "#26302a",
        textStyle: { color: "#eef3ec", fontFamily: '"JetBrains Mono Variable", monospace', fontSize: 12 },
        formatter: (params: unknown) => {
          const list = params as Array<{ value: [number, number] }>;
          const pt = list[0]?.value;
          if (!pt) return "";
          return `<b>t = ${pt[0]} ms</b><br/>NVML 显存: <span style="color:#d7f26a">${pt[1]} MiB</span>`;
        },
      },
      xAxis: {
        type: "value",
        min: 0,
        max: END,
        interval: 118,
        axisLine: { lineStyle: { color: "#26302a" } },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#26302a", opacity: 0.4 } },
        axisLabel: { color: "#8b968e", fontFamily: '"JetBrains Mono Variable", monospace', fontSize: 11, formatter: "{value}ms" },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 760,
        interval: 190,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#26302a", opacity: 0.45 } },
        axisLabel: { color: "#8b968e", fontFamily: '"JetBrains Mono Variable", monospace', fontSize: 11 },
      },
      series: [
        {
          name: "VRAM",
          type: "line",
          smooth: 0.25,
          symbol: "circle",
          symbolSize: 6,
          itemStyle: { color: "#d7f26a" },
          lineStyle: { width: 2.5, color: "#d7f26a" },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(215, 242, 106, 0.34)" },
              { offset: 1, color: "rgba(215, 242, 106, 0.02)" },
            ]),
          },
          data: WAVE_POINTS,
          markArea: {
            silent: true,
            itemStyle: { color: "rgba(45, 212, 191, 0.12)", borderColor: "rgba(45, 212, 191, 0.35)", borderWidth: 1, borderType: "dashed" },
            label: {
              show: true,
              position: "top",
              offset: [0, -2],
              color: "#2dd4bf",
              fontSize: 10.5,
              fontFamily: '"JetBrains Mono Variable", monospace',
              formatter: "基线 ±64 MiB 容差带",
            },
            data: [[{ xAxis: 360, yAxis: 0 }, { xAxis: 472, yAxis: 66 }]],
          },
          markLine: {
            symbol: "none",
            silent: true,
            label: { color: "#c4cec6", fontSize: 10.5, fontFamily: '"JetBrains Mono Variable", monospace' },
            lineStyle: { color: "#8b968e", type: "dashed", width: 1 },
            data: [
              { xAxis: 339, label: { formatter: "339ms ScopeEmpty", position: "insideEndTop" } },
              { xAxis: 422, lineStyle: { color: "#2dd4bf" }, label: { formatter: "Sample 1", color: "#2dd4bf", position: "insideMiddleTop" } },
              { xAxis: 472, lineStyle: { color: "#2dd4bf" }, label: { formatter: "Verified", color: "#2dd4bf", position: "insideEndTop" } },
            ],
          },
        },
      ],
    });

    const ro = new ResizeObserver(() => {
      chart.resize();
      paint(currentMsRef.current);
    });
    ro.observe(dom);

    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el || prefersReduced()) return;
    const ctx = gsap.context(() => {
      const counter = { ms: 0 };
      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: el,
          start: "top top+=72",
          end: "+=140%",
          scrub: 0.45,
          pin: true,
        },
      });
      tl.to(counter, {
        ms: END,
        duration: 1,
        ease: "none",
        onUpdate: () => paint(counter.ms),
      });
    }, el);
    paint(0);
    return () => ctx.revert();
  }, [paint]);

  useEffect(() => {
    if (prefersReduced()) paint(END);
  }, [paint]);

  useEffect(() => () => cancelAnimationFrame(playRaf.current), []);

  const replay = () => {
    cancelAnimationFrame(playRaf.current);
    setPlaying(true);
    const start = performance.now();
    const duration = 2200;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      paint(p * END);
      if (p < 1) {
        playRaf.current = requestAnimationFrame(tick);
      } else {
        setPlaying(false);
      }
    };
    playRaf.current = requestAnimationFrame(tick);
  };

  return (
    <section
      ref={root}
      id="scrub"
      data-active={active ? "1" : undefined}
      aria-label="Claim 到 ReleaseVerified 的实测时序回放"
      className="scrub relative overflow-hidden border-y border-line/70 bg-surface-3"
    >
      <div className="mx-auto flex min-h-[calc(100svh-72px)] max-w-[1440px] flex-col justify-center gap-6 px-5 py-12 md:px-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow id="scrub" label="示波器级时序取证" active={active} />
            <h2 className="text-[clamp(1.5rem,3vw,2.25rem)] font-semibold tracking-[-0.035em] text-fg">
              472 毫秒的物理释放解剖：每一微秒都可追踪
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={replay}
              className="flex items-center gap-1.5 rounded-md border border-acid/45 bg-acid-tint px-3.5 py-2 text-[13px] font-semibold text-acid transition hover:brightness-110"
            >
              <Play size={13} weight="fill" />
              {playing ? "正在回放..." : "自动演示 472ms"}
            </button>
            <button
              type="button"
              onClick={() => {
                cancelAnimationFrame(playRaf.current);
                setPlaying(false);
                paint(0);
              }}
              className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-quiet hover:border-quiet/50"
            >
              <ArrowCounterClockwise size={13} weight="bold" />
              归零
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12">
          {/* 左栏：ECharts 双通道显存回收示波器 + SXM4 硬件铭牌 */}
          <div className="surface-card flex flex-col justify-between p-5 lg:col-span-6">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 pb-3">
                <div className="flex items-center gap-2.5">
                  <img
                    src="/img/gpu-module.webp"
                    alt="SXM4 硬件模组微缩铭牌"
                    className="h-9 w-12 rounded border border-line object-cover"
                  />
                  <div>
                    <span className="num block text-[13px] font-semibold text-fg">GPU2 · SXM4-80GB 显存示波器</span>
                    <span className="num text-[11.5px] text-muted">任务实测分配 256 MiB · NVML 总观测 {START_MEM} MiB</span>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "num text-[11px]",
                    verified
                      ? "border-cyan/55 bg-cyan-tint text-cyan"
                      : "border-acid/45 bg-acid-tint text-acid",
                  )}
                >
                  {verified ? (
                    <>
                      <CheckCircle size={12} weight="fill" className="mr-1" />
                      RELEASE VERIFIED
                    </>
                  ) : (
                    "SAMPLING PIPELINE"
                  )}
                </Badge>
              </div>

              {/* 示波器画布 + 像素同步激光扫描游标 */}
              <div className="relative mt-3 h-[260px] w-full sm:h-[285px]">
                <div ref={chartEl} className="h-full w-full" role="img" aria-label="472毫秒显存归零曲线与双采样容差带" />
                <div
                  ref={cursorLineRef}
                  aria-hidden="true"
                  className="pointer-events-none absolute top-[28px] bottom-[28px] left-0 w-px bg-cyan shadow-[0_0_10px_var(--cyan)]"
                  style={{ opacity: 0 }}
                />
              </div>
            </div>

            <div className="mt-4 border-t border-line/70 pt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-4">
                <div>
                  <span className="micro">实时显存水位</span>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span
                      ref={memRef}
                      className={cn(
                        "num text-[clamp(1.7rem,3vw,2.2rem)] font-semibold leading-none tracking-[-0.04em]",
                        verified ? "text-cyan" : "text-acid",
                      )}
                    >
                      {START_MEM}
                    </span>
                    <span className="num text-[13px] text-muted">MiB</span>
                  </div>
                </div>

                <div className="min-w-[200px] flex-1 max-w-[300px]">
                  <div className="mb-2 flex items-center justify-between text-[11.5px] text-muted">
                    <span className="num">拖拽游标微调时间轴</span>
                    <span ref={sliderLabelRef} className="num text-acid">
                      0 / {END} ms
                    </span>
                  </div>
                  <input
                    ref={rangeRef}
                    type="range"
                    min={0}
                    max={END}
                    step={1}
                    defaultValue={0}
                    onInput={(e) => {
                      cancelAnimationFrame(playRaf.current);
                      setPlaying(false);
                      paint(Number(e.currentTarget.value));
                    }}
                    aria-label="472毫秒时间轴滑块"
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-acid [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-bg [&::-moz-range-thumb]:bg-acid [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-bg [&::-webkit-slider-thumb]:bg-acid [&::-webkit-slider-thumb]:shadow-[0_0_8px_var(--site-accent)]"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 右栏：状态步进条 + 五个真机时间锚点 */}
          <div className="surface-card flex flex-col justify-between p-5 lg:col-span-6">
            <div>
              <div className="mb-4 flex flex-wrap gap-2">
                {STATES.map((s, i) => (
                  <span
                    key={s}
                    data-state={s}
                    data-at={Math.round((i / (STATES.length - 1)) * END)}
                    className="st num rounded border border-line/70 bg-bg/70 px-2.5 py-1 text-[11.5px] tracking-[-0.01em] data-[on='1']:border-acid/55 data-[on='1']:bg-acid-tint data-[on='1']:text-acid"
                  >
                    {s}
                  </span>
                ))}
              </div>

              <div className="relative mt-5 h-1 w-full rounded-full bg-line/70">
                <div
                  ref={headRef}
                  aria-hidden="true"
                  className="absolute -top-1.5 h-4 w-1 -translate-x-1/2 rounded-full bg-acid shadow-[0_0_10px_var(--site-accent)]"
                  style={{ left: "0%" }}
                />
                <span className="num absolute left-0 top-3 text-[11.5px] text-muted">0ms</span>
                <span className="num absolute right-0 top-3 text-[11.5px] text-muted">{END}ms</span>
              </div>

              <ol className="mk-list rows mt-9">
                {MARKS.map((m) => (
                  <li
                    key={m.t}
                    data-mark={m.t}
                    data-on="0"
                    onClick={() => {
                      cancelAnimationFrame(playRaf.current);
                      setPlaying(false);
                      paint(m.t);
                    }}
                    className="mk grid cursor-pointer grid-cols-[64px_1fr] items-start gap-3 rounded-xs py-3 pl-3 pr-2 transition-colors hover:bg-surface/80 md:grid-cols-[78px_1fr]"
                  >
                    <span className="mk-t num text-[14px] font-semibold">{m.t}ms</span>
                    <span className="mk-b text-[13.5px] leading-relaxed">
                      <span className="num mr-2 rounded bg-surface-2 px-1.5 py-0.5 text-[11.5px] text-quiet">
                        {m.state}
                      </span>
                      {m.text}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="mt-4 flex flex-wrap items-end justify-between gap-4 border-t border-line/70 pt-4">
              <p className="max-w-[44ch] text-[12.5px] leading-relaxed text-muted">
                释放三判据：cgroup 为空、登记 PID 为零、显存回归基线 ±{VERIFIER.toleranceMiB} MiB 且连续{" "}
                {VERIFIER.consecutiveSamples} 次采样通过。
              </p>
              <div className="flex items-baseline gap-1.5">
                <span
                  ref={msRef}
                  className="num text-[clamp(2rem,4vw,3.1rem)] font-semibold leading-none tracking-[-0.05em] text-fg"
                >
                  0
                </span>
                <span className="micro text-acid">ms</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
