#!/usr/bin/env node
/**
 * 本地取证脚本：用 CDP 驱动无头 Chrome，在桌面与移动宽度下滚动到每个章节并截图。
 * 只用于本地验证与赛事材料配图，不进入发布产物（dev/ 已在发布目录之外）。
 *
 *   node dev/shoot.mjs                      # 全部章节，1440x900
 *   node dev/shoot.mjs --width=390 --only=sandbox
 *   node dev/shoot.mjs --play              # 额外抓取沙盒操作序列
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdirSync, writeFileSync } from "node:fs";

const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.SHOOT_PORT ?? 9333);
const args = process.argv.slice(2);
const arg = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
};
const URL_BASE = arg("url", process.env.SHOOT_URL ?? "http://127.0.0.1:5173/");
const WIDTH = Number(arg("width", args.includes("--og") ? 1200 : 1440));
const HEIGHT = Number(arg("height", args.includes("--og") ? 630 : 900));
const OUT = arg("out", `/tmp/gpu-site-shots/${WIDTH}`);
const ONLY = arg("only", "");
const PLAY = args.includes("--play");
/** --og：抓首屏作为社交分享图，直接落到 public/img/og.png */
const OG = args.includes("--og");

mkdirSync(OUT, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--enable-unsafe-swiftshader",
    "--allow-file-access-from-files",
    `--remote-debugging-port=${PORT}`,
    "--user-data-dir=/tmp/gpu-site-shoot-profile",
    "--window-size=1440,900",
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
process.on("exit", () => chrome.kill("SIGKILL"));

async function waitForTarget(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* 尚未就绪 */
    }
    await sleep(250);
  }
  throw new Error("无法连接无头 Chrome 的调试端口");
}

const target = await waitForTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", () => rej(new Error("CDP 连接失败")), { once: true });
});

let id = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`${expression} -> ${r.exceptionDetails.text}`);
  return r.result?.value;
};

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: WIDTH,
  height: HEIGHT,
  deviceScaleFactor: WIDTH < 500 ? 2 : 1,
  mobile: WIDTH < 500,
});
await send("Page.navigate", { url: URL_BASE });
await sleep(3600);

if (OG) {
  await sleep(2400);
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  const file = new URL("../public/img/og.png", import.meta.url);
  writeFileSync(file, Buffer.from(data, "base64"));
  console.log(`社交分享图：${file.pathname}`);
  ws.close();
  chrome.kill("SIGKILL");
  process.exit(0);
}

const SECTIONS = [
  "hero",
  "problem",
  "scrub",
  "arch",
  "manifesto",
  "hardware",
  "machine",
  "sandbox",
  "evidence",
  "innovation",
  "delivery",
  "roadmap",
  "submit",
];

/* 懒加载的 3D 画布与图表需要更长的落地时间 */
const WAIT = { hardware: 4200, machine: 1800, evidence: 1600 };

async function shot(name, scrollY, settle = 900) {
  await evaluate(`(() => { window.scrollTo(0, ${scrollY}); return 1; })()`);
  await sleep(settle);
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, "base64"));
  console.log(`${OUT}/${name}.png`);
}

async function top(idSel) {
  return evaluate(
    `(() => { const el = document.getElementById(${JSON.stringify(idSel)}); return el ? Math.max(0, el.getBoundingClientRect().top + window.scrollY - 56) : -1; })()`,
  );
}

