// 为易拉宝截取工作台真实画面：整页、地图（悬停红线）、详情卡、自检、提案证据链。输出 banner/img/*.png
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('banner/img', { recursive: true });
const t = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } };
const send = (method, params = {}) => Promise.race([new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }), sleep(20000).then(() => ({}))]);
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const rect = async (sel) => JSON.parse(await ev(`JSON.stringify(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect())`));
const shot = async (name, r, pad = 0) => {
  const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: r.x - pad, y: r.y + (await ev('scrollY')) - pad, width: r.width + pad * 2, height: r.height + pad * 2, scale: 2 } });
  fs.writeFileSync(`banner/img/${name}.png`, Buffer.from(s.result.data, 'base64')); console.log(name);
};
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://127.0.0.1:5188/' }); await sleep(8000);
// 乐园 500 万：选点链最完整
await ev(`[...document.querySelectorAll('#industry button')].find(b=>b.textContent==='乐园').click()`); await sleep(3500);
await ev(`document.querySelector('#budgetChips button[data-v="5000000"]').click()`); await sleep(1500);
await ev(`window.scrollTo(0,0)`); await sleep(2500);
const full = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1440, height: 1000, scale: 1.5 } });
fs.writeFileSync('banner/img/workbench.png', Buffer.from(full.result.data, 'base64')); console.log('workbench');
// 地图：悬停一条线变红
await ev(`(()=>{const st=document.getElementById('map')._plan;const o=[...st.byKey.values()].find(o=>o.line);o.line.fire('mouseover');return 1})()`); await sleep(800);
await shot('map', await rect('#map'));
// 详情卡：点清单第一行
await ev(`document.querySelector('#list tbody tr').click()`); await sleep(2500);
await ev(`window.scrollTo(0,0)`); await sleep(500);
await shot('detail', await rect('#detail'));
// 自检
await ev(`document.getElementById('checks').scrollIntoView({block:'center'})`); await sleep(600);
await shot('checks', await rect('#checks'));
// 清单 + 变化：改到 200 万制造变化
await ev(`document.querySelector('#budgetChips button[data-v="2000000"]').click()`); await sleep(1500);
await ev(`document.getElementById('diff').scrollIntoView({block:'center'})`); await sleep(600);
await shot('diff', await rect('#diff'));
ws.close();
