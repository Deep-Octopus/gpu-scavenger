import { useEffect } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  ArrowsClockwise,
  Copy,
  Cpu,
  Lightning,
  PlugsConnected,
  ShieldWarning,
  TerminalWindow,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { getLenis, scrollToSection } from "@/src/lib/motion";
import { NAV } from "@/src/lib/nav";
import { ACTIONS, dispatchAction } from "@/src/lib/bus";
import { INSTALL_CMD } from "@/src/data/evidence";

const SANDBOX_COMMANDS = [
  { action: ACTIONS.enqueue, label: "入队一个 stateless 分片", icon: Cpu, hint: "控制台" },
  { action: ACTIONS.enqueueCkpt, label: "入队一个 checkpointed 分片", icon: TerminalWindow, hint: "控制台" },
  { action: ACTIONS.claim, label: "激活宿主 Claim 并抢占", icon: Lightning, hint: "控制台" },
  { action: ACTIONS.unclaim, label: "解除 Claim 恢复调度", icon: ArrowsClockwise, hint: "控制台" },
  { action: ACTIONS.nvmlFail, label: "注入 NVML 探针失败", icon: ShieldWarning, hint: "故障演练" },
  { action: ACTIONS.dropConn, label: "断开 Controller 连接", icon: PlugsConnected, hint: "故障演练" },
];

async function copyText(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what}已复制到剪贴板`);
  } catch {
    toast.error("浏览器拒绝了剪贴板访问，请手动选择文本");
  }
}

export function CommandPalette({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  useEffect(() => {
    const lenis = getLenis();
    if (!lenis) return;
    if (open) {
      lenis.stop();
    } else {
      lenis.start();
    }
    return () => {
      lenis.start();
    };
  }, [open]);

  const run = (fn: () => void) => {
    getLenis()?.start();
    setOpen(false);
    requestAnimationFrame(() => fn());
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="命令面板"
      description="跳转章节、驱动控制台演示或复制安装命令"
      className="border-line bg-surface text-fg sm:max-w-[540px]"
    >
      <CommandInput placeholder="搜索章节、交互动作或安装命令…" />
      <CommandList
        data-lenis-prevent
        onWheel={(e) => e.stopPropagation()}
        className="max-h-[340px] overscroll-contain p-1.5"
      >
        <CommandEmpty className="py-8 text-center text-[13.5px] text-muted">没有匹配的章节或命令。</CommandEmpty>
        <CommandGroup heading="页面章节">
          {NAV.map((s, idx) => (
            <CommandItem
              key={s.id}
              value={`${s.label} ${s.id}`}
              onSelect={() => run(() => scrollToSection(s.id))}
              className="gap-3 px-3 py-2.5"
            >
              <span className="cmd-idx num w-6 text-[12px] font-medium text-muted">
                {String(idx + 1).padStart(2, "0")}
              </span>
              <span className="text-[14px] font-medium">{s.label}</span>
              <span className="num ml-auto text-[11px] text-muted/70">#{s.id}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator className="my-1.5 bg-line/70" />
        <CommandGroup heading="控制台快捷动作">
          {SANDBOX_COMMANDS.map((c) => (
            <CommandItem
              key={c.action}
              value={`${c.label} ${c.hint}`}
              onSelect={() =>
                run(() => {
                  const fired = dispatchAction(c.action);
                  scrollToSection("sandbox");
                  if (!fired) toast.error("控制台还在加载，请稍后再试");
                })
              }
              className="gap-3 px-3 py-2.5"
            >
              <c.icon size={15} weight="duotone" className="text-acid" />
              <span className="text-[14px]">{c.label}</span>
              <span className="micro ml-auto text-[10.5px] text-muted">{c.hint}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator className="my-1.5 bg-line/70" />
        <CommandGroup heading="快捷复制">
          <CommandItem
            value="复制安装命令 install linux 部署"
            onSelect={() => run(() => void copyText(INSTALL_CMD, "安装与校验命令"))}
            className="gap-3 px-3 py-2.5"
          >
            <Copy size={15} weight="duotone" className="text-cyan" />
            <span className="text-[14px]">复制 Linux 5.95MB 一键部署命令</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
      <div className="flex items-center justify-between border-t border-line/80 bg-surface-3 px-3.5 py-2 text-[11.5px] text-muted">
        <div className="flex items-center gap-2">
          <img src="/img/logo-mascot.webp" alt="" aria-hidden="true" className="size-3.5 object-contain" />
          <span className="num text-quiet">GPU Scavenger 快捷指令</span>
        </div>
        <div className="num flex items-center gap-3 text-[11px]">
          <span>↑↓ 选择</span>
          <span>↵ 执行</span>
          <span>ESC 关闭</span>
        </div>
      </div>
    </CommandDialog>
  );
}
