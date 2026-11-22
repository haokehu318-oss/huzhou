// 冒烟：工作台只看一条线时导出提案，提案地图仍应有全部方案线路
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(), errs = [];
ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } else if (j.method === 'Runtime.exceptionThrown') errs.push(j.params.exceptionDetails.exception?.description); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:5188/' }); await sleep(7000);
await ev(`window.open = () => null; window.__html = null; const _c = URL.createObjectURL; URL.createObjectURL = (b) => { b.text().then((t) => (window.__html = t)); return _c(b); }; HTMLAnchorElement.prototype.click = function () {}; 1`);
const planBus = await ev(`document.querySelectorAll('#list tr[data-key^="bus:"]').length`);
await ev(`document.querySelector('#list tr[data-key^="bus:"]').click()`); await sleep(800);
console.log('工作台方案公交线', planBus, '只看一条时地图标签', await ev(`document.querySelectorAll('#map .pm-label').length`));
await ev(`document.getElementById('reportBtn').click()`); await sleep(9000);
// 提案里地图数据以 JSON 内嵌，数其中公交线条数
console.log('提案地图公交线', await ev(`(()=>{const h=window.__html||'';const m=h.match(/"bus":\\[(.*?)\\],"gates"/s);return m?(m[1].match(/"key":"bus:/g)||[]).length:'未找到'})()`));
console.log(errs.length ? errs.join('\n') : 'no errors');
ws.close();
