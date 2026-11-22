// 把 12 个月的红豆库存快照压成可售矩阵：web/data/avail-2027.json
import fs from 'node:fs';
const months = [], bus = {}, metro = {};
for (let m = 1; m <= 12; m++) {
  const mm = String(m).padStart(2, '0');
  const s = JSON.parse(fs.readFileSync(`data/snapshot/inv-2027-${mm}.json`, 'utf8'));
  months.push({ month: `2027-${mm}`, fetchedAt: s.fetchedAt });
  for (const [out, rows] of [[bus, s.bus], [metro, s.metro]]) for (const x of rows) {
    const o = (out[x.resourceId] ??= { total: x.totalCount, free: [], contract: [], reserve: [], maint: [] });
    o.free.push(x.freeCount); o.contract.push(x.contractCount); o.reserve.push(x.reservationCount); o.maint.push(x.maintenanceForbiddenCount);
  }
}
fs.writeFileSync('web/data/avail-2027.json', JSON.stringify({ source: '红豆系统 /orders/media-inventory（按自然月查询）', months, bus, metro }));
console.log('bus', Object.keys(bus).length, 'metro', Object.keys(metro).length, Math.round(fs.statSync('web/data/avail-2027.json').size / 1024), 'KB');
