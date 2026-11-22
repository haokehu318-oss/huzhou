// node --test test/  —— 用真实快照数据跑组案引擎，检查预算、可售、档期三条硬约束
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlan, matchCoverage, offlineFree, periodInfo, diffPlans, DEFAULTS } from '../web/engine.js';
import { PRESETS } from '../web/presets.js';
import { anchorsFor } from '../web/anchors.js';

const J = (f) => JSON.parse(fs.readFileSync(new URL('../web/data/' + f, import.meta.url), 'utf8'));
const universe = J('universe.json'), avail = J('avail-2027.json');
const poi = (k) => J(`poi/${k}.json`).rows;
const freeFor = (start, end) => {
  const { months } = periodInfo(start, end), f = { bus: {}, metro: {} };
  for (const b of universe.bus) f.bus[b.rid] = offlineFree(avail, 'bus', b.rid, months);
  for (const m of universe.metro) f.metro[m.rid] = offlineFree(avail, 'metro', m.rid, months);
  return f;
};

for (const [key, p] of Object.entries(PRESETS)) {
  test(`${p.industry} · ${p.brand}：三档预算都不超支、不超可售`, () => {
    const anchors = anchorsFor(p, poi);
    const coverage = matchCoverage(universe, anchors, DEFAULTS);
    const free = freeFor(p.start, p.end);
    let prev = null;
    for (const budget of [1000000, 2000000, 5000000]) {
      const plan = buildPlan({ universe, anchors, coverage, free, budget, media: p.media, start: p.start, end: p.end, objective: p.objective, adReviewDays: p.adReviewDays ?? 0 });
      assert.ok(plan.totals.total <= budget, `${key} ${budget} 超支 ${plan.totals.total}`);
      assert.ok(plan.totals.total >= budget * 0.8, `${key} ${budget} 预算利用过低 ${plan.totals.total}`);
      for (const l of plan.lines) assert.ok(l.qty <= l.free, `${l.name} 买了 ${l.qty} 超过可售 ${l.free}`);
      assert.ok(plan.schedule.steps.at(-2).to < p.start, '安装须在发布日前完成');
      if (prev) assert.ok(plan.totals.dailyPv >= prev.totals.dailyPv, '预算加大后覆盖不应变少');
      console.log(`  ${key} ${budget / 1e4}万 → ${plan.lines.length}项 ${plan.totals.vehicles}车 ${plan.totals.gates}口 合计${plan.totals.total} 门店覆盖${plan.totals.storesCovered}/${plan.totals.storesTotal} 改动${prev ? diffPlans(prev, plan).length : '-'}`);
      prev = plan;
    }
  });
}

test('客户指定线路：先买、不超可售、可只出指定', () => {
  const p = PRESETS.bank, anchors = anchorsFor(p, poi), coverage = matchCoverage(universe, anchors, DEFAULTS), free = freeFor(p.start, p.end);
  const pick = universe.bus.find((b) => free.bus[b.rid] >= 3), none = universe.bus.find((b) => free.bus[b.rid] === 0);
  const forced = [{ kind: 'bus', rid: pick.rid, qty: 3 }, { kind: 'bus', rid: none.rid, qty: 2 }];
  const base = { universe, anchors, coverage, free, budget: 2000000, media: p.media, start: p.start, end: p.end };
  const only = buildPlan({ ...base, forced, autoFill: false });
  assert.equal(only.lines.length, 2);
  assert.equal(only.lines.find((l) => l.rid === pick.rid).qty, 3);
  assert.equal(only.lines.find((l) => l.rid === none.rid).qty, 0, '无空位的指定线路数量为 0');
  assert.equal(only.totals.shortage, 1);
  const fill = buildPlan({ ...base, forced });
  assert.ok(fill.lines.length > 2 && fill.totals.total <= 2000000);
  assert.ok(!buildPlan({ ...base, exclude: [fill.lines.at(-1).key] }).lines.some((l) => l.key === fill.lines.at(-1).key), '排除的线路不再推荐');
});

test('多选不连续月份：按月计费、制作费按段计、每段排上画', () => {
  const per = periodInfo(null, null, [2, 3, 8]);
  assert.equal(per.billMonths, 3); assert.equal(per.segments.length, 2);
  assert.deepEqual(per.segments[1], { start: '2027-09-01', end: '2027-09-30' });
  const p = PRESETS.bank, anchors = anchorsFor(p, poi);
  const free = { bus: {}, metro: {} };
  for (const b of universe.bus) free.bus[b.rid] = offlineFree(avail, 'bus', b.rid, per.months);
  for (const m of universe.metro) free.metro[m.rid] = offlineFree(avail, 'metro', m.rid, per.months);
  const plan = buildPlan({ universe, anchors, free, budget: 3000000, media: ['bus'], period: per });
  const l = plan.lines[0];
  assert.equal(l.make, 5000 * 2 * l.qty);
  assert.equal(plan.schedule.steps.filter((s) => s.k === 'live').length, 2);
});

test('跨月档期按最紧的月份算可售', () => {
  const rid = universe.bus.find((b) => avail.bus[b.rid].free[0] !== avail.bus[b.rid].free[1])?.rid;
  if (!rid) return;
  const a = avail.bus[rid];
  assert.equal(offlineFree(avail, 'bus', rid, [0, 1]), Math.min(a.free[0], a.free[1]));
});

import { parseBrief } from '../web/brief.js';
test('brief 品牌：各种括号和冒号写法都能识别', () => {
  for (const [s, b] of [['客户【一点点】，预算200万', '一点点'], ['客户「瑞幸咖啡」', '瑞幸咖啡'], ['品牌：喜茶，5月投放', '喜茶'], ['客户：蜜雪冰城 预算300万', '蜜雪冰城'], ['客户“和睦家”', '和睦家'], ['客户「某国际品牌」', null]])
    assert.equal(parseBrief(s).brand, b, s);
  assert.equal(parseBrief('客户【一点点】，预算200万').budget, 2000000);
});

test('brief 地铁/公交预算倾向', () => {
  for (const [s, v] of [['客户：一点点，预算500万，地铁多，公交少', 0.6], ['以公交为主，地铁为辅', 0.2], ['地铁口占60%', 0.6], ['地铁出入口 3 成', 0.3], ['地铁占99%', 0.95], ['公交车身 + 地铁出入口', undefined]])
    assert.equal(parseBrief(s).metroShare, v, s);
});

test('brief 服务半径', () => {
  const r = (s) => parseBrief(s).radius;
  assert.deepEqual(r('客户：一点点，预算200万，全在地铁投放，地铁步行半径1000米'), { bus: null, metro: 1000 });
  assert.deepEqual(r('公交途经 300 米，地铁口 1.2 公里'), { bus: 300, metro: 1200 });
  assert.deepEqual(r('门店半径1公里内'), { bus: 1000, metro: 1000 });
  assert.equal(r('地铁口占60%，预算300万'), undefined);
});

test('brief 只写公交占比', () => {
  assert.equal(parseBrief('客户：一点点，预算200万，在地铁和公交投放，公交30%，公交步行半径100米').metroShare, 0.7);
  assert.equal(parseBrief('公交车身占 4 成').metroShare, 0.6);
});
