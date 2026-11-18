#!/usr/bin/env node
/**
 * 整页长图：逐屏滚动截取后纵向拼接，再按章节边界切成上下两张。
 * 分段而不是 captureBeyondViewport，是因为时序回放那一节是滚动 scrub 驱动的，
 * 一次性拍全页只会停在起始态。页眉在拍摄期间隐藏，否则每一屏都会重复出现。
 *
 *   node dev/longshot.mjs
 *   node dev/longshot.mjs --width=1280 --dsf=1.5
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const args = process.argv.slice(2);
const arg = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
};
const WIDTH = Number(arg("width", 1440));
const HEIGHT = Number(arg("height", 900));
const DSF = Number(arg("dsf", 1));
const URL_BASE = arg("url", "http://127.0.0.1:5173/");
const PORT = Number(arg("port", 9361));
const OUT = arg("out", "/tmp/gpu-longshots");

mkdirSync(OUT, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--enable-unsafe-swiftshader",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=/tmp/gpu-longshot-profile-${PORT}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
process.on("exit", () => chrome.kill("SIGKILL"));

let target;
for (let i = 0; i < 120; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    target = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (target) break;
  } catch {
    /* 尚未就绪 */
  }
  await sleep(250);
}
if (!target) throw new Error("拿不到 Chrome target");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let msgId = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  }
});
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const n = ++msgId;
    pending.set(n, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval threw");
  return r.result?.value;
};

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: WIDTH,
  height: HEIGHT,
  deviceScaleFactor: DSF,
  mobile: false,
});
await send("Page.navigate", { url: URL_BASE });
await sleep(5000);

/** 关掉平滑滚动，滚动位置才是我们要的那个像素 */
await ev(`document.documentElement.style.scrollBehavior = 'auto'`);

const meta = await ev(`(() => {
  const ids = [...document.querySelectorAll('section[id]')].map((s) => ({
    id: s.id,
    top: Math.round(s.getBoundingClientRect().top + window.scrollY),
  }));
  return {
    total: Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
    ),
    ids,
  };
})()`);

const total = meta.total;
const shots = Math.ceil(total / HEIGHT);
console.log(`页面 ${WIDTH}×${total}，切成 ${shots} 屏`);

/* 章节里最接近中点的那个作为两张长图的分界，不把任何一节劈成两半 */
const mid = total / 2;
const split =
  meta.ids
    .filter((s) => s.top > 400)
    .reduce((best, s) => (Math.abs(s.top - mid) < Math.abs(best.top - mid) ? s : best), meta.ids[1] ?? { top: mid, id: "mid" });
console.log(`分界章节：#${split.id} @ ${split.top}`);

const files = [];
for (let i = 0; i < shots; i++) {
  const y = i * HEIGHT;
  await ev(`window.scrollTo(0, ${y})`);
  /* scrub 的阻尼是 0.55，reveal 是 760ms，留一秒足够落定 */
  await sleep(1050);
  /* 每屏重新隐藏一次：滚动后页眉会被重新挂回 fixed */
  await ev(`(() => {
    let n = 0;
    for (const el of document.querySelectorAll('header')) {
      const s = getComputedStyle(el);
      if (s.position === 'fixed') { el.style.display = 'none'; n++; }
    }
    return n;
  })()`);
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  const f = `${OUT}/seg-${String(i).padStart(2, "0")}.png`;
  writeFileSync(f, Buffer.from(data, "base64"));
  files.push(f);
  process.stdout.write(`   ${i + 1}/${shots}\r`);
}
console.log();

/* 最后一屏通常是空白尾巴，按实际剩余高度裁掉 */
const last = total - (shots - 1) * HEIGHT;
if (last < HEIGHT) {
  execFileSync("magick", [
    files[files.length - 1],
    "-crop",
    `${WIDTH}x${Math.max(1, Math.round(last * DSF))}+0+0`,
    "+repage",
    files[files.length - 1],
  ]);
}

const full = `${OUT}/full.png`;
execFileSync("magick", [files[0], ...files.slice(1), "-append", full]);
const px = Math.round(split.top * DSF);
const hpx = Math.round(total * DSF);
execFileSync("magick", [full, "-crop", `${Math.round(WIDTH * DSF)}x${px}+0+0`, "+repage", `${OUT}/01-top.png`]);
execFileSync("magick", [full, "-crop", `${Math.round(WIDTH * DSF)}x${hpx - px}+0+${px}`, "+repage", `${OUT}/02-bottom.png`]);

for (const f of files) rmSync(f, { force: true });

console.log(`\n${OUT}/01-top.png     ${WIDTH}×${split.top}`);
console.log(`${OUT}/02-bottom.png  ${WIDTH}×${total - split.top}`);
console.log(`${OUT}/full.png       ${WIDTH}×${total}`);

ws.close();
chrome.kill("SIGKILL");
