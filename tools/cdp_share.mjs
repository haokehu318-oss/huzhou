// 冒烟：只选一种媒体时隐藏地铁占比滑块，两种都选时显示，区间 5%–95%
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
await send('Page.navigate', { url: 'http://127.0.0.1:5188/' }); await sleep(6000);
const vis = `getComputedStyle(document.getElementById('shareWrap')).display!=='none'`;
const set = (bus, metro) => ev(`(()=>{for(const [i,v] of [['mBus',${bus}],['mMetro',${metro}]]){const c=document.getElementById(i);if(c.checked!==v){c.checked=v;c.dispatchEvent(new Event('change'))}}})()`);
await set(true, true); console.log('都选', await ev(vis), await ev(`document.getElementById('share').min+'-'+document.getElementById('share').max`));
await set(false, true); console.log('只地铁', await ev(vis));
await set(true, false); console.log('只公交', await ev(vis));
ws.close();
