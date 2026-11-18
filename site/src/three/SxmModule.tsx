import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { glowTexture, lgaTexture, modulePcbTexture, MODULE_PCB, PACKAGE } from "@/src/three/textures";

export type Slot = {
  index: number;
  label: string;
  usedMiB: number;
  /** 本项目自己占用的部分，单独画一层 */
  oursMiB?: number;
  /** 有不属于本项目的显存占用：只读观测，不下发停止 */
  external?: boolean;
};

const ACID = "#d7f26a";
const GOLD = "#d9b45c";
const CAP = 80_000;
const COLS = 4;
const GAP_X = 1.02;
const GAP_Z = 0.9;
/** 满水位时占用体量的高度，模组坐在它上面 */
const RISE = 0.16;
const SEAT = 0.05;
/** 封装各层的厚度 */
const INTERPOSER_H = 0.006;
const DIE_H = 0.013;
const HBM_DIES = 4;
/** PCB 顶面高度，封装与冷板都从这里往上垒 */
const PCB_TOP = 0.056;
/** 冷板比封装大一圈，鳍片只盖得住中段，后缘留出台阶放快接头 */
const COLD_W = 0.6;
const COLD_D = 0.52;
const COLD_H = 0.032;
const FIN_W = 0.58;
const FIN_D = 0.42;
const SINK_Y = PCB_TOP + COLD_H;

/** 爆炸视图的四层，与图例一一对应 */
export const LAYERS = ["占用体量", "PCB 模组", "冷板 / 均热", "散热鳍片"] as const;

export function slotPosition(index: number): [number, number, number] {
  return [((index % COLS) - (COLS - 1) / 2) * GAP_X, 0, (Math.floor(index / COLS) - 0.5) * GAP_Z];
}

function follow(cur: number, target: number, dt: number, rate = 6) {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

/** 几何一次生成、八个模组共用；同材质的碎片合并成一个 draw call */
function once<T>(make: () => T) {
  let value: T | undefined;
  return () => (value ??= make());
}

function merged(parts: THREE.BufferGeometry[]) {
  const out = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return out;
}

/** 六颗 HBM2e，每颗是四层 die 叠起来的台阶 */
const hbmGeometry = once(() =>
  merged(
    PACKAGE.sites.flatMap(([sx, sz]) => {
      const parts: THREE.BufferGeometry[] = [];
      for (let k = 0; k < HBM_DIES; k++) {
        const shrink = k * 0.004;
        const b = new THREE.BoxGeometry(PACKAGE.hbm.w - shrink, DIE_H / HBM_DIES - 0.0012, PACKAGE.hbm.d - shrink);
        b.translate(
          sx,
          PCB_TOP + INTERPOSER_H + (DIE_H / HBM_DIES) * k + DIE_H / HBM_DIES / 2,
          sz,
        );
        parts.push(b);
      }
      return parts;
    }),
  ),
);

/** 供电电感绕着封装排两圈，冷板盖不住它们 */
const chokeGeometry = once(() => {
  const parts: THREE.BufferGeometry[] = [];
  const push = (x: number, z: number, alongX: boolean) => {
    const b = new THREE.BoxGeometry(alongX ? 0.05 : 0.032, 0.022, alongX ? 0.032 : 0.05);
    b.translate(x, PCB_TOP + 0.011, z);
    parts.push(b);
  };
  const rx = PACKAGE.interposer.w / 2 + 0.055;
  const rz = PACKAGE.interposer.d / 2 + 0.055;
  for (let i = 0; i < 5; i++) {
    const z = -0.16 + (i * 0.32) / 4;
    push(-rx, z, true);
    push(rx, z, true);
  }
  for (let i = 0; i < 5; i++) {
    const x = -0.18 + (i * 0.36) / 4;
    push(x, -rz, false);
    push(x, rz, false);
  }
  return merged(parts);
});

/** 冷板顶面的机加工槽，一眼能看出是均热底而不是一个铁盒子 */
const grooveGeometry = once(() => {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 21; i++) {
    const g = new THREE.BoxGeometry(COLD_W - 0.06, 0.004, 0.007);
    g.translate(0, COLD_H + 0.001, -0.235 + (i * 0.47) / 20);
    parts.push(g);
  }
  return merged(parts);
});

