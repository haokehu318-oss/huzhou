// 逐个标签取 2023-05 日均人次(coverPeoplesPV)/日均人数(UV)，写入 data/bd/flow.json（断点续传）
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import fs from 'node:fs';
const cookie = fs.readFileSync('data/.bd_cookie', 'utf8');
const file = 'data/bd/flow.json';
const flow = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const todo = JSON.parse(fs.readFileSync('data/bd/labels.json', 'utf8')).filter((l) => l.level !== '其他' && !(l.id in flow));
const ask = async (id) => {
  const body = new URLSearchParams({ queryType: '1', indicatorType: 'visitorsFlowrateAndcrowdSpeed', dataMonth: '202305', labelIds: String(id), gridIds: '', extOptions: JSON.stringify({ gridType: '500', underground: '0' }) });
  const r = await fetch('https://flairmedia.com.cn:38880/bbf8e41e454b47126290905525c69f7', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json(); if (j.code !== '0000') throw new Error(j.code);
  const v = (t) => j.data.find((x) => x.type === t)?.time1 ?? null;
  return { pv: v('coverPeoplesPV'), uv: v('coverPeoplesUV') };
};
let n = 0;
const worker = async () => { while (todo.length) { const l = todo.shift(); try { flow[l.id] = await ask(l.id); } catch (e) { console.log('err', l.id, e.message); } if (++n % 100 === 0) { fs.writeFileSync(file, JSON.stringify(flow)); console.log('done', n, 'left', todo.length); } } };
await Promise.all([worker(), worker(), worker()]);
fs.writeFileSync(file, JSON.stringify(flow)); console.log('finished', Object.keys(flow).length);
