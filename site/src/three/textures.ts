import * as THREE from "three";

/**
 * 程序化 PCB 纹理：把走线、过孔、丝印直接画进 canvas，再贴到实体几何上。
 * 不引外部贴图，保证零网络请求、可离线复现，并且同一 seed 出同一张图。
 */

const SOLDER = "#232b24";
const SOLDER_DARK = "#161b16";
const COPPER = "rgba(198, 214, 190, 0.22)";
const GOLD = "rgba(214, 176, 92, 0.42)";
const SILK = "rgba(196, 210, 192, 0.82)";
const SILK_DIM = "rgba(168, 180, 166, 0.55)";

function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

function surface(w: number, h: number) {
  const el = document.createElement("canvas");
  el.width = w;
  el.height = h;
  const ctx = el.getContext("2d");
  if (!ctx) throw new Error("canvas 2d 不可用");
  ctx.fillStyle = SOLDER;
  ctx.fillRect(0, 0, w, h);
  return { el, ctx, w, h };
}

function toTexture(el: HTMLCanvasElement) {
  const tex = new THREE.CanvasTexture(el);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** 45° 布线：先直走、再斜 45°、再直走，和真实布线器的走法一致 */
function route(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  width: number,
) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const diag = Math.max(0, Math.min(ady, adx * 0.62));
  const sx = Math.sign(dx) || 1;
  const sy = Math.sign(dy) || 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0 + sx * (adx - diag), y0);
  ctx.lineTo(x0 + sx * adx, y0 + sy * diag);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function traceBundle(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rnd: () => number,
  count: number,
  inset: number,
) {
  for (let i = 0; i < count; i++) {
    const fromTop = rnd() > 0.5;
    const x0 = inset + rnd() * (w - inset * 2);
    const y0 = fromTop ? inset * rnd() : h - inset * rnd();
    const x1 = inset + rnd() * (w - inset * 2);
    const y1 = fromTop ? h - inset * rnd() : inset * rnd();
    route(ctx, x0, y0, x1, y1, rnd() > 0.86 ? GOLD : COPPER, 0.8 + rnd() * 1.9);
  }
}

function viaField(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rnd: () => number,
  density = 0.00022,
) {
  const n = Math.round(w * h * density);
  for (let i = 0; i < n; i++) {
    const cx = x + rnd() * w;
    const cy = y + rnd() * h;
    const r = 0.9 + rnd() * 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(196, 210, 192, 0.16)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = SOLDER_DARK;
    ctx.fill();
  }
}

function padGrid(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  step: number,
) {
  ctx.fillStyle = "rgba(206, 218, 200, 0.10)";
  for (let ix = x + step; ix < x + w; ix += step) {
    for (let iy = y + step; iy < y + h; iy += step) {
      ctx.fillRect(ix - 1, iy - 1, 2.2, 2.2);
    }
  }
}

