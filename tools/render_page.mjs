// 把 HTML 导出成 PNG 或 PDF（需先开无头 Edge 调试端口 9333）
//   node tools/render_page.mjs <html> <out.png> <宽> <高>     按 2 倍像素截图
//   node tools/render_page.mjs <html> <out.pdf>               按页面 @page 尺寸打印
import fs from 'node:fs';
import path from 'node:path';
const [html, out, w, h] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const pdf = out.endsWith('.pdf');
await send('Emulation.setDeviceMetricsOverride', { width: +w || 1200, height: +h || 1600, deviceScaleFactor: pdf ? 1 : 2, mobile: false });
await send('Page.navigate', { url: 'file:///' + path.resolve(html).replace(/\\/g, '/') }); await sleep(2500);
const sh = (await send('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true })).result.result.value;
console.log('content height', sh);
const r = pdf
  ? await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 })
  : await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: +w, height: +h, scale: 1 } });
fs.writeFileSync(out, Buffer.from(r.result.data, 'base64'));
console.log('ok', out); ws.close();
