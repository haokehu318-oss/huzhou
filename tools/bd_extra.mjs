// 红豆里有、但大数据平台自营标签里没对上的公交线路：在"其他"标签里按 "<线路>路" 找，补抓明细和人次
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const inv = JSON.parse(fs.readFileSync('data/snapshot/inv-2027-05.json', 'utf8'));
const labels = JSON.parse(fs.readFileSync('data/bd/labels.json', 'utf8'));
const bus = labels.filter((l) => l.first === '公交');
const own = new Set(bus.filter((l) => l.level !== '其他').map((l) => l.name));
const extra = [], none = [];
for (const b of inv.bus) {
  if (own.has(b.lineName)) continue;
  const n = b.lineName, cands = [n, n + '路', n.replace(/路$/, '')];
  const hit = bus.find((l) => l.level === '其他' && (cands.includes(l.name) || cands.includes(l.alias)));
  hit ? extra.push({ ...hit, hdName: n }) : none.push(n);
}
console.log('extra', extra.length, 'none', none.length, none.join(' '));
fs.writeFileSync('data/bd/extra_map.json', JSON.stringify(Object.fromEntries(extra.map((e) => [e.hdName, e.id]))));
// 复用两个抓取脚本：临时把 extra 的 level 改成可抓取
const tmp = labels.map((l) => (extra.some((e) => e.id === l.id) ? { ...l, level: '补' } : l));
fs.writeFileSync('data/bd/labels.json', JSON.stringify(tmp));
execFileSync('node', ['--no-warnings', 'tools/bd_labels.mjs', 'detail'], { stdio: 'inherit' });
execFileSync('node', ['--no-warnings', 'tools/bd_flow.mjs'], { stdio: 'inherit' });