const finGeometry = once(() => {
  const parts: THREE.BufferGeometry[] = [];
  const plate = new THREE.BoxGeometry(FIN_W, 0.014, FIN_D);
  plate.translate(0, 0.007, 0);
  parts.push(plate);
  const N = 17;
  for (let i = 0; i < N; i++) {
    const fin = new THREE.BoxGeometry(FIN_W - 0.04, 0.062, 0.01);
    fin.translate(0, 0.045, -(FIN_D / 2 - 0.02) + (i * (FIN_D - 0.04)) / (N - 1));
    parts.push(fin);
  }
  return merged(parts);
});

export function SxmModule({
  slot,
  selected,
  explode = 0,
  layer = null,
  lift = 0,
  reduced = false,
  onPick,
}: {
  slot: Slot;
  selected: boolean;
  /** 0 = 装配态，1 = 完全拆开 */
  explode?: number;
  /** 爆炸态下被点亮的层 */
  layer?: number | null;
  /** 释放回放时抬起的高度 */
  lift?: number;
  reduced?: boolean;
  onPick: (index: number) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const cold = useRef<THREE.Group>(null);
  const sink = useRef<THREE.Group>(null);
  const pad = useRef<THREE.MeshBasicMaterial>(null);
  const bloom = useRef<THREE.MeshBasicMaterial>(null);
  const axis = useRef<THREE.MeshBasicMaterial>(null);
  const pcbMat = useRef<THREE.MeshStandardMaterial>(null);
  const pkgMat = useRef<THREE.MeshStandardMaterial>(null);
  const hbmMat = useRef<THREE.MeshStandardMaterial>(null);
  const coldMat = useRef<THREE.MeshStandardMaterial>(null);
  const finMat = useRef<THREE.MeshStandardMaterial>(null);
  const extMat = useRef<THREE.MeshStandardMaterial>(null);
  const ourMat = useRef<THREE.MeshStandardMaterial>(null);
  const ledMat = useRef<THREE.MeshStandardMaterial>(null);

  const pos = useMemo(() => slotPosition(slot.index), [slot.index]);
  const pcb = useMemo(() => modulePcbTexture(), []);
  const lga = useMemo(() => lgaTexture(), []);
  const glow = useMemo(() => glowTexture(), []);
  /* 四角括号共用一个材质，才能一起淡入 */
  const ringMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({ color: ACID, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
    [],
  );
  const hbm = hbmGeometry();
  const chokes = chokeGeometry();
  const grooves = grooveGeometry();
  const fins = finGeometry();

  const ours = slot.oursMiB ?? 0;
  const extH = Math.max(0, Math.min(1, (slot.usedMiB - ours) / CAP)) * RISE;
  const ourH = Math.max(0, Math.min(1, ours / CAP)) * RISE;
  const slabH = extH + ourH;
  const idle = !slot.external && ours === 0;

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    const d = Math.min(0.05, dt);
    const t = state.clock.elapsedTime;
    const breathe = reduced ? 0.78 : 0.62 + Math.sin(t * 2.4) * 0.16;

    g.position.y = follow(g.position.y, SEAT + slabH + lift, d, 9);
    if (cold.current) cold.current.position.y = follow(cold.current.position.y, PCB_TOP + explode * 0.24, d, 7);
    if (sink.current) {
      sink.current.position.y = follow(sink.current.position.y, SINK_Y + explode * 0.5, d, 7);
      sink.current.rotation.y = follow(sink.current.rotation.y, explode * 0.15, d, 7);
    }

    if (pad.current) pad.current.opacity = follow(pad.current.opacity, idle ? (selected ? 0.26 : 0.11) : 0.02, d, 5);
    if (bloom.current)
      bloom.current.opacity = follow(bloom.current.opacity, (selected && idle ? 0.2 : idle ? 0.08 : 0.015) * breathe, d, 5);
    ringMat.opacity = follow(ringMat.opacity, selected ? breathe * 0.7 : 0, d, 6);
    if (axis.current) axis.current.opacity = follow(axis.current.opacity, explode > 0.4 ? 0.18 : 0, d, 6);

    /* 选中只轻描边，拆开时点到的那一层才真正打亮 */
    const lit = (ref: typeof pcbMat, idx: number, base: number) => {
      if (!ref.current) return;
      const target = layer === idx ? base : layer === null && selected ? base * 0.14 : 0;
      ref.current.emissiveIntensity = follow(ref.current.emissiveIntensity, target, d, 6);
    };
    lit(pcbMat, 1, 0.3);
    lit(pkgMat, 1, 0.26);
    lit(hbmMat, 1, 0.26);
    lit(coldMat, 2, 0.5);
    lit(finMat, 3, 0.34);
    if (extMat.current)
      extMat.current.emissiveIntensity = follow(extMat.current.emissiveIntensity, layer === 0 ? 0.6 : 0.18, d, 6);
    if (ourMat.current)
      ourMat.current.emissiveIntensity = follow(ourMat.current.emissiveIntensity, (layer === 0 ? 0.9 : 0.45) + (selected ? 0.15 : 0), d, 6);

    if (ledMat.current) {
      const base = idle ? (selected ? 1.9 : 0.7) : 0.14;
      ledMat.current.emissiveIntensity = follow(
        ledMat.current.emissiveIntensity,
        reduced ? base : base * (0.7 + Math.sin(t * 3.4) * 0.3),
        d,
        6,
      );
    }
  });

  return (
    <>
      {/* 贴在基板上的光与占用体量都不随模组抬起 */}
      <group position={[pos[0], 0.05, pos[2]]}>
        <mesh position={[0, 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[1.04, 0.86]} />
          <meshBasicMaterial ref={pad} color={ACID} transparent opacity={0} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[1.5, 1.24]} />
          <meshBasicMaterial
            ref={bloom}
            map={glow}
            color={ACID}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
        {/* 占用体量：下层属于别人，上层是本项目自己的。模组浮在它上面。 */}
        {extH > 0.002 ? (
          <mesh position={[0, extH / 2, 0]}>
            <boxGeometry args={[0.74, extH, 0.58]} />
            <meshStandardMaterial
              ref={extMat}
              color="#a89462"
              emissive={GOLD}
              emissiveIntensity={0.18}
              roughness={0.4}
              metalness={0.2}
              transparent
              opacity={0.7}
              depthWrite={false}
            />
          </mesh>
        ) : null}
        {ourH > 0.002 ? (
          <mesh position={[0, extH + ourH / 2, 0]}>
            <boxGeometry args={[0.74, ourH, 0.58]} />
            <meshStandardMaterial
              ref={ourMat}
              color={ACID}
              emissive={ACID}
              emissiveIntensity={0.45}
              roughness={0.3}
              transparent
              opacity={0.66}
              depthWrite={false}
            />
          </mesh>
        ) : null}
        {/* 选中态的四角括号 */}
        {([
          [-0.5, 0, -0.39, 0.16, 0.012, 0.012],
          [0.5, 0, -0.39, 0.16, 0.012, 0.012],
          [-0.5, 0, 0.39, 0.16, 0.012, 0.012],
          [0.5, 0, 0.39, 0.16, 0.012, 0.012],
          [-0.42, 0, -0.44, 0.012, 0.012, 0.1],
          [0.42, 0, -0.44, 0.012, 0.012, 0.1],
          [-0.42, 0, 0.44, 0.012, 0.012, 0.1],
          [0.42, 0, 0.44, 0.012, 0.012, 0.1],
        ] as const).map(([x, , z, w, h, d], i) => (
          <mesh key={i} position={[x, 0.008, z]} material={ringMat}>
            <boxGeometry args={[w, h, d]} />
          </mesh>
        ))}
      </group>

      <group ref={group} position={[pos[0], SEAT, pos[2]]}>
        {/* 拾取盒：透明但仍可被射线命中，细几何不适合当点击目标 */}
        <mesh
          position={[0, 0.12, 0]}
          onClick={(e) => {
            e.stopPropagation();
            onPick(slot.index);
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            document.body.style.cursor = "";
          }}
        >
          <boxGeometry args={[0.98, 0.52, 0.8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>

        {/* 装配轴线 */}
        <mesh position={[0, 0.34, 0]}>
          <cylinderGeometry args={[0.0035, 0.0035, 0.9, 6]} />
          <meshBasicMaterial ref={axis} color={ACID} transparent opacity={0} depthWrite={false} toneMapped={false} />
        </mesh>

        {/* PCB 模组：顶面走线与丝印，底面是 SXM 插座的 LGA 焊盘 */}
        <mesh position={[0, 0.028, 0]}>
          <boxGeometry args={[MODULE_PCB.w, 0.056, MODULE_PCB.d]} />
          <meshStandardMaterial attach="material-0" color="#171d18" roughness={0.72} metalness={0.2} />
          <meshStandardMaterial attach="material-1" color="#171d18" roughness={0.72} metalness={0.2} />
          <meshStandardMaterial attach="material-2" ref={pcbMat} color="#c9d2c9" roughness={0.62} metalness={0.2} map={pcb} emissive={ACID} emissiveIntensity={0} />
          <meshStandardMaterial attach="material-3" color="#8d978d" roughness={0.5} metalness={0.55} map={lga} />
          <meshStandardMaterial attach="material-4" color="#171d18" roughness={0.72} metalness={0.2} />
          <meshStandardMaterial attach="material-5" color="#171d18" roughness={0.72} metalness={0.2} />
        </mesh>
        {/* 插座压板：模组四边的金属夹条 */}
        {[-0.42, 0.42].map((sx) => (
          <mesh key={sx} position={[sx, 0.03, 0]}>
            <boxGeometry args={[0.03, 0.05, 0.6]} />
            <meshStandardMaterial color="#5a635a" roughness={0.38} metalness={0.9} />
          </mesh>
        ))}
        {/* 前缘螺钉 */}
        {[-0.38, 0.38].map((sx) => (
          <mesh key={sx} position={[sx, 0.062, 0.3]}>
            <cylinderGeometry args={[0.024, 0.026, 0.018, 12]} />
            <meshStandardMaterial color="#9aa39a" roughness={0.3} metalness={0.95} />
          </mesh>
        ))}

        {/* 硅中介层：die 与 HBM 都长在这一块上 */}
        <mesh position={[0, PCB_TOP + INTERPOSER_H / 2, 0]}>
          <boxGeometry args={[PACKAGE.interposer.w, INTERPOSER_H, PACKAGE.interposer.d]} />
          <meshStandardMaterial
            ref={pkgMat}
            color="#232a24"
            roughness={0.55}
            metalness={0.35}
            emissive={ACID}
            emissiveIntensity={0}
          />
        </mesh>
        {/* GPU die：拆掉冷板才看得见，镜面反光是它的辨识点 */}
        <mesh position={[0, PCB_TOP + INTERPOSER_H + DIE_H / 2, 0]}>
          <boxGeometry args={[PACKAGE.die.w, DIE_H, PACKAGE.die.d]} />
          <meshStandardMaterial color="#0b0f0c" roughness={0.16} metalness={0.85} emissive={ACID} emissiveIntensity={0.05} />
        </mesh>
        {/* 六颗 HBM2e 叠成台阶状 */}
        <mesh geometry={hbm} position={[0, 0, 0]}>
          <meshStandardMaterial
            ref={hbmMat}
            color="#141a15"
            roughness={0.42}
            metalness={0.4}
            emissive={ACID}
            emissiveIntensity={0}
          />
        </mesh>
        {/* 供电电感环 */}
        <mesh geometry={chokes}>
          <meshStandardMaterial color="#2c342c" roughness={0.6} metalness={0.5} />
        </mesh>
        {/* 状态灯 */}
        <mesh position={[0.3, 0.06, 0.24]}>
          <boxGeometry args={[0.03, 0.014, 0.018]} />
          <meshStandardMaterial
            ref={ledMat}
            color={idle ? ACID : "#6c736c"}
            emissive={idle ? ACID : "#3a4038"}
            emissiveIntensity={0.4}
            toneMapped={false}
          />
        </mesh>

        {/* 冷板 / 均热底 */}
        <group ref={cold} position={[0, PCB_TOP, 0]}>
          <mesh position={[0, COLD_H / 2, 0]}>
            <boxGeometry args={[COLD_W, COLD_H, COLD_D]} />
            <meshStandardMaterial ref={coldMat} color="#c9d1c8" roughness={0.28} metalness={0.86} emissive={ACID} emissiveIntensity={0.02} />
          </mesh>
          <mesh geometry={grooves}>
            <meshStandardMaterial color="#9aa49a" roughness={0.44} metalness={0.8} />
          </mesh>
          {/* 两颗冷却液快接头，落在鳍片盖不住的后缘台阶上 */}
          {[-0.19, 0.19].map((fx) => (
            <group key={fx} position={[fx, COLD_H + 0.024, -0.243]}>
              <mesh>
                <cylinderGeometry args={[0.018, 0.02, 0.048, 14]} />
                <meshStandardMaterial color="#b6c0b6" roughness={0.3} metalness={0.9} />
              </mesh>
              <mesh position={[0, 0.026, 0]}>
                <cylinderGeometry args={[0.024, 0.024, 0.01, 14]} />
                <meshStandardMaterial color="#6f786f" roughness={0.4} metalness={0.85} />
              </mesh>
              <mesh position={[0, 0.033, 0]}>
                <cylinderGeometry args={[0.012, 0.012, 0.006, 14]} />
                <meshStandardMaterial color="#0c100c" roughness={0.7} metalness={0.2} />
              </mesh>
            </group>
          ))}
          {/* 四颗冷板紧固螺栓，同样放在露出的台阶上 */}
          {([
            [-0.268, -0.243],
            [0.268, -0.243],
            [-0.268, 0.243],
            [0.268, 0.243],
          ] as const).map(([bx, bz]) => (
            <mesh key={`${bx}:${bz}`} position={[bx, COLD_H + 0.005, bz]}>
              <cylinderGeometry args={[0.014, 0.014, 0.012, 6]} />
              <meshStandardMaterial color="#8d978d" roughness={0.32} metalness={0.95} />
            </mesh>
          ))}
        </group>

        {/* 散热鳍片 + 导风框 */}
        <group ref={sink} position={[0, SINK_Y, 0]}>
          <mesh geometry={fins}>
            <meshStandardMaterial ref={finMat} color="#c3ccc2" roughness={0.4} metalness={0.55} emissive={ACID} emissiveIntensity={0} />
          </mesh>
          {[
            [0, 0.039, -(FIN_D / 2 - 0.001), FIN_W, 0.078, 0.012],
            [0, 0.039, FIN_D / 2 - 0.001, FIN_W, 0.078, 0.012],
            [-(FIN_W / 2 - 0.003), 0.039, 0, 0.012, 0.078, FIN_D],
            [FIN_W / 2 - 0.003, 0.039, 0, 0.012, 0.078, FIN_D],
          ].map(([x, y, z, w, h, dd], i) => (
            <mesh key={i} position={[x, y, z]}>
              <boxGeometry args={[w, h, dd]} />
              <meshStandardMaterial color="#39413a" roughness={0.55} metalness={0.7} />
            </mesh>
          ))}
        </group>
      </group>
    </>
  );
}
