// 截某条线路在不同缩放级别下的地图（检查贴路和线宽）：node tools/cdp_zoom.mjs 18
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const name = process.argv[2] || '18';
const t = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } };
const send = (method, params = {}) => Promise.race([new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }), sleep(15000).then(() => ({}))]);
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://127.0.0.1:5188/' }); await sleep(7000);
await ev(`document.getElementById('forceKw').value='${name}路'`); await ev(`document.getElementById('forceGo').click()`); await sleep(2500);
const rect = await ev(`JSON.stringify(document.getElementById('map').getBoundingClientRect())`);
const r = JSON.parse(rect);
for (const z of [11, 13, 15, 16]) {
  await ev(`(()=>{const st=document.getElementById('map')._plan,o=[...st.byKey.values()].find(o=>o.line&&o.line.options.weight>o.base.weight*0.9&&o.line.options.opacity===1)||[...st.byKey.values()].find(o=>o.line);const ll=o.line.getLatLngs();st.map.setView(ll[Math.floor(ll.length*0.4)],${z})})()`); await sleep(2500);
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 } });
  fs.writeFileSync(`data/zoom-${name}-${z}.png`, Buffer.from(s.result.data, 'base64'));
}
console.log('ok');
ws.close();
