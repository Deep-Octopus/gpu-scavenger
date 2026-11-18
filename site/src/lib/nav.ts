export type NavSection = {
  id: string;
  label: string;
};

export const NAV: NavSection[] = [
  { id: "hero", label: "价值" },
  { id: "problem", label: "问题" },
  { id: "arch", label: "架构" },
  { id: "hardware", label: "硬件" },
  { id: "machine", label: "状态" },
  { id: "sandbox", label: "演示" },
  { id: "evidence", label: "数据" },
  { id: "innovation", label: "创新" },
  { id: "delivery", label: "交付" },
  { id: "roadmap", label: "路线" },
  { id: "submit", label: "上手" },
];

/** 正文顺序，含不进导航的时序回放；页码由此派生，不让 CSS 计数器和锚点错位 */
export const ORDER: string[] = [
  "problem",
  "scrub",
  "arch",
  "hardware",
  "machine",
  "sandbox",
  "evidence",
  "innovation",
  "delivery",
  "roadmap",
  "submit",
];

export function folio(id: string): string | null {
  const i = ORDER.indexOf(id);
  return i < 0 ? null : String(i + 1).padStart(2, "0");
}
