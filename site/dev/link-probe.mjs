#!/usr/bin/env node
/**
 * 演示 ↔ 状态机联动取证：在沙盒里注入动作，检查上方状态机是否点亮了对应那一跳
 * （电脉冲路径、命中描边、实时读数、另一台机器的提示点），以及事件名点下去能否跳到位。
 *
 *   node dev/link-probe.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9347;
const chrome = spawn(
  CHROME,
  ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--enable-unsafe-swiftshader",
   `--remote-debugging-port=${PORT}`, "--user-data-dir=/tmp/link-probe-profile",
   "--window-size=1440,900", "about:blank"],
  { stdio: ["ignore", "ignore", "pipe"] },
);
process.on("exit", () => chrome.kill("SIGKILL"));

let target;
for (let i = 0; i < 80; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    target = l.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (target) break;
  } catch {}
  await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
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
    const n = ++id;
    pending.set(n, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval threw");
  return r.result?.value;
};

const CLICK = (section, text) => `(() => {
  const b = [...document.querySelectorAll('#${section} button')].find((x) => x.textContent.includes(${JSON.stringify(text)}));
  if (!b) return 'missing';
  b.click();
  return 'ok';
})()`;

/** 状态机当前的联动读数：电脉冲、命中描边、实时文本、另一台机器的提示点 */
const STATE = `(() => {
  const m = document.getElementById('machine');
  const live = m.querySelector('[aria-live="polite"]');
  return {
    tracer: m.querySelectorAll('.flow-tracer').length,
    hit: m.querySelectorAll('.node-hit').length,
    ghost: m.querySelectorAll('.ghost-dot').length,
    live: live ? live.textContent.trim() : 'NO-LIVE-REGION',
    acidEdges: [...m.querySelectorAll('.react-flow__edge path.react-flow__edge-path')]
      .filter((p) => getComputedStyle(p).stroke === 'rgb(215, 242, 106)').length,
    tab: [...m.querySelectorAll('button')].filter((b) => /^(任务|节点)$/.test(b.textContent.trim())).map((b) => b.getAttribute('aria-pressed')),
  };
})()`;

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const urlArg = process.argv.find((a) => a.startsWith("--url="))?.split("=")[1];
await send("Page.navigate", { url: urlArg ?? process.env.PROBE_URL ?? "http://127.0.0.1:5173/" });
await sleep(4200);

/** 联动是 1.5 秒的一闪，定点截图会错过：改成按 150ms 采样，只打印出现过的读数 */
async function watch(tag, ms = 2400) {
  const seen = new Set();
  const steps = Math.round(ms / 150);
  for (let i = 0; i < steps; i++) {
    const st = await ev(STATE);
    seen.add(`${st.live} | tracer=${st.tracer} hit=${st.hit} ghost=${st.ghost} acid=${st.acidEdges}`);
    await sleep(150);
  }
  console.log(`\n--- ${tag}`);
  for (const s of seen) console.log("   ", s);
}

/** 等到任务真的进入 Running 再按 Claim，否则链路里没有可停的活儿，release 两跳不会发生 */
const RUNNING = `(() => {
  const rows = [...document.querySelectorAll('#sandbox [data-flip-id]')];
  return rows.some((r) => /running/.test(r.textContent.toLowerCase()));
})()`;
async function waitRunning(ms = 6000) {
  for (let i = 0; i < ms / 200; i++) {
    if (await ev(RUNNING)) return true;
    await sleep(200);
  }
  return false;
}

console.log("reset:", await ev(CLICK("sandbox", "重置")));
await sleep(300);
await watch("idle", 600);

console.log("enqueue:", await ev(CLICK("sandbox", "入队 stateless")));
console.log("running?", await waitRunning());
await watch("enqueue → lease → start");

console.log("claim:", await ev(CLICK("sandbox", "激活宿主 Claim")));
await watch("claim → stop → release → requeue", 3600);

console.log("nvml fail:", await ev(CLICK("sandbox", "NVML 失败")));
await watch("node graph moves while task tab is open", 1600);

console.log("switch to 节点:", await ev(CLICK("machine", "节点")));
await sleep(400);
console.log("restore probe:", await ev(CLICK("sandbox", "恢复探针")));
await watch("probe.recovered on node tab", 1600);

/* 事件名直接点：应跳到 #machine 并点亮那一跳 */
const JUMP = `(() => {
  const b = [...document.querySelectorAll('#sandbox button')].find((x) => x.textContent.trim() === 'probe.recovered');
  if (!b) return 'no probe.recovered row';
  b.click();
  return 'clicked';
})()`;
console.log("jump link:", await ev(JUMP));
await sleep(1000);
const pos = await ev(`Math.round(document.getElementById('machine').getBoundingClientRect().top)`);
console.log("after jump: machine top offset from viewport =", pos, await ev(STATE));

ws.close();
chrome.kill("SIGKILL");
