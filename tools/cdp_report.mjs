// 截取导出提案的指定章节：node tools/cdp_report.mjs <html路径> 章节标题1 章节标题2 ...
import fs from 'node:fs';
import path from 'node:path';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [, , file, ...titles] = process.argv;
const t = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.navigate', { url: 'file:///' + path.resolve(file).replace(/\\/g, '/') }); await sleep(5000);
for (const [i, ti] of titles.entries()) {
  await send('Runtime.evaluate', { expression: `[...document.querySelectorAll('h2')].find((h) => h.textContent.includes(${JSON.stringify(ti)}))?.scrollIntoView()` });
  await sleep(800);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`data/rep-${i}.png`, Buffer.from(s.result.data, 'base64'));
}
console.log('ok'); ws.close();
