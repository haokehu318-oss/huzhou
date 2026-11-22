// 命令行批量出案：node tools/make_reports.mjs [行业key] [预算万]
// 不带参数时输出 5 个行业 × 3 档预算共 15 份提案到 outputs/，用于路演备份和回归检查。
import fs from 'node:fs';
import { buildPlan, matchCoverage, offlineFree, periodInfo, DEFAULTS } from '../web/engine.js';
import { PRESETS } from '../web/presets.js';
import { anchorsFor } from '../web/anchors.js';
import { buildReport } from '../web/report.js';
const J = (f) => JSON.parse(fs.readFileSync('web/data/' + f, 'utf8'));
const universe = J('universe.json'), avail = J('avail-2027.json');
for (const b of universe.bus) b.mapPath = b.path; // 提案地图与选点用同一条轨迹
const leaflet = { js: fs.readFileSync('web/vendor/leaflet.js', 'utf8'), css: fs.readFileSync('web/vendor/leaflet.css', 'utf8') };
const [, , onlyKey, onlyBudget] = process.argv;
fs.mkdirSync('outputs', { recursive: true });
for (const [key, p] of Object.entries(PRESETS)) {
  if (onlyKey && key !== onlyKey) continue;
  const anchors = anchorsFor(p, (k) => J(`poi/${k}.json`).rows);
  const coverage = matchCoverage(universe, anchors, DEFAULTS);
  const { months } = periodInfo(p.start, p.end), free = { bus: {}, metro: {} };
  for (const b of universe.bus) free.bus[b.rid] = offlineFree(avail, 'bus', b.rid, months);
  for (const m of universe.metro) free.metro[m.rid] = offlineFree(avail, 'metro', m.rid, months);
  for (const budget of onlyBudget ? [onlyBudget * 10000] : [1000000, 2000000, 5000000]) {
    const t = Date.now();
    const plan = buildPlan({ universe, anchors, coverage, free, budget, media: p.media, start: p.start, end: p.end, objective: p.objective, adReviewDays: p.adReviewDays ?? 0 });
    const html = buildReport({ preset: p, brand: p.brand, plan, anchors, universe, leaflet, inv: { source: 'snapshot', fetchedAt: avail.months[0].fetchedAt }, budget });
    const f = `outputs/${p.brand}-${budget / 10000}万.html`;
    fs.writeFileSync(f, html);
    console.log(f, `${Date.now() - t}ms`, plan.totals.total);
  }
}
