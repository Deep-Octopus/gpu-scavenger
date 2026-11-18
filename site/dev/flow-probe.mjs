#!/usr/bin/env node
/**
 * 状态机几何取证：用 CDP 在无头 Chrome 里读出两张图的实测视口，
 * 逐个检查跃迁标签是否互相重叠、是否压到节点、是否被画布裁掉。
 * 截图看不出的 1~2px 碰撞在这里会变成明确的一行输出。
 *
 *   node dev/flow-probe.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9346;
const chrome = spawn(
  CHROME,
  ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--enable-unsafe-swiftshader",
   `--remote-debugging-port=${PORT}`, "--user-data-dir=/tmp/flow-probe-profile",
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
  return r.result?.value;
};

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1600, deviceScaleFactor: 1, mobile: false });
const urlArg = process.argv.find((a) => a.startsWith("--url="))?.split("=")[1];
await send("Page.navigate", { url: urlArg ?? process.env.PROBE_URL ?? "http://127.0.0.1:5173/" });
await sleep(4200);
await ev(`window.scrollTo(0, document.getElementById('machine').getBoundingClientRect().top + window.scrollY - 56)`);
await sleep(2400);

const PROBE = `(() => {
  const vp = document.querySelector('.react-flow__viewport');
  const wrap = document.querySelector('.react-flow');
  const r = wrap.getBoundingClientRect();
  const nodes = [...document.querySelectorAll('.react-flow__node')].map((e) => {
    const b = e.getBoundingClientRect();
    return { id: e.getAttribute('data-id'), x: +(b.x - r.x).toFixed(1), y: +(b.y - r.y).toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
  });
  const labels = [...document.querySelectorAll('.react-flow__edge text')].map((t) => {
    const b = t.getBoundingClientRect();
    return { t: t.textContent, x: +(b.x - r.x).toFixed(1), y: +(b.y - r.y).toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), fs: getComputedStyle(t).fontSize };
  });
  return { transform: vp.style.transform, wrap: [+r.width.toFixed(1), +r.height.toFixed(1)], nodes, labels };
})()`;

async function report(tag) {
  const d = await ev(PROBE);
  console.log(`\n=== ${tag} === transform=${d.transform} wrap=${d.wrap}`);
  for (const n of d.nodes) console.log(`  node ${n.id.padEnd(13)} x=${n.x} y=${n.y} w=${n.w} h=${n.h}`);
  for (const l of d.labels) console.log(`  lbl  ${l.t.padEnd(23)} x=${l.x} y=${l.y} w=${l.w} h=${l.h} fs=${l.fs}`);
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (let i = 0; i < d.labels.length; i++)
    for (let j = i + 1; j < d.labels.length; j++)
      if (hit(d.labels[i], d.labels[j])) console.log(`  !! OVERLAP: ${d.labels[i].t} <-> ${d.labels[j].t}`);
  for (const l of d.labels) {
    if (l.x < 0 || l.x + l.w > d.wrap[0]) console.log(`  !! H-CLIP: ${l.t} x=${l.x} w=${l.w} / ${d.wrap[0]}`);
    if (l.y < 0 || l.y + l.h > d.wrap[1]) console.log(`  !! V-CLIP: ${l.t} y=${l.y} h=${l.h} / ${d.wrap[1]}`);
    for (const n of d.nodes) if (hit(l, n)) console.log(`  !! ON-NODE: ${l.t} over ${n.id}`);
  }
  const paths = await ev(`[...document.querySelectorAll('.react-flow__edge path')].map(p=>p.getAttribute('d'))`);
  console.log(`  paths:\n   ` + paths.join("\n   "));
}

await report("task");
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='节点'); b.click(); return 1; })()`);
await sleep(1800);
await report("node");
ws.close();
chrome.kill("SIGKILL");
process.exit(0);
