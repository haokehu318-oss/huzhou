// 核对红豆可售口径：同一条线路，比较 区间查询 / 逐月查询 / 逐日查询 的空车数，并拉出合同与预定占用明细。
//   node tools/hd_verify.mjs 167 2027-04-01 2027-05-31
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import fs from 'node:fs';
const [, , line = '167', start = '2027-04-01', end = '2027-05-31', kind = 'bus'] = process.argv;
const tok = JSON.parse(fs.readFileSync('data/.hd_token.json', 'utf8'));
const get = async (p, q) => {
  const r = await fetch('https://flairmedia.com.cn:881/admin-api' + p + '?' + new URLSearchParams(q), { headers: { 'tenant-id': '1', authorization: 'Bearer ' + tok.accessToken } });
  const j = await r.json(); if (j.code !== 0) throw new Error(p + ' ' + j.msg); return j.data;
};
const inv = async (s, e) => (await get(`/orders/media-inventory/${kind}/page`, { pageNo: 1, pageSize: 50, lineName: line, startDate: s, endDate: e })).list.filter((x) => x.lineName === line);
const fmt = (d) => d.toISOString().slice(0, 10);
const range = await inv(start, end);
console.log('区间', start, '~', end, range.map((x) => ({ rid: x.resourceId, 总: x.totalCount, 合同: x.contractCount, 预定: x.reservationCount, 保养: x.maintenanceForbiddenCount, 续约保护: x.renewPossibleCount + x.protectCount, 空: x.freeCount })));
const rid = range[0].resourceId;
// 逐月
for (let d = new Date(start + 'T00:00:00Z'); fmt(d) <= end; d.setUTCMonth(d.getUTCMonth() + 1)) {
  const s = fmt(d), e = fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
  const r = (await inv(s, e)).find((x) => x.resourceId === rid);
  console.log('月', s.slice(0, 7), '合同', r.contractCount, '预定', r.reservationCount, '空', r.freeCount);
}
// 逐日（并发 6）
const days = []; for (let d = new Date(start + 'T00:00:00Z'); fmt(d) <= end; d.setUTCDate(d.getUTCDate() + 1)) days.push(fmt(d));
const daily = {};
for (let i = 0; i < days.length; i += 6) await Promise.all(days.slice(i, i + 6).map(async (d) => { const r = (await inv(d, d)).find((x) => x.resourceId === rid); daily[d] = r.freeCount; }));
const vals = days.map((d) => daily[d]);
console.log('逐日空车 最小', Math.min(...vals), '最大', Math.max(...vals));
let run = null; for (const d of days) { if (!run || run.v !== daily[d]) { run && console.log('  ', run.from, '~', run.to, '空', run.v); run = { from: d, to: d, v: daily[d] }; } else run.to = d; } console.log('  ', run.from, '~', run.to, '空', run.v);
// 占用明细
for (const phase of ['OCCUPY', 'HOLD']) {
  const rows = await get('/orders/media-inventory/media-usage', { mediaType: kind.toUpperCase(), phase, resourceId: rid, startDate: start, endDate: end }).catch((e) => e.message);
  console.log(phase === 'OCCUPY' ? '合同占用明细' : '预定占用明细', Array.isArray(rows) ? rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k, v]) => v != null && /date|Date|num|Num|count|Count|brand|Brand|customer|qty|Qty|name|Name|period/i.test(k)))) : rows);
}