function silkscreen(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  align: CanvasTextAlign = "left",
  color = SILK,
) {
  ctx.font = `600 ${size}px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function rect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  stroke?: string,
) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(x + 0.7, y + 0.7, w - 1.4, h - 1.4);
  }
}

/** 模组 PCB 的物理 footprint，丝印坐标与实体几何共用同一组数字 */
export const MODULE_PCB = { w: 0.88, d: 0.68 } as const;

/**
 * A100/A800 的封装平面：中央一颗 GPU die，六颗 HBM2e 分列两侧，
 * 全部坐在硅中介层上。冷板盖住的就是这一整块。
 */
export const PACKAGE = {
  interposer: { w: 0.56, d: 0.44 },
  die: { w: 0.24, d: 0.28 },
  hbm: { w: 0.095, d: 0.07 },
  sites: [
    [-0.215, -0.14],
    [-0.215, 0],
    [-0.215, 0.14],
    [0.215, -0.14],
    [0.215, 0],
    [0.215, 0.14],
  ] as [number, number][],
} as const;

/** 封装坐标 → 顶面画布坐标：+X 向右，+Z 向下（俯视，前缘在图下方） */
function pcbUv(w: number, h: number, mx: number, mz: number): [number, number] {
  return [(mx / MODULE_PCB.w + 0.5) * w, (mz / MODULE_PCB.d + 0.5) * h];
}

/** 模组正面：封装禁布区 + 四周供电与去耦，丝印留下型号与槽位号 */
let moduleTex: THREE.Texture | null = null;
export function modulePcbTexture(): THREE.Texture {
  if (moduleTex) return moduleTex;
  const W = 512;
  const H = 396;
  const { el, ctx } = surface(W, H);
  const rnd = seeded(20261112);

  traceBundle(ctx, W, H, rnd, 46, 18);
  viaField(ctx, 12, 12, W - 24, H - 24, rnd, 0.00035);

  // 供电与去耦电容：绕着封装排成两圈，越靠近 die 越密
  const ring = (rx: number, rz: number, n: number, cw: number) => {
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      const mx = Math.cos(t) * rx;
      const mz = Math.sin(t) * rz;
      const [cx, cy] = pcbUv(W, H, mx, mz);
      rect(ctx, cx - cw / 2, cy - 3, cw, 6, "rgba(58, 66, 58, 0.85)", "rgba(178,190,176,0.16)");
    }
  };
  ring(0.37, 0.29, 22, 11);
  ring(0.41, 0.24, 14, 9);

  // 封装落位区：中介层压在这里，走线到此为止
  const [ix, iy] = pcbUv(W, H, -PACKAGE.interposer.w / 2, -PACKAGE.interposer.d / 2);
  rect(
    ctx,
    ix,
    iy,
    (PACKAGE.interposer.w / MODULE_PCB.w) * W,
    (PACKAGE.interposer.d / MODULE_PCB.d) * H,
    SOLDER_DARK,
    "rgba(184, 200, 176, 0.22)",
  );
  padGrid(ctx, ix + 6, iy + 6, (PACKAGE.interposer.w / MODULE_PCB.w) * W - 12, (PACKAGE.interposer.d / MODULE_PCB.d) * H - 12, 13);

  silkscreen(ctx, "GPU · 0", 26, H - 22, 22, "left", SILK_DIM);
  silkscreen(ctx, "SXM4", W - 26, 34, 20, "right", SILK_DIM);

  moduleTex = toTexture(el);
  return moduleTex;
}

/**
 * 模组底面：SXM 是 LGA 插座，没有金手指。
 * 一整片焊盘阵列 + 四角定位孔，只有在释放回放把模组抬起来时才看得见。
 */
let lgaTex: THREE.Texture | null = null;
export function lgaTexture(): THREE.Texture {
  if (lgaTex) return lgaTex;
  const W = 512;
  const H = 396;
  const { el, ctx } = surface(W, H);
  ctx.fillStyle = "#0d100d";
  ctx.fillRect(0, 0, W, H);

  const step = 9;
  for (let cx = step; cx < W - step; cx += step) {
    for (let cy = step; cy < H - step; cy += step) {
      // 中央保留一块电容区，其余全是焊盘
      if (cx > W * 0.34 && cx < W * 0.66 && cy > H * 0.34 && cy < H * 0.66) continue;
      ctx.fillStyle = "rgba(206, 218, 200, 0.30)";
      ctx.beginPath();
      ctx.arc(cx, cy, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 定位孔与插座框
  ctx.strokeStyle = "rgba(178, 190, 176, 0.22)";
  ctx.lineWidth = 3;
  ctx.strokeRect(18, 18, W - 36, H - 36);
  for (const [hx, hy] of [
    [30, 30],
    [W - 30, 30],
    [30, H - 30],
    [W - 30, H - 30],
  ]) {
    ctx.beginPath();
    ctx.arc(hx, hy, 10, 0, Math.PI * 2);
    ctx.fillStyle = "#070907";
    ctx.fill();
  }

  lgaTex = toTexture(el);
  return lgaTex;
}


export type BoardLabel = { slot: number; x: number; z: number };

/**
 * 基板顶面：八个插座、中间两颗 NVSwitch、金手指与供电轨，
 * 丝印直接把验收节点的主机名与日期印上去。
 * 世界坐标 → 画布：cx 沿 +X，cy 沿 +Z（俯视，前方朝下）。
 */
let boardTex: THREE.Texture | null = null;
export function boardPcbTexture(stamp: string, labels: BoardLabel[]): THREE.Texture {
  if (boardTex) return boardTex;
  const W = 1024;
  const H = 536;
  const { el, ctx } = surface(W, H);
  const rnd = seeded(773155);

  const toU = (x: number) => ((x + 2.3) / 4.6) * W;
  const toV = (z: number) => ((z + 1.2) / 2.4) * H;

  traceBundle(ctx, W, H, rnd, 78, 30);

  // 三对差分对走成明显的花边，从每个槽位拉到中间交换机
  for (const lb of labels) {
    const x = toU(lb.x);
    const y = toV(lb.z);
    for (let k = 0; k < 3; k++) {
      route(ctx, x, y + (k - 1) * 14, W * 0.5, H * 0.5 + (k - 1) * 22, COPPER, 2.4);
    }
  }

  // 插座：与模组占地一致的黑框 + 焊球阵列
  for (const lb of labels) {
    const x = toU(lb.x);
    const y = toV(lb.z);
    const sw = (1.0 / 4.6) * W;
    const sh = (0.82 / 2.4) * H;
    rect(ctx, x - sw / 2, y - sh / 2, sw, sh, "#0d100d", "rgba(178, 190, 176, 0.26)");
    padGrid(ctx, x - sw / 2 + 6, y - sh / 2 + 6, sw - 12, sh - 12, 11);
    silkscreen(ctx, `GPU${lb.slot}`, x - sw / 2 + 8, y + sh / 2 - 8, 20, "left", SILK);
  }

  // 两颗交换芯片
  for (const cx of [W * 0.5 - 96, W * 0.5 + 96]) {
    rect(ctx, cx - 62, H * 0.5 - 62, 124, 124, "#0f120f", "rgba(196,210,192,0.22)");
    padGrid(ctx, cx - 54, H * 0.5 - 54, 108, 108, 15);
  }

  // 供电轨与金手指沿前缘
  ctx.fillStyle = GOLD;
  ctx.fillRect(40, H - 46, W - 80, 7);
  ctx.fillRect(40, H - 60, W - 80, 4);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = "rgba(214, 176, 92, 0.42)";
    ctx.fillRect(48 + i * ((W - 96) / 40), H - 30, (W - 96) / 40 - 4, 20);
  }

  // 安装孔
  for (const [hx, hy] of [
    [26, 26],
    [W - 26, 26],
    [26, H - 26],
    [W - 26, H - 26],
    [W * 0.5, 22],
    [W * 0.5, H - 22],
  ]) {
    ctx.beginPath();
    ctx.arc(hx, hy, 11, 0, Math.PI * 2);
    ctx.fillStyle = "#0a0c0a";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(196, 210, 192, 0.32)";
    ctx.stroke();
  }

  silkscreen(ctx, "8 × A800-SXM4-80GB", 46, 44, 24, "left", SILK);
  silkscreen(ctx, stamp, W - 46, 44, 19, "right", SILK_DIM);

  boardTex = toTexture(el);
  return boardTex;
}

/** 加性混合的辉光片：假 bloom，省掉后期处理依赖 */
let glowTex: THREE.Texture | null = null;
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const S = 256;
  const { el, ctx } = surface(S, S);
  ctx.clearRect(0, 0, S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.32, "rgba(255,255,255,0.42)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  glowTex = toTexture(el);
  return glowTex;
}
