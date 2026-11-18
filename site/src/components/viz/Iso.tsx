import type { CSSProperties, ReactNode } from "react";

/**
 * 等距实物件：所有几何在世界单位里描述，投影后乘 S 落到 SVG 用户单位。
 * 颜色一律走 style={{ fill }}，因为 var() 在 SVG 呈现属性里不生效。
 */
const K = 0.8660254038;
const S = 100;

export const MAT = {
  board: "var(--color-surface-2)",
  boardDark: "var(--color-surface-3)",
  metal: "var(--color-quiet)",
  acid: "var(--color-acid)",
  gold: "var(--color-warn)",
  muted: "var(--color-muted)",
  danger: "var(--color-danger)",
  line: "var(--color-line)",
} as const;

function px(x: number, z: number) {
  return (x - z) * K * S;
}
function py(x: number, y: number, z: number) {
  return ((x + z) * 0.5 - y) * S;
}
export function spot(x: number, y: number, z: number): [number, number] {
  return [px(x, z), py(x, y, z)];
}

function corner(x: number, y: number, z: number) {
  return `${px(x, z).toFixed(1)},${py(x, y, z).toFixed(1)}`;
}

/** 三个可见面的顶点串：顶面 / 左前面 / 右前面 */
export function boxFaces(
  at: [number, number, number],
  size: [number, number, number],
): [string, string, string] {
  const [x0, y0, z0] = at;
  const x1 = x0 + size[0];
  const y1 = y0 + size[1];
  const z1 = z0 + size[2];
  return [
    [corner(x0, y1, z0), corner(x1, y1, z0), corner(x1, y1, z1), corner(x0, y1, z1)].join(" "),
    [corner(x0, y1, z1), corner(x1, y1, z1), corner(x1, y0, z1), corner(x0, y0, z1)].join(" "),
    [corner(x1, y1, z0), corner(x1, y1, z1), corner(x1, y0, z1), corner(x1, y0, z0)].join(" "),
  ];
}