for (const s of SECTIONS) {
  if (ONLY && ONLY !== s) continue;
  const y = await top(s);
  if (y < 0) {
    console.log(`跳过 ${s}：页面上找不到该锚点`);
    continue;
  }
  await shot(s, y, WAIT[s] ?? 900);
  if (s === "scrub") {
    await shot("scrub-mid", y + HEIGHT * 0.75, WAIT[s] ?? 900);
    await shot("scrub-end", y + HEIGHT * 1.45, WAIT[s] ?? 900);
  }
  if (s === "machine") {
    const started = await evaluate(`(() => {
      const b = [...document.querySelectorAll('#machine button')].find(x => x.textContent.includes('走一遍'));
      if (!b) return 'missing';
      b.click();
      return 'ok';
    })()`);
    console.log("machine play:", started);
    await sleep(3000);
    await shot("machine-path", y, 400);
    const tab = await evaluate(`(() => {
      const b = [...document.querySelectorAll('#machine button')].find(x => x.textContent.trim() === '节点');
      if (!b) return 'missing';
      b.click();
      return 'ok';
    })()`);
    console.log("machine 节点 tab:", tab);
    await shot("machine-node", y, 1200);
  }
  if (s === "evidence") {
    await shot("evidence-matrix", y + 800, WAIT[s] ?? 900);
  }
  if (s === "innovation") {
    const click = (label) =>
      evaluate(`(() => {
        const b = [...document.querySelectorAll('#innovation button')].find(x => x.textContent.includes(${JSON.stringify(label)}));
        if (!b) return 'missing';
        b.click();
        return 'ok';
      })()`);
    console.log("flip 03:", await click("能力边界声明"));
    await sleep(800);
    await shot("innovation-mix", y, 300);
    console.log("all A:", await click("模拟全部缺失事故"));
    await sleep(700);
    await shot("innovation-a", y, 300);
    await shot("innovation-warn", y + 520, 300);
    console.log("reset:", await click("全部恢复 Scavenger 契约"));
  }
  if (s === "hardware") {
    const picked = await evaluate(`(() => {
      const b = [...document.querySelectorAll('#hardware button')].find(x => x.textContent.trim().startsWith('GPU0'));
      if (!b) return 'missing';
      b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      b.click();
      return 'ok';
    })()`);
    console.log("hardware GPU0:", picked);
    await shot("hardware-busy", y, 1400);
    const view = (label) =>
      evaluate(`(() => {
        const b = [...document.querySelectorAll('#hardware [role=group][aria-label=模型视角] button')].find(x => x.textContent.includes(${JSON.stringify(label)}));
        if (!b) return 'missing';
        b.click();
        return 'ok';
      })()`);
    console.log("hardware 单卡:", await view("单卡"));
    await shot("hardware-module", y, 2000);
    console.log("hardware 拆开:", await view("拆开"));
    await shot("hardware-explode", y, 2000);
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('#hardware li button')].find(x => x.textContent.includes('冷板'));
      if (b) b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      return 1;
    })()`);
    await shot("hardware-layer", y, 900);
    await view("整机");
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('#hardware button')].find(x => x.textContent.trim().startsWith('GPU2'));
      if (b) { b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); b.click(); }
      const run = [...document.querySelectorAll('#hardware button')].find(x => x.textContent.includes('注入任务并释放'));
      if (run) run.click();
      return 1;
    })()`);
    await shot("hardware-release", y, 700);
  }
}

if (PLAY) {
  const y = await top("sandbox");
  await evaluate(`window.scrollTo(0, ${y})`);
  await sleep(500);
  const click = (label) =>
    evaluate(`(() => {
      const b = [...document.querySelectorAll('#sandbox button')].find(x => x.textContent.trim().startsWith(${JSON.stringify(label)}));
      if (!b) return 'missing';
      b.click();
      return 'ok';
    })()`);
  console.log("enqueue:", await click("入队 stateless"), "ckpt:", await click("入队 checkpointed"));
  await sleep(2600);
  await shot("play-running", y);
  console.log("claim:", await click("激活宿主"));
  await sleep(1500);
  await shot("play-claim", y);
  await sleep(2600);
  await shot("play-released", y);
  console.log("nvml:", await click("注入 NVML"));
  await sleep(1400);
  console.log("drop:", await click("断开 Controller"));
  await sleep(1600);
  await shot("play-faults", y);
}

ws.close();
chrome.kill("SIGKILL");
process.exit(0);
