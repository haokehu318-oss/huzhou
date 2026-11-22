// 冒烟：粘贴 brief 解析后，品牌输入框应换成 brief 里的品牌
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
await ev(`document.querySelector('#industry [data-k=food]').click()`); await sleep(1500);
await ev(`document.getElementById('briefText').value='客户：一点点，预算500万，地铁多，地铁步行半径1000米'; document.getElementById('briefGo').click()`); await sleep(6000);
console.log(await ev(`JSON.stringify({brand:document.getElementById('brandKw').value,budget:document.getElementById('budget').value,busR:document.getElementById('busR').value,metroR:document.getElementById('metroR').value,share:document.getElementById('shareOut').textContent,info:document.getElementById('briefInfo').textContent})`));
await ev(`document.getElementById('briefText').value='客户：一点点，预算200万，在地铁和公交投放，公交30%，公交步行半径100米'; document.getElementById('briefGo').click()`); await sleep(6000);
console.log(await ev(`JSON.stringify({brand:document.getElementById('brandKw').value,budget:document.getElementById('budget').value,busR:document.getElementById('busR').value,metroR:document.getElementById('metroR').value,share:document.getElementById('shareOut').textContent,info:document.getElementById('briefInfo').textContent})`));
console.log(errs.length ? errs.join('\n') : 'no errors');
ws.close();
