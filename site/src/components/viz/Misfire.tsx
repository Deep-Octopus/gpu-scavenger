import type { ReactNode } from "react";

/**
 * 误伤图解：每张图都画「信号指向谁」与「谁该被停」。
 * 红框 = 该信号实际命中的进程，酸绿 = 本项目真正拥有的进程。
 * 颜色一律走 Tailwind 的 fill / stroke 工具类：SVG 呈现属性里写 var() 不会被解析。
 */
const LABEL = 9;
const NOTE = 9.5;

function Proc({
  x,
  w,
  h,
  label,
  mine = false,
  hit = false,
}: {
  x: number;
  w: number;
  h: number;
  label: string;
  mine?: boolean;
  hit?: boolean;
}) {
  const top = 70 - h;
  const cx = x + w / 2;
  return (
    <g>
      <rect
        x={x}
        y={top}
        width={w}
        height={h}
        rx="1.5"
        strokeWidth="0.8"
        className={mine ? "fill-acid stroke-acid opacity-90" : "fill-surface-2 stroke-line"}
      />
      {hit ? (
        <g className="misfire">
          <rect
            x={x - 4}
            y={top - 4}
            width={w + 8}
            height={h + 8}
            rx="2.5"
            fill="none"
            strokeWidth="1.2"
            strokeDasharray="6 4"
            className="stroke-danger"
          />
          <path
            d={`M${cx - 4.5} ${top + h / 2 - 4.5} L${cx + 4.5} ${top + h / 2 + 4.5} M${cx + 4.5} ${top + h / 2 - 4.5} L${cx - 4.5} ${top + h / 2 + 4.5}`}
            strokeWidth="1.5"
            strokeLinecap="round"
            className="stroke-danger"
            fill="none"
          />
        </g>
      ) : null}
      <text
        x={cx}
        y="92"
        textAnchor="middle"
        fontSize={LABEL}
        className={hit ? "fig-num fill-danger" : "fig-num fill-muted"}
      >
        {label}
      </text>
    </g>
  );
}

function Device({ label }: { label: string }) {
  return (
    <>
      <rect x="8" y="70" width="224" height="13" rx="1.5" strokeWidth="0.8" className="fill-surface-3 stroke-line" />
      <text x="14" y="79.5" fontSize={LABEL} className="fig-num fill-muted">
        {label}
      </text>
    </>
  );
}

function Note({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return (
    <text x="8" y="15" fontSize={NOTE} className={danger ? "fig-num fill-danger" : "fig-num fill-muted"}>
      {children}
    </text>
  );
}

const FIGS: Record<string, ReactNode> = {
  mem: (
    <>
      <Note danger>占用最大 ≠ 我的任务</Note>
      <Device label="GPU2 · 683 / 80000 MiB" />
      <Proc x={20} w={56} h={44} label="训练 A" hit />
      <Proc x={92} w={44} h={20} label="sshd" />
      <Proc x={164} w={56} h={26} label="本任务" mine />
    </>
  ),
  pid: (
    <>
      <Note danger>PID 30211 已被内核复用</Note>
      <Device label="GPU2 · 同一编号" />
      <Proc x={22} w={64} h={30} label="train.py" mine />
      <Proc x={150} w={64} h={40} label="sshd" hit />
      <path d="M86 55 C112 55 124 46 150 46" strokeWidth="1" fill="none" strokeDasharray="3 3" className="stroke-line" />
    </>
  ),
  name: (
    <>
      <Note danger>pkill -f python 命中四个进程</Note>
      <Device label="GPU2 · 同名进程" />
      <Proc x={14} w={44} h={34} label="python" hit />
      <Proc x={66} w={44} h={22} label="python" hit />
      <Proc x={118} w={44} h={40} label="python" hit />
      <Proc x={176} w={44} h={18} label="python" mine />
    </>
  ),
  index: (
    <>
      <Note>nvidia-smi -L 顺序</Note>
      <g>
        {[
          ["GPU0", 12, false],
          ["GPU1", 70, false],
          ["GPU2", 128, true],
          ["GPU3", 186, false],
        ].map(([name, x, isMine]) => (
          <g key={String(name)}>
            <rect
              x={x as number}
              y="34"
              width="44"
              height="30"
              rx="1.5"
              strokeWidth="0.8"
              className={isMine ? "fill-acid stroke-acid opacity-90" : "fill-surface-3 stroke-line"}
            />
            <text
              x={(x as number) + 22}
              y="52"
              textAnchor="middle"
              fontSize={LABEL}
              className={isMine ? "fig-num fill-on-acid" : "fig-num fill-muted"}
            >
              {name}
            </text>
          </g>
        ))}
      </g>
      <g className="misfire">
        <circle cx="56" cy="26" r="4.5" fill="none" strokeWidth="1.3" className="stroke-danger" />
        <path d="M56 30 L56 34" strokeWidth="1.3" fill="none" className="stroke-danger" />
      </g>
      <text x="8" y="82" fontSize={NOTE} className="fig-num fill-danger">
        驱动升级后 index 2 指向另一张卡
      </text>
    </>
  ),
};

export function Misfire({ kind, caption }: { kind: keyof typeof FIGS; caption?: string }) {
  return (
    <figure className="m-0">
      <svg viewBox="0 0 240 104" role="img" aria-label={caption ?? `图解：${kind}`} className="w-full">
        {FIGS[kind]}
      </svg>
      {caption ? <figcaption className="sr-only">{caption}</figcaption> : null}
    </figure>
  );
}
