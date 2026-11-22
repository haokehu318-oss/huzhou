// 把 banner/banner.html 渲染成 1600×4000 PNG（需先开无头 Edge 调试端口 9333）
import fs from 'node:fs';
import path from 'node:path';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 2000, deviceScaleFactor: 2, mobile: false });
await send('Page.navigate', { url: 'file:///' + path.resolve(process.argv[2] || 'banner/banner.html').replace(/\\/g, '/') }); await sleep(2500);
// 内容是否溢出 2000px
const over = await send('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true });
console.log('content height', over.result.result.value);
const parts = await send('Runtime.evaluate', { expression: '[...(document.querySelector(".page") || document.querySelector(".body")).children].map((e) => e.tagName + ":" + Math.round(e.getBoundingClientRect().height)).join(" ")', returnByValue: true });
console.log(parts.result.result.value);
const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 800, height: 2000, scale: 1 } });
fs.writeFileSync(process.argv[3] || 'banner/易拉宝-新云AI提案工作台.png', Buffer.from(s.result.data, 'base64'));
console.log('ok'); ws.close();
