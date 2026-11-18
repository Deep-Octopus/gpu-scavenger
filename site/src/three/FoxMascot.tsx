import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { slotPosition, type Slot } from "@/src/three/SxmModule";

const MODEL_URL = "/models/fox.glb";
const FOX_SCALE = 0.0028;
const IDLE_YAW = -0.45;

const COLOR_ACID = new THREE.Color("#d7f26a");
const COLOR_CYAN = new THREE.Color("#2dd4bf");
const COLOR_WARN = new THREE.Color("#f5b942");

function slotTopY(slot: Slot, lift: number, explode: number): number {
  const ours = slot.oursMiB ?? 0;
  const slabH =
    Math.max(0, Math.min(1, (slot.usedMiB - ours) / 80_000)) * 0.16 +
    Math.max(0, Math.min(1, ours / 80_000)) * 0.16;
  return 0.216 + slabH + lift + explode * 0.5;
}

function shortestAngleDiff(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/**
 * 3D 骨骼动画耳廓狐算力哨兵：
 * 选中任意显卡槽位时沿抛物线越过 NVSwitch 基板精准跃迁至目标模组顶面；
 * 在宿主受保护槽位展开只读磁悬浮琥珀护盾，体现「100% 零惊扰宿主」核心边界。
 */
export function FoxMascot({
  slots,
  selected,
  explode,
  lift,
  reduced,
}: {
  slots: Slot[];
  selected: number;
  explode: number;
  lift: number;
  reduced: boolean;
}) {
  const gltf = useGLTF(MODEL_URL, false, false);
  const { scene, animations } = gltf;

  const foxGroup = useRef<THREE.Group>(null);
  const tiltGroup = useRef<THREE.Group>(null);
  const modelRef = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);

  const rippleMesh = useRef<THREE.Mesh>(null);
  const rippleMat = useRef<THREE.MeshBasicMaterial>(null);

  const shieldGroup = useRef<THREE.Group>(null);
  const shieldFillMat = useRef<THREE.MeshBasicMaterial>(null);
  const shieldRingMat = useRef<THREE.MeshBasicMaterial>(null);
  const shieldInnerMat = useRef<THREE.MeshBasicMaterial>(null);

  const { actions } = useAnimations(animations, modelRef);
  const currentAction = useRef<string>("");

  const holoMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#223027",
        emissive: "#d7f26a",
        emissiveIntensity: 0.38,
        roughness: 0.34,
        metalness: 0.58,
        flatShading: true,
      }),
    [],
  );

  useEffect(() => {
    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.material = holoMat;
        mesh.frustumCulled = false;
      }
    });
  }, [scene, holoMat]);

  useEffect(() => () => holoMat.dispose(), [holoMat]);

  const initialSlot = slots[selected] ?? slots[0];
  const initialPos = useMemo(() => {
    const [ix, , iz] = slotPosition(initialSlot.index);
    const baseY = slotTopY(initialSlot, lift, explode);
    return new THREE.Vector3(ix, baseY + (initialSlot.external ? 0.052 : 0.004), iz);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flight = useRef({
    active: false,
    progress: 1,
    duration: 0.56,
    from: initialPos.clone(),
    cur: initialPos.clone(),
    yaw: IDLE_YAW,
    lastSlot: selected,
    rippleAge: 9,
  });

  const playClip = (name: "Survey" | "Walk" | "Run", speed = 1) => {
    const next = actions[name];
    if (!next) return;
    if (currentAction.current !== name) {
      const prev = currentAction.current ? actions[currentAction.current] : undefined;
      prev?.fadeOut(0.14);
      next.reset().setEffectiveWeight(1).fadeIn(0.14).play();
      currentAction.current = name;
    }
    next.setEffectiveTimeScale(reduced ? 0 : speed);
  };

  useEffect(() => {
    playClip("Survey", 0.9);
    return () => {
      Object.values(actions).forEach((a) => a?.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions]);

  useEffect(() => {
    const f = flight.current;
    if (selected === f.lastSlot) return;
    f.lastSlot = selected;
    f.from.copy(f.cur);
    const [tx, , tz] = slotPosition(selected);
    const dist = Math.hypot(tx - f.from.x, tz - f.from.z);
    if (reduced) {
      const targetSlot = slots[selected] ?? slots[0];
      const ty = slotTopY(targetSlot, lift, explode) + (targetSlot.external ? 0.052 : 0.004);
      f.cur.set(tx, ty, tz);
      f.active = false;
      f.progress = 1;
      f.rippleAge = 0;
      if (foxGroup.current) {
        foxGroup.current.position.copy(f.cur);
        foxGroup.current.rotation.y = IDLE_YAW;
      }
      return;
    }
    f.duration = Math.min(0.66, 0.4 + dist * 0.075);
    f.progress = 0;
    f.active = true;
    playClip("Run", 1.85);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, reduced]);

  const targetColor = useMemo(() => new THREE.Color(), []);

  useFrame((state, dt) => {
    const d = Math.min(0.05, dt);
    const t = state.clock.elapsedTime;
    const f = flight.current;
    const targetSlot = slots[selected] ?? slots[0];
    const [tx, , tz] = slotPosition(selected);
    const baseTopY = slotTopY(targetSlot, lift, explode);
    const hoverOffset = targetSlot.external ? 0.052 + (reduced ? 0 : Math.sin(t * 2.6) * 0.008) : 0.004;
    const destY = baseTopY + hoverOffset;

    if (f.active) {
      f.progress = Math.min(1, f.progress + d / f.duration);
      const p = f.progress;
      const u = p * p * (3 - 2 * p);
      const dist = Math.hypot(tx - f.from.x, tz - f.from.z);
      const jumpH = 0.25 + dist * 0.13;
      const arcY = Math.sin(Math.PI * p) * jumpH;

      f.cur.x = THREE.MathUtils.lerp(f.from.x, tx, u);
      f.cur.z = THREE.MathUtils.lerp(f.from.z, tz, u);
      f.cur.y = THREE.MathUtils.lerp(f.from.y, destY, u) + arcY;

      const dx = tx - f.from.x;
      const dz = tz - f.from.z;
      if (Math.hypot(dx, dz) > 0.02) {
        const flyYaw = Math.atan2(dx, dz);
        f.yaw += shortestAngleDiff(f.yaw, flyYaw) * Math.min(1, d * 14);
      }

      if (tiltGroup.current) {
        tiltGroup.current.rotation.x = -Math.sin(Math.PI * 2 * p) * 0.24;
      }

      if (p >= 1) {
        f.active = false;
        f.rippleAge = 0;
      }
    } else {
      f.cur.x = THREE.MathUtils.lerp(f.cur.x, tx, Math.min(1, d * 12));
      f.cur.z = THREE.MathUtils.lerp(f.cur.z, tz, Math.min(1, d * 12));
      f.cur.y = THREE.MathUtils.lerp(f.cur.y, destY, Math.min(1, d * 14));
      f.yaw += shortestAngleDiff(f.yaw, IDLE_YAW) * Math.min(1, d * 4.5);

      if (tiltGroup.current) {
        tiltGroup.current.rotation.x = THREE.MathUtils.lerp(tiltGroup.current.rotation.x, 0, Math.min(1, d * 10));
      }

      const activeElastic = (targetSlot.oursMiB ?? 0) > 0 || lift > 0.01;
      if (activeElastic) {
        playClip("Walk", 1.35);
      } else {
        playClip("Survey", 0.9);
      }
    }

    if (foxGroup.current) {
      foxGroup.current.position.copy(f.cur);
      foxGroup.current.rotation.y = f.yaw;
    }

    // 目标色彩状态插值：宿主保护=琥珀警告，运行/释放=电青，弹性可借=酸绿
    const hasOurWork = (targetSlot.oursMiB ?? 0) > 0 || lift > 0.01;
    targetColor.copy(targetSlot.external ? COLOR_WARN : hasOurWork ? COLOR_CYAN : COLOR_ACID);
    holoMat.emissive.lerp(targetColor, Math.min(1, d * 8));
    holoMat.emissiveIntensity = THREE.MathUtils.lerp(
      holoMat.emissiveIntensity,
      f.active ? 0.68 : 0.38 + (reduced ? 0 : Math.sin(t * 2.8) * 0.06),
      Math.min(1, d * 8),
    );

    if (lightRef.current) {
      lightRef.current.position.set(f.cur.x, f.cur.y + 0.16, f.cur.z);
      lightRef.current.color.copy(holoMat.emissive);
      lightRef.current.intensity = f.active ? 0.95 : 0.65;
    }

    // 落地波纹扩散
    if (f.rippleAge < 0.7) {
      f.rippleAge += d;
      const k = Math.min(1, f.rippleAge / 0.7);
      if (rippleMesh.current && rippleMat.current) {
        rippleMesh.current.position.set(tx, baseTopY + 0.006, tz);
        const s = 0.55 + k * 1.75;
        rippleMesh.current.scale.set(s, s, 1);
        rippleMat.current.color.copy(targetColor);
        rippleMat.current.opacity = (1 - k) * (1 - k) * 0.85;
      }
    } else if (rippleMat.current) {
      rippleMat.current.opacity = 0;
    }

    // 宿主保护槽位的只读磁悬浮护盾
    if (shieldGroup.current && shieldFillMat.current && shieldRingMat.current && shieldInnerMat.current) {
      const showShield = targetSlot.external && !f.active ? 1 : 0;
      shieldGroup.current.position.set(tx, baseTopY + 0.044, tz);
      shieldGroup.current.rotation.y += reduced ? 0 : d * 0.55;
      shieldFillMat.current.opacity = THREE.MathUtils.lerp(shieldFillMat.current.opacity, showShield * 0.18, Math.min(1, d * 8));
      shieldRingMat.current.opacity = THREE.MathUtils.lerp(shieldRingMat.current.opacity, showShield * 0.82, Math.min(1, d * 8));
      shieldInnerMat.current.opacity = THREE.MathUtils.lerp(shieldInnerMat.current.opacity, showShield * 0.45, Math.min(1, d * 8));
    }
  });

  return (
    <group>
      <pointLight ref={lightRef} distance={1.1} intensity={0.65} decay={2} color="#d7f26a" />

      <group ref={foxGroup} position={initialPos}>
        <group ref={tiltGroup}>
          <group ref={modelRef} scale={FOX_SCALE}>
            <primitive object={scene} />
          </group>
        </group>
      </group>

      {/* 落地脉冲波纹环 */}
      <mesh ref={rippleMesh} rotation={[-Math.PI / 2, 0, 0]} position={[initialPos.x, initialPos.y, initialPos.z]}>
        <ringGeometry args={[0.09, 0.135, 32]} />
        <meshBasicMaterial
          ref={rippleMat}
          color="#d7f26a"
          transparent
          opacity={0}
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 宿主受保护显卡专属：琥珀色只读隔离磁悬浮护盾盘 */}
      <group ref={shieldGroup} position={[initialPos.x, initialPos.y, initialPos.z]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.24, 32]} />
          <meshBasicMaterial
            ref={shieldFillMat}
            color="#f5b942"
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
          <ringGeometry args={[0.23, 0.258, 36]} />
          <meshBasicMaterial
            ref={shieldRingMat}
            color="#f5b942"
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
          <ringGeometry args={[0.14, 0.154, 6]} />
          <meshBasicMaterial
            ref={shieldInnerMat}
            color="#f5b942"
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
    </group>
  );
}

useGLTF.preload(MODEL_URL, false, false);
