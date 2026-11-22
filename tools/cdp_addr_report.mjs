// 冒烟：按地址模式、品牌留空/改名，生成的提案标题与正文不应残留预设品牌
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(), errs = [];
ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } else if (j.method === 'Runtime.exceptionThrown') errs.push(j.params.exceptionDetails.exception?.description); };
const send = (method, params = {}) => Promise.race([new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }), sleep(20000).then(() => ({}))]);
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:5188/' }); await sleep(7000);
// 截获导出的 HTML，不真的打开新窗口
await ev(`window.open = () => null; window.__html = null; const _c = URL.createObjectURL; URL.createObjectURL = (b) => { b.text().then((t) => (window.__html = t)); return _c(b); }; HTMLAnchorElement.prototype.click = function () {}; 1`);
for (const brand of ['', '浦发银行']) {
  await ev(`document.querySelector('input[name=mode][value=addr]').click()`); await sleep(300);
  await ev(`(()=>{const b=document.getElementById('brandKw');b.value=${JSON.stringify(brand)};b.dispatchEvent(new Event('input'))})()`);
  await ev(`document.getElementById('addrText').value='上海浦东新区浦电路57号'`); await ev(`document.getElementById('addrGo').click()`); await sleep(5000);
  await ev(`window.__html=null; document.getElementById('reportBtn').click()`); await sleep(8000);
  const r = await ev(`(()=>{const h=window.__html||'';const d=new DOMParser().parseFromString(h,'text/html');return JSON.stringify({title:d.title,h1:d.querySelector('h1')?.textContent,cmb:(h.match(/招商|招行/g)||[]).length})})()`);
  console.log(JSON.stringify(brand || '(空)'), r);
}
console.log(errs.length ? errs.join('\n') : 'no errors');
ws.close();
