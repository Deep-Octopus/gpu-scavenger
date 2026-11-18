import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";
import { FoxMascot } from "@/src/three/FoxMascot";
import { LAYERS, SxmModule, slotPosition, type Slot } from "@/src/three/SxmModule";
import { boardPcbTexture, lgaTexture, MODULE_PCB } from "@/src/three/textures";

export type { Slot };
export { LAYERS };

export type ViewMode = "board" | "module" | "explode";

const ACID = "#d7f26a";
const GOLD = "#d9b45c";
const CAP = 80_000;

function ease(k: number) {
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

const bladeGeometry = (() => {
  let value: THREE.BufferGeometry | undefined;
  return () => {
    if (value) return value;
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 11; i++) {
      const b = new THREE.BoxGeometry(0.15, 0.01, 0.062);
      b.translate(0.092, 0, 0);
      b.rotateX(0.5);
      b.rotateY((i / 11) * Math.PI * 2);
      parts.push(b);
    }
    const merged = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    value = merged;
    return value;
  };
})();

/** 风鼓：转速跟随整板占用，空卡时几乎停住 */
function Blower({ x, load }: { x: number; load: number }) {
  const blades = useRef<THREE.Mesh>(null);
  const geo = bladeGeometry();
  useFrame((_, dt) => {
    if (blades.current) blades.current.rotation.y += dt * (0.5 + load * 6.4);
  });
  return (
    <group position={[x, 0.104, 0.99]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.2, 0.2, 0.09, 22, 1, true]} />
        <meshStandardMaterial color="#2a322a" roughness={0.5} metalness={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.047, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.148, 0.208, 22]} />
        <meshStandardMaterial color="#525c52" roughness={0.36} metalness={0.85} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={blades} geometry={geo} position={[0, 0.012, 0]}>
        <meshStandardMaterial color="#aab4aa" roughness={0.3} metalness={0.85} />
      </mesh>
      <mesh position={[0, 0.012, 0]}>
        <cylinderGeometry args={[0.05, 0.058, 0.05, 12]} />
        <meshStandardMaterial color="#c2cbc2" roughness={0.25} metalness={0.95} />
      </mesh>
    </group>
  );
}

function Interconnect({ reduced }: { reduced: boolean }) {
  const a = useRef<THREE.MeshStandardMaterial>(null);
  const b = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const w = reduced ? 0.3 : 0.16 + Math.abs(Math.sin(t * 0.9)) * 0.5;
    if (a.current) a.current.emissiveIntensity = w;
    if (b.current) b.current.emissiveIntensity = reduced ? 0.3 : 0.16 + Math.abs(Math.sin(t * 0.9 + 1.4)) * 0.5;
  });
  return (
    <group position={[0, 0.056, 0]}>
      {[-0.62, 0.62].map((x, i) => (
        <mesh key={x} position={[x, 0.014, 0]}>
          <boxGeometry args={[0.42, 0.028, 0.2]} />
          <meshStandardMaterial
            ref={i === 0 ? a : b}
            color="#151a15"
            roughness={0.4}
            metalness={0.7}
            emissive={GOLD}
            emissiveIntensity={0.2}
          />
        </mesh>
      ))}
    </group>
  );
}

/**
 * 八个 SXM 插座笼。模组坐在上面时只露出边框，
 * 释放回放把模组抬起来才看得到底下的 LGA 焊盘——这是「借出去」的物证。
 */
const cageGeometry = (() => {
  let value: THREE.BufferGeometry | undefined;
  return () => {
    if (value) return value;
    const parts: THREE.BufferGeometry[] = [];
    const W = MODULE_PCB.w + 0.06;
    const D = MODULE_PCB.d + 0.06;
    const t = 0.018;
    const h = 0.026;
    for (const s of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const [x, , z] = slotPosition(s);
      for (const [ox, oz, sw, sd] of [
        [0, -(D / 2 - t / 2), W, t],
        [0, D / 2 - t / 2, W, t],
        [-(W / 2 - t / 2), 0, t, D - 2 * t],
        [W / 2 - t / 2, 0, t, D - 2 * t],
      ]) {
        const b = new THREE.BoxGeometry(sw, h, sd);
        b.translate(x + ox, 0.05 + h / 2, z + oz);
        parts.push(b);
      }
    }
    value = mergeGeometries(parts) ?? undefined;
    parts.forEach((p) => p.dispose());
    return value;
  };
})();

