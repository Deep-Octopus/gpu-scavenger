import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * 同一台参考节点的三个视角（首屏基板、演示基板、实物 3D）共用「正在看哪张卡」。
 * 在任意一处点选槽位，另外两处跟着点亮同一张卡。
 */
type GpuFocus = { gpu: number; setGpu: (index: number) => void };

const DEFAULT_GPU = 2;

const Ctx = createContext<GpuFocus>({ gpu: DEFAULT_GPU, setGpu: () => {} });

export function GpuFocusProvider({ children }: { children: ReactNode }) {
  const [gpu, setGpu] = useState(DEFAULT_GPU);
  const value = useMemo(() => ({ gpu, setGpu }), [gpu]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGpuFocus(): GpuFocus {
  return useContext(Ctx);
}