export function Box({
  at,
  size,
  fill,
  shades = [1, 0.56, 0.38],
  opacity,
  stroke,
  className,
  style,
}: {
  at: [number, number, number];
  size: [number, number, number];
  fill: string;
  /** 顶面 / 左前面 / 右前面 的明度，靠透明度在近黑底上分层 */
  shades?: [number, number, number];
  opacity?: number;
  stroke?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const faces = boxFaces(at, size);
  return (
    <g className={className} style={style}>
      {faces.map((points, i) => (
        <polygon
          key={i}
          points={points}
          style={{
            fill,
            opacity: (opacity ?? 1) * shades[i],
            stroke: stroke ?? "transparent",
            strokeWidth: stroke ? 0.6 : undefined,
          }}
        />
      ))}
    </g>
  );
}

/** 贴在基板平面上的丝印文字：随平面剪切，字号用世界单位 */
export function Silk({
  at,
  children,
  size = 0.15,
  fill = MAT.muted,
  weight = 500,
  anchor = "start",
  tracking = 0.02,
  opacity = 1,
}: {
  at: [number, number, number];
  children: ReactNode;
  size?: number;
  fill?: string;
  weight?: number;
  anchor?: "start" | "middle" | "end";
  tracking?: number;
  opacity?: number;
}) {
  const [x, y, z] = at;
  return (
    <text
      transform={`matrix(${(K * S).toFixed(2)},${(0.5 * S).toFixed(2)},${(-K * S).toFixed(2)},${(0.5 * S).toFixed(2)},${px(x, z).toFixed(1)},${py(x, y, z).toFixed(1)})`}
      x={0}
      y={0}
      fontSize={size}
      fontWeight={weight}
      textAnchor={anchor}
      style={{ fill, opacity, fontFamily: "var(--mono)", letterSpacing: `${tracking}em` }}
    >
      {children}
    </text>
  );
}

/** 平面上的走线：只画可见的两段侧面投影，避免闭包 */
export function Trace({
  from,
  to,
  y = 0.001,
  stroke = MAT.gold,
  width = 1.6,
  opacity = 0.34,
  dash,
}: {
  from: [number, number];
  to: [number, number];
  y?: number;
  stroke?: string;
  width?: number;
  opacity?: number;
  dash?: string;
}) {
  return (
    <line
      x1={px(from[0], from[1])}
      y1={py(from[0], y, from[1])}
      x2={px(to[0], to[1])}
      y2={py(to[0], y, to[1])}
      style={{ stroke, strokeWidth: width, opacity, strokeDasharray: dash }}
    />
  );
}

export type IsoSlot = {
  index: number;
  label: string;
  usedMiB: number;
  /** 本项目自己占用的部分，画在液柱上层 */
  oursMiB?: number;
  /** 有不属于本项目的占用：控制面只读，永不下发停止 */
  external?: boolean;
  /** 能力门禁通过，可以接活 */
  schedulable?: boolean;
  /** 本次演示不驱动的槽位：只读展示，不可交互 */
  observed?: boolean;
};

const CAP = 80_000;
const MAX_RISE = 0.98;
const COLS = 4;
const CX = [-3.36, -1.12, 1.12, 3.36];
const CZ = [-1.42, 1.42];

function rise(mib: number) {
  return Math.max(0.07, Math.min(MAX_RISE, (mib / CAP) * MAX_RISE));
}

function Module({
  slot,
  on,
  onSelect,
}: {
  slot: IsoSlot;
  on: boolean;
  onSelect: (i: number) => void;
}) {
  const cx = CX[slot.index % COLS];
  const cz = CZ[Math.floor(slot.index / COLS)];
  const ours = slot.oursMiB ?? 0;
  const idle = !slot.external && ours === 0 && slot.usedMiB <= 1024;
  const total = rise(slot.usedMiB);
  const oursH = slot.usedMiB > 0 ? (ours / slot.usedMiB) * total : 0;
  const extH = total - oursH;
  /* 槽位越满，模组从 socket 里顶得越高；平齐发亮的就是能借的 */
  const base = 0.14;
  const top = base + total;
  const live = !slot.observed;

  return (
    <g
      className={live ? "iso-slot" : undefined}
      style={{ opacity: slot.observed ? 0.45 : 1 }}
      role={live ? "button" : undefined}
      tabIndex={live ? 0 : undefined}
      aria-label={
        live
          ? `${slot.label} ${slot.usedMiB.toLocaleString()} MiB · ${idle ? "空闲可借" : slot.external ? "他人占用" : "本任务占用"}`
          : undefined
      }
      aria-pressed={live ? on : undefined}
      onClick={live ? () => onSelect(slot.index) : undefined}
      onMouseEnter={live ? () => onSelect(slot.index) : undefined}
      onFocus={live ? () => onSelect(slot.index) : undefined}
      onKeyDown={
        live
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(slot.index);
              }
            }
          : undefined
      }
    >
      {/* socket 与门禁通过时的光晕 */}
      <Box at={[cx - 0.98, 0.1, cz - 0.8]} size={[1.96, 0.05, 1.6]} fill={MAT.boardDark} shades={[0.62, 0.4, 0.28]} />
      <polygon
        className="iso-pad"
        points={[
          corner(cx - 0.98, 0.155, cz - 0.8),
          corner(cx + 0.98, 0.155, cz - 0.8),
          corner(cx + 0.98, 0.155, cz + 0.8),
          corner(cx - 0.98, 0.155, cz + 0.8),
        ].join(" ")}
        style={{ fill: idle || on ? MAT.acid : MAT.line, opacity: on ? 0.4 : idle ? 0.2 : 0.06 }}
      />
      {/* 显存体量：下层是别人的，上层是本项目自己的 */}
      {extH > 0.02 ? (
        <Box at={[cx - 0.8, base, cz - 0.62]} size={[1.6, extH, 1.24]} fill={slot.external ? MAT.muted : MAT.gold} shades={[0.42, 0.3, 0.2]} />
      ) : null}
      {oursH > 0.02 ? (
        <Box at={[cx - 0.8, base + extH, cz - 0.62]} size={[1.6, oursH, 1.24]} fill={MAT.acid} shades={[0.5, 0.34, 0.24]} />
      ) : null}
      {/* 基板 + 均热盖 */}
      <Box at={[cx - 0.86, top, cz - 0.68]} size={[1.72, 0.07, 1.36]} fill={MAT.board} shades={[0.95, 0.5, 0.32]} />
      <Box at={[cx - 0.3, top + 0.07, cz - 0.26]} size={[0.6, 0.06, 0.52]} fill={MAT.metal} shades={[0.95, 0.42, 0.28]} />
      <Box at={[cx - 0.14, top + 0.13, cz - 0.12]} size={[0.28, 0.03, 0.24]} fill={idle ? MAT.acid : MAT.boardDark} shades={[0.95, 0.5, 0.34]} />
      {/* 供电模组沿前缘排开 */}
      {[-0.62, -0.34, -0.06, 0.22, 0.5].map((o) => (
        <Box key={o} at={[cx + o, top + 0.07, cz + 0.4]} size={[0.13, 0.045, 0.1]} fill={MAT.boardDark} shades={[0.85, 0.5, 0.34]} />
      ))}
      {[
        [cx - 0.76, cz - 0.56],
        [cx + 0.76, cz + 0.56],
      ].map(([sx, sz]) => (
        <Box key={`${sx}-${sz}`} at={[sx - 0.045, top + 0.07, sz - 0.045]} size={[0.09, 0.03, 0.09]} fill={MAT.metal} shades={[0.7, 0.4, 0.26]} />
      ))}
    </g>
  );
}

