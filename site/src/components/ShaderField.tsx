import { useEffect, useRef } from "react";
import { Renderer, Program, Mesh, Triangle } from "ogl";
import { prefersReduced, readCssNumber } from "@/src/lib/motion";

/**
 * 背景场：单张全屏三角形 + GLSL fragment shader，无额外后期通道。
 * 融入电路网格十字定位标与酸绿/电青双通道脉冲波纹，强化算力基础设施质感。
 */
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
uniform float uTime;
uniform float uScroll;
uniform vec2 uPointer;
uniform float uAccent;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.04;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = vUv;
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);

  // 机架与基板坐标网格 + 十字标定点
  vec2 cell = vec2(p.x * 18.0, p.y * 12.0 + uScroll * 0.22);
  vec2 g = fract(cell) - 0.5;
  float lines = smoothstep(0.012, 0.0, abs(g.x)) * 0.07 + smoothstep(0.016, 0.0, abs(g.y)) * 0.055;
  float crossMark = smoothstep(0.06, 0.0, length(g)) * 0.14;

  // 呼吸式算力密度场 + 沿对角走线传播的数据脉冲
  float f = fbm(p * 2.1 + vec2(uTime * 0.045, -uTime * 0.03) + uPointer * 0.06);
  f = smoothstep(0.4, 0.94, f);
  float pulseWave = clamp(0.5 + 0.5 * sin(p.x * 5.0 - p.y * 3.5 - uTime * 0.85), 0.0, 1.0);
  float traceGlow = pow(pulseWave, 6.0) * lines * 1.4;

  vec3 base = vec3(0.039, 0.051, 0.043);
  vec3 acid = vec3(0.843, 0.949, 0.416);
  vec3 cyan = vec3(0.176, 0.831, 0.749);
  vec3 deep = vec3(0.45, 0.56, 0.19);

  vec3 col = base;
  col += mix(deep, cyan * 0.42, 0.25) * f * 0.19 * uAccent;
  col += acid * (lines * (0.4 + f) + crossMark * (0.35 + f * 0.7)) * uAccent;
  col += mix(acid, cyan, 0.45) * traceGlow * uAccent;

  // 右上与右下硬件展示区柔和环境光，左侧保持深暗护眼对比度
  float rightGlow = exp(-length(p - vec2(0.48, 0.02)) * 2.1) * 0.09;
  col += acid * rightGlow;

  float vig = smoothstep(1.45, 0.22, length(p * vec2(0.76, 1.0)));
  col *= 0.45 + vig * 0.55;
  float textMask = smoothstep(0.0, 0.65, uv.x + (1.0 - uv.y) * 0.28);
  col *= 0.62 + textMask * 0.38;

  col += (hash(uv * uRes) - 0.5) * 0.016;

  gl_FragColor = vec4(col, 1.0);
}
`;

export function ShaderField({ className = "" }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas || prefersReduced()) return;

    let renderer: Renderer;
    try {
      renderer = new Renderer({ canvas, dpr: Math.min(window.devicePixelRatio || 1, 1.5), alpha: false });
    } catch {
      host.dataset.fallback = "true";
      return;
    }
    const gl = renderer.gl;
    const motion = readCssNumber("--site-motion", 1);
    const uniforms = {
      uRes: { value: [1, 1] },
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uPointer: { value: [0, 0] },
      uAccent: { value: 1 },
    };
    const geometry = new Triangle(gl);
    const program = new Program(gl, {
      vertex: /* glsl */ `
        attribute vec3 position;
        varying vec2 vUv;
        void main() {
          vUv = position.xy * 0.5 + 0.5;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragment: FRAG,
      uniforms,
    });
    const mesh = new Mesh(gl, { geometry, program });

    const resize = () => {
      const r = host.getBoundingClientRect();
      renderer.setSize(r.width, r.height);
      uniforms.uRes.value = [r.width * renderer.dpr, r.height * renderer.dpr];
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const onPointer = (e: PointerEvent) => {
      uniforms.uPointer.value = [
        (e.clientX / window.innerWidth) * 2 - 1,
        -((e.clientY / window.innerHeight) * 2 - 1),
      ];
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    let visible = true;
    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
      },
      { rootMargin: "120px" },
    );
    io.observe(host);

    const start = performance.now();
    let raf = 0;
    let contextLost = false;
    const onContextLost = (e: Event) => {
      e.preventDefault();
      contextLost = true;
      cancelAnimationFrame(raf);
      host.dataset.fallback = "true";
    };
    canvas.addEventListener("webglcontextlost", onContextLost);

    const loop = () => {
      if (contextLost) return;
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      uniforms.uTime.value = ((performance.now() - start) / 1000) * motion;
      uniforms.uScroll.value = window.scrollY / Math.max(1, window.innerHeight);
      renderer.render({ scene: mesh });
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onPointer);
      canvas.removeEventListener("webglcontextlost", onContextLost);
    };
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className={`shader-field ${className}`}
      data-reduced={prefersReduced() ? "true" : undefined}
    >
      <canvas ref={canvasRef} className="h-full w-full opacity-[0.99]" />
    </div>
  );
}
