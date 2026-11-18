import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import { GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { prefersReduced } from "@/src/lib/motion";

echarts.use([BarChart, GridComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);

const MONO = '"JetBrains Mono Variable", "Plex Mono", ui-monospace, monospace';

function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export type Sample = { label: string; sub: string; ms: number; release: boolean; source: string };

export function LatencyChart({
  samples,
  onPick,
}: {
  samples: Sample[];
  onPick: (i: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: "canvas" });

    const paint = () => {
      const compact = el.clientWidth < 520;
      const acid = token("--site-accent", "#d7f26a");
      const cyan = token("--cyan", "#2dd4bf");
      const line = token("--site-border", "#26302a");
      const muted = token("--site-muted", "#8b968e");
      const fg = token("--site-fg", "#eef3ec");

      chart.setOption(
        {
          animation: !prefersReduced(),
          animationDuration: 760,
          animationEasing: "cubicOut",
          grid: { left: compact ? 6 : 8, right: compact ? 28 : 34, top: compact ? 42 : 48, bottom: 26, containLabel: true },
          textStyle: { fontFamily: MONO, fontSize: compact ? 10.5 : 11.5 },
          tooltip: {
            trigger: "item",
            backgroundColor: "#0c100e",
            borderColor: line,
            borderWidth: 1,
            padding: [8, 12],
            textStyle: { color: fg, fontSize: 12 },
            formatter: (p: unknown) => {
              const d = p as { dataIndex: number };
              const s = samples[d.dataIndex];
              const sla = s.release ? 1500 : 500;
              const ratio = (sla / s.ms).toFixed(2);
              return `<b>${s.label}</b><br/>${s.sub}: <b style="color:${acid}">${s.ms} ms</b> (较 ${sla}ms SLA 快 <b>${ratio}×</b>)<br/><span style="color:${muted}">${s.source}</span>`;
            },
          },
          xAxis: {
            type: "value",
            max: 1600,
            interval: compact ? 800 : 400,
            axisLine: { show: false },
            axisTick: { show: false },
            splitLine: { lineStyle: { color: line, type: "solid", opacity: 0.5 } },
            axisLabel: { color: muted, fontSize: compact ? 10 : 11.5, formatter: "{value}ms" },
          },
          yAxis: {
            type: "category",
            inverse: true,
            data: compact
              ? samples.map((s) => `${s.label.replace("sprint01-", "").replace("final-", "")}·${s.release ? "Rel" : "Exit"}`)
              : samples.map((s) => `${s.label} · ${s.sub}`),
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { color: fg, fontSize: compact ? 10.5 : 11.5 },
          },
          series: [
            {
              type: "bar",
              data: samples.map((s) => ({
                value: s.ms,
                itemStyle: {
                  borderRadius: [0, 3, 3, 0],
                  color: s.release
                    ? new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                        { offset: 0, color: "#1d8c7f" },
                        { offset: 1, color: cyan },
                      ])
                    : new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                        { offset: 0, color: "#768f25" },
                        { offset: 1, color: acid },
                      ]),
                },
              })),
              barWidth: compact ? 11 : 13,
              showBackground: true,
              backgroundStyle: { color: line, opacity: 0.25, borderRadius: [0, 3, 3, 0] },
              label: {
                show: true,
                position: "right",
                distance: compact ? 5 : 8,
                color: fg,
                fontSize: compact ? 10.5 : 11.5,
                formatter: "{c}ms",
              },
              markLine: {
                symbol: "none",
                animation: false,
                lineStyle: { type: "dashed", width: 1.2 },
                label: { fontFamily: MONO, fontSize: compact ? 10 : 11, position: "start", distance: 8 },
                data: [
                  {
                    xAxis: 500,
                    lineStyle: { color: acid },
                    label: { formatter: compact ? "≤500ms" : "Exit ≤500ms", color: acid, align: "right" },
                  },
                  {
                    xAxis: 1500,
                    lineStyle: { color: cyan },
                    label: { formatter: compact ? "≤1500ms" : "Release ≤1500ms (快 3.18×)", color: cyan, align: "right" },
                  },
                ],
              },
            },
          ],
        },
        { notMerge: true },
      );
    };

    paint();
    const ro = new ResizeObserver(() => {
      paint();
      chart.resize();
    });
    ro.observe(el);
    chart.on("click", (p) => {
      const i = p.dataIndex;
      if (typeof i === "number") onPick(i);
    });

    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [samples, onPick]);

  return <div ref={host} className="h-[290px] w-full" role="img" aria-label="实测延迟条形图与两条设计约束线" />;
}