export function IsoBoard({
  slots,
  selected,
  onSelect,
  stamp,
  className,
  reduced,
  labelSize = 0.28,
}: {
  slots: IsoSlot[];
  selected: number;
  onSelect: (i: number) => void;
  stamp?: string;
  className?: string;
  reduced?: boolean;
  labelSize?: number;
}) {
  const ordered = [...slots].sort(
    (a, b) =>
      a.index / COLS - b.index / COLS ||
      (CX[a.index % COLS] + CZ[Math.floor(a.index / COLS)]) -
        (CX[b.index % COLS] + CZ[Math.floor(b.index / COLS)]),
  );
  return (
    <svg
      viewBox="-700 -420 1400 840"
      className={className}
      role="group"
      aria-label="8 槽位 SXM 基板显存水位"
      style={{ overflow: "visible" }}
    >
      {/* 基板 */}
      <Box at={[-4.72, 0, -2.86]} size={[9.44, 0.14, 5.72]} fill={MAT.boardDark} shades={[0.85, 0.5, 0.34]} />
      {/* 走线：中间总线 + 每个槽位的分支 */}
      <Trace from={[-4.4, 0]} to={[4.4, 0]} width={2.4} opacity={0.4} />
      <Trace from={[-4.4, -0.2]} to={[4.4, -0.2]} width={1.2} opacity={0.22} />
      <Trace from={[-4.4, 0.2]} to={[4.4, 0.2]} width={1.2} opacity={0.22} />
      {slots.map((s) => {
        const cx = CX[s.index % COLS];
        const cz = CZ[Math.floor(s.index / COLS)];
        return <Trace key={s.index} from={[cx, 0]} to={[cx, cz * 0.72]} width={1.4} opacity={0.26} />;
      })}
      {/* 金手指沿前缘，丝印紧随其后 */}
      {Array.from({ length: 22 }, (_, i) => -3.9 + i * 0.36).map((x) => (
        <Box key={x} at={[x, 0.14, 2.68]} size={[0.2, 0.03, 0.16]} fill={MAT.gold} shades={[0.62, 0.4, 0.26]} />
      ))}
      <Silk at={[-4.34, 0.16, 2.44]} size={0.26} fill={MAT.muted} opacity={0.75}>
        8 × A800-SXM4-80GB
      </Silk>
      {stamp ? (
        <Silk at={[0.9, 0.16, 2.44]} size={0.26} fill={MAT.muted} opacity={0.6}>
          {stamp}
        </Silk>
      ) : null}

      {ordered.map((s) => (
        <g key={s.index} className={reduced ? undefined : "iso-in"} style={{ animationDelay: `${s.index * 55}ms` }}>
          <Module slot={s} on={selected === s.index} onSelect={onSelect} />
          <Silk
            at={[CX[s.index % COLS] - 0.9, 0.16, CZ[Math.floor(s.index / COLS)] + 0.72]}
            size={labelSize}
            weight={600}
            fill={selected === s.index ? MAT.acid : MAT.muted}
            opacity={selected === s.index ? 1 : 0.85}
          >
            {s.label}
          </Silk>
        </g>
      ))}
    </svg>
  );
}