function Sockets() {
  const lga = useMemo(() => lgaTexture(), []);
  return (
    <group>
      <mesh geometry={cageGeometry()}>
        <meshStandardMaterial color="#4a544a" roughness={0.42} metalness={0.88} />
      </mesh>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((s) => {
        const [x, , z] = slotPosition(s);
        return (
          <mesh key={s} position={[x, 0.052, z]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[MODULE_PCB.w - 0.04, MODULE_PCB.d - 0.04]} />
            <meshStandardMaterial color="#7f887f" roughness={0.5} metalness={0.55} map={lga} />
          </mesh>
        );
      })}
    </group>
  );
}

function Baseboard({ slots, stamp }: { slots: Slot[]; stamp: string }) {
  const tex = useMemo(() => {
    const labels = slots.map((s) => {
      const [x, , z] = slotPosition(s.index);
      return { slot: s.index, x, z };
    });
    return boardPcbTexture(stamp, labels);
  }, [slots, stamp]);

  return (
    <group>
      <mesh>
        <boxGeometry args={[4.6, 0.1, 2.4]} />
        <meshStandardMaterial attach="material-0" color="#12170f" roughness={0.74} metalness={0.24} />
        <meshStandardMaterial attach="material-1" color="#12170f" roughness={0.74} metalness={0.24} />
        <meshStandardMaterial attach="material-2" color="#cdd5cc" roughness={0.6} metalness={0.28} map={tex} />
        <meshStandardMaterial attach="material-3" color="#0a0c0a" roughness={0.85} metalness={0.12} />
        <meshStandardMaterial attach="material-4" color="#12170f" roughness={0.74} metalness={0.24} />
        <meshStandardMaterial attach="material-5" color="#12170f" roughness={0.74} metalness={0.24} />
      </mesh>
      {/* 裙边与导轨 */}
      <mesh position={[0, -0.075, 0]}>
        <boxGeometry args={[4.74, 0.05, 2.56]} />
        <meshStandardMaterial color="#0d100d" roughness={0.8} metalness={0.2} />
      </mesh>
      {[-1.29, 1.29].map((z) => (
        <mesh key={z} position={[0, -0.02, z]}>
          <boxGeometry args={[4.86, 0.07, 0.06]} />
          <meshStandardMaterial color="#454e45" roughness={0.35} metalness={0.9} />
        </mesh>
      ))}
      {/* 前缘导风罩：三只风鼓装在它上面 */}
      <mesh position={[0, 0.058, 0.99]}>
        <boxGeometry args={[4.5, 0.036, 0.48]} />
        <meshStandardMaterial color="#161b16" roughness={0.62} metalness={0.35} />
      </mesh>
      {/* 后缘供电与四只光口 */}
      {[-1.62, 1.62].map((x) => (
        <mesh key={x} position={[x, 0.09, -1.06]}>
          <boxGeometry args={[0.42, 0.13, 0.22]} />
          <meshStandardMaterial color="#0f130f" roughness={0.7} metalness={0.3} />
        </mesh>
      ))}
      {[-1.02, -0.34, 0.34, 1.02].map((x) => (
        <mesh key={x} position={[x, 0.08, -1.13]}>
          <boxGeometry args={[0.2, 0.07, 0.14]} />
          <meshStandardMaterial color="#a8b2a8" roughness={0.3} metalness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

type Controls = { target: THREE.Vector3; update: () => void; enabled: boolean; autoRotate: boolean };

/** 换视角时把相机推到位，途中锁住 OrbitControls，避免和惯性打架 */
function CameraRig({ mode, selected }: { mode: ViewMode; selected: number }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const [from] = useState(() => new THREE.Vector3());
  const [fromTarget] = useState(() => new THREE.Vector3());
  const [to] = useState(() => new THREE.Vector3());
  const [toTarget] = useState(() => new THREE.Vector3());
  const progress = useRef(1);
  const live = useRef({ mode, selected });
  live.current = { mode, selected };
  /* 整机视角下换卡不该重新锁住轨道控制器 */
  const focusKey = mode === "board" ? "board" : `${mode}:${selected}`;

  useEffect(() => {
    if (!controls) return;
    const { mode: m, selected: sel } = live.current;
    from.copy(camera.position);
    fromTarget.copy(controls.target);
    const [sx, , sz] = slotPosition(sel);
    if (m === "board") {
      to.set(2.35, 2.72, 3.72);
      toTarget.set(0, -0.2, 0.1);
    } else if (m === "module") {
      to.set(sx + 0.62, 0.62, sz + 1.02);
      toTarget.set(sx, 0.02, sz);
    } else {
      to.set(sx + 1.24, 1.06, sz + 1.3);
      toTarget.set(sx, 0.3, sz);
    }
    progress.current = 0;
    controls.enabled = false;
  }, [focusKey, controls, camera, from, fromTarget, to, toTarget]);

  useFrame((_, dt) => {
    if (!controls || progress.current >= 1) return;
    progress.current = Math.min(1, progress.current + dt / 0.78);
    const k = ease(progress.current);
    camera.position.lerpVectors(from, to, k);
    controls.target.lerpVectors(fromTarget, toTarget, k);
    controls.update();
    if (progress.current >= 1) controls.enabled = true;
  });
  return null;
}

function Scene({
  slots,
  selected,
  mode,
  layer,
  lift,
  stamp,
  reduced,
  onSelect,
}: {
  slots: Slot[];
  selected: number;
  mode: ViewMode;
  layer: number | null;
  lift: number;
  stamp: string;
  reduced: boolean;
  onSelect: (i: number) => void;
}) {
  const load = useMemo(() => {
    const sum = slots.reduce((a, s) => a + Math.min(1, (s.oursMiB ?? 0) / CAP + (s.external ? 0.55 : 0)), 0);
    return Math.min(1, sum / slots.length);
  }, [slots]);

  return (
    <group position={[0, -0.12, 0]}>
      <Baseboard slots={slots} stamp={stamp} />
      <Sockets />
      <Interconnect reduced={reduced} />
      {[-1.34, 0, 1.34].map((x) => (
        <Blower key={x} x={x} load={load} />
      ))}
      {slots.map((s) => (
        <SxmModule
          key={s.index}
          slot={s}
          selected={selected === s.index}
          explode={mode === "explode" ? 1 : 0}
          layer={mode === "explode" ? layer : null}
          lift={selected === s.index ? lift : 0}
          reduced={reduced}
          onPick={onSelect}
        />
      ))}
      <ErrorBoundary fallback={null}>
        <Suspense fallback={null}>
          <FoxMascot
            slots={slots}
            selected={selected}
            explode={mode === "explode" ? 1 : 0}
            lift={lift}
            reduced={reduced}
          />
        </Suspense>
      </ErrorBoundary>
      <CameraRig mode={mode} selected={selected} />
      <OrbitControls
        makeDefault
        enableZoom={false}
        enablePan={false}
        autoRotate={!reduced && mode === "board"}
        autoRotateSpeed={0.36}
        enableDamping
        dampingFactor={0.08}
        minPolarAngle={Math.PI * 0.14}
        maxPolarAngle={Math.PI * 0.46}
      />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={2.7} position={[-3, 3, 2]} scale={[5, 3, 1]} color="#f4f8f0" />
        <Lightformer form="rect" intensity={1.3} position={[4, 2.2, -3]} scale={[4, 3, 1]} color={ACID} />
        <Lightformer form="circle" intensity={0.6} position={[0, -3, 0]} scale={7} color="#232a23" />
      </Environment>
    </group>
  );
}

export default function GpuStage(props: {
  slots: Slot[];
  selected: number;
  mode: ViewMode;
  layer: number | null;
  lift: number;
  stamp: string;
  reduced: boolean;
  onSelect: (i: number) => void;
  onReady?: () => void;
}) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [2.35, 2.72, 3.72], fov: 33 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={props.onReady}
    >
      <ambientLight intensity={0.34} />
      <directionalLight position={[3, 5, 2]} intensity={1.15} color="#f2f6ee" />
      <directionalLight position={[-4, 2, -3]} intensity={0.4} color={ACID} />
      <Suspense fallback={null}>
        <Scene {...props} />
      </Suspense>
    </Canvas>
  );
}
