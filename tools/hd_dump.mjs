// 拉取 2027 年每个月的公交/地铁库存快照 + 媒体资源主数据，存 data/snapshot/
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import fs from 'node:fs';
const tok = JSON.parse(fs.readFileSync('data/.hd_token.json', 'utf8'));
const get = async (p, q) => {
  const r = await fetch('https://flairmedia.com.cn:881/admin-api' + p + '?' + new URLSearchParams(q), { headers: { 'tenant-id': '1', authorization: 'Bearer ' + tok.accessToken } });
  const j = await r.json(); if (j.code !== 0) throw new Error(p + ' ' + j.msg); return j.data;
};
const all = async (p, q) => { let out = [], n = 1; for (;;) { const d = await get(p, { ...q, pageNo: n, pageSize: 100 }); out.push(...d.list); if (out.length >= d.total || !d.list.length) return out; n++; } };
fs.mkdirSync('data/snapshot', { recursive: true });
const what = process.argv[2] || 'all';
if (what === 'all' || what === 'master') {
  for (const [name, p] of [['busline', '/mediares/manage-busline/page'], ['metrogate', '/mediares/manage-metrogate/page']]) {
    try { const rows = await all(p, {}); fs.writeFileSync(`data/snapshot/${name}.json`, JSON.stringify(rows)); console.log(name, rows.length); } catch (e) { console.log(name, 'ERR', e.message); }
  }
}
if (what === 'all' || what === 'inv') {
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0'), end = new Date(2027, m, 0).getDate();
    const q = { startDate: `2027-${mm}-01`, endDate: `2027-${mm}-${end}` };
    const bus = await all('/orders/media-inventory/bus/page', q), metro = await all('/orders/media-inventory/metro/page', q);
    fs.writeFileSync(`data/snapshot/inv-2027-${mm}.json`, JSON.stringify({ query: q, fetchedAt: new Date().toISOString(), bus, metro }));
    console.log(mm, 'bus', bus.length, 'free', bus.reduce((s, x) => s + x.freeCount, 0), 'metro', metro.length, 'free', metro.reduce((s, x) => s + x.freeCount, 0));
  }
}
