// 冒烟：点清单里的线路 → 地图只剩这一条；同一条再点 → 回到全部方案线路
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(), errs = [];
ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } else if (j.method === 'Runtime.exceptionThrown') errs.push(j.params.exceptionDetails.exception?.description); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:5188/' }); await sleep(7000);
// 地图用 canvas 画线，按终点的线路号标签和地铁口标记计数
const st = `JSON.stringify({busLabels:document.querySelectorAll('#map .pm-label').length,gates:document.querySelectorAll('#map .pm-gate').length,tip:document.querySelector('#map .map-solo')?.textContent||'',faded:[...document.querySelectorAll('#map .pm-label')].filter((e)=>+getComputedStyle(e).opacity<0.5).length})`;
console.log('全部', await ev(st));
const click = () => ev(`document.querySelector('#list tr[data-key^="bus:"]').click()`);
await click(); await sleep(800); console.log('点一次', await ev(st));
await click(); await sleep(800); console.log('再点一次', await ev(st));
await ev(`document.querySelector('#map .pm-label')?.click()`); await sleep(800); console.log('地图上点线路号', await ev(st));
await ev(`document.querySelector('#map .pm-label')?.click()`); await sleep(800); console.log('地图上再点', await ev(st));
const k = await ev(`[...document.getElementById('map')._plan.byKey.keys()].find((x)=>x.startsWith('bus:'))`);
await ev(`document.getElementById('map')._plan.hover('${k}')`); await sleep(200); console.log('全部时悬停', await ev(st));
await ev(`document.getElementById('map')._plan.hover(null)`); await sleep(200); console.log('移开', await ev(st));
await ev(`(()=>{const r=document.querySelector('#list tr[data-key^="bus:"]');r.dispatchEvent(new MouseEvent('mouseenter'));r.dispatchEvent(new MouseEvent('mouseleave'))})()`); await sleep(200); console.log('清单行悬停后移开', await ev(st));
console.log(errs.length ? errs.join('\n') : 'no errors');
ws.close();
