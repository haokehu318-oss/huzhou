// 端到端冒烟：用无头 Edge（独立临时配置目录）打开工作台，跑一串操作，打印控制台错误、关键状态并截图到 data/。
//   node tools/cdp_check.mjs [url]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const url = process.argv[2] || 'http://127.0.0.1:5188/';
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
// 已有调试端口就复用，否则自己起一个无头 Edge
const up = await fetch('http://127.0.0.1:9333/json').then(() => true, () => false);
const p = up ? null : spawn(edge, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${process.cwd()}/data/edge-headless`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 120 && !ws; i++) { await sleep(250); try { const t = await (await fetch('http://127.0.0.1:9333/json')).json(); const pg = t.find((x) => x.type === 'page'); if (pg) ws = new WebSocket(pg.webSocketDebuggerUrl); } catch {} }
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(), logs = [];
ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } else if (j.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (j.params.exceptionDetails.exception?.description || j.params.exceptionDetails.text)); else if (j.method === 'Runtime.consoleAPICalled' && j.params.type === 'error') logs.push('ERR ' + j.params.args.map((a) => a.value ?? a.description).join(' ')); };
const send = (method, params = {}) => Promise.race([new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }), sleep(15000).then(() => { console.log('TIMEOUT', method, JSON.stringify(params).slice(0, 120)); return {}; })]);
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }); fs.writeFileSync(`data/${name}.png`, Buffer.from(r.result.data, 'base64')); };
const click = (sel) => ev(`(()=>{const e=${sel};e&&e.click();return !!e})()`);
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url }); await sleep(7000);
const state = () => ev(`JSON.stringify({kpi:[...document.querySelectorAll('.kpi b')].map(b=>b.textContent),rows:document.querySelectorAll('#list tbody tr').length,foot:document.getElementById('foot').textContent.slice(0,60),detail:document.querySelector('#detail h3')?.textContent})`);
console.log('init', await state()); await shot('cdp-1-init');
// 多选月份：3 月已选，再点 4 月和 9 月
await click(`document.querySelector('#months button[data-m="3"]')`); await sleep(400);
await click(`document.querySelector('#months button[data-m="8"]')`); await sleep(600);
console.log('months', await ev(`document.getElementById('monthHint').textContent`), await state());
// 客户指定线路
await ev(`document.getElementById('forceKw').value='18路'`); await click(`document.getElementById('forceGo')`); await sleep(1200);
console.log('forced', await state(), await ev(`document.getElementById('forceInfo').textContent`));
await shot('cdp-2-forced');
// 键盘输入超过可售：应提示且不改方案
const before = await ev(`document.querySelector('.kpi b').textContent`);
await ev(`(()=>{const i=document.querySelector('#forcedList input');i.value=999;i.dispatchEvent(new Event('change'))})()`); await sleep(400);
console.log('over-input', await ev(`document.querySelector('#forcedList .err')?.textContent`), 'kpi unchanged', before === await ev(`document.querySelector('.kpi b').textContent`));
await ev(`(()=>{const i=document.querySelector('#forcedList input');i.value=2;i.dispatchEvent(new Event('change'))})()`); await sleep(600);
console.log('valid-input', await ev(`document.querySelector('#forcedList input').value`), await ev(`document.querySelector('#forcedList .amt').textContent`));
// 勾选推荐线路
await click(`document.querySelector('#list input[data-pick]:not(:checked)')`); await sleep(600);
console.log('picked', await ev(`document.querySelector('.pick-bar span').textContent`));
// 红豆核对
await click(`document.querySelector('#list tbody tr')`); await sleep(500);
await click(`document.getElementById('dCheck')`); await sleep(6000);
console.log('verify', await ev(`document.getElementById('dUsage').innerText.slice(0,300)`));
await shot('cdp-3-verify');
// 缩放后线宽
await ev(`window.scrollTo(0,0)`);
await ev(`document.getElementById('map')._plan.map.setZoom(15)`); await sleep(2500); await shot('cdp-5-zoom15', { x: 360, y: 240, width: 640, height: 560 });
await ev(`document.getElementById('map')._plan.map.setZoom(11)`); await sleep(2500); await shot('cdp-6-zoom11', { x: 360, y: 240, width: 640, height: 560 });
await ev(`window.scrollTo(0, 900)`); await sleep(500); await shot('cdp-4-list');console.log(logs.length ? logs.join('\n') : 'no console errors');
ws.close(); p?.kill();
