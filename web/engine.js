// 组案引擎：门店圈选 → 覆盖匹配 → 可售过滤 → 预算内最优组合 → 报价与上刊倒排。
// 纯函数，浏览器和 node 测试共用。所有金额单位为元。

// ---------- 报价口径 ----------
// 公交单价取《05 饮用水提案样本》的成交刊例（S 58,000 / A++ 48,000 / A+ 38,000 元/辆/月），
// 均落在《07 媒体刊例价》区间内；地铁口、AA 观光线取 07 区间中值。
export const RATE = {
  bus: { S: 58000, 'A++': 48000, 'A+': 38000, AA: 250000 },
  metro: { 'A++': 300000, 'A+': 200000, S: 350000 },
  busMake: 5000, // 元/辆，05 样本
  metroMakePerSqm: 100, // 元/㎡，07 刊例
  metroAreaDefault: 30, // ㎡，红豆点位面积字段为空时的假设
};
export const RATE_NOTE = {
  'bus:AA': '观光线按 07 刊例「双层巴士/都市观光线」中值',
  'metro:S': 'S 级出入口 07 未列价，按 A++ 区间上限计，需核价',
  metroMake: '点位面积未维护，按 30㎡ 估制作费',
};

export const DEFAULTS = {
  busRadius: 500, // 线路离门店多近算"途经"（米）
  metroRadius: 800, // 地铁口离门店多近算"就近"（米，直线距离，未按步行路径复核）
  maxPerLine: 5, // 单条线路最多买几辆，分散覆盖
  minPerLine: 2, // 单条线路起订辆数（可售不足时按可售）
  discount: 1, // 1 = 按刊例；0.7 = 七折
  objective: 'visit', // visit 到店引流 / reach 品牌曝光
  busPerNight: 20, // 单晚公交施工上限（台）
  metroPerNight: 6, // 单晚地铁口施工上限（个）
  rainBufferEvery: 4, // 每 4 个施工夜预留 1 夜雨天缓冲
  designDays: 5, approveDays: 3, makeDays: 3, // 工作日
  adReviewDays: 0, // 医疗/保健食品广告审查证明额外天数
};

// ---------- 几何 ----------
const R = 6371000, rad = Math.PI / 180;
const proj = (lng, lat) => [lng * rad * R * Math.cos(31.2 * rad), lat * rad * R];
export function distPointPoint(a, b) { const [x1, y1] = proj(a[0], a[1]), [x2, y2] = proj(b[0], b[1]); return Math.hypot(x1 - x2, y1 - y2); }
export function distPointPath(p, path) {
  const [px, py] = proj(p[0], p[1]); let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = proj(path[i][0], path[i][1]), [bx, by] = proj(path[i + 1][0], path[i + 1][1]);
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy));
  }
  return best;
}

// ---------- 档期 ----------
const pad2 = (n) => String(n).padStart(2, '0');
const dim = (y, m) => new Date(y, m + 1, 0).getDate();
// 两种档期：连续日期区间；或在月份柱上多选的若干自然月（可不连续，每段连续月份单独上画一次）
export function periodInfo(start, end, monthSel = null, year = 2027) {
  if (monthSel?.length) {
    const ms = [...new Set(monthSel)].sort((a, b) => a - b), segs = [];
    for (const m of ms) { const l = segs.at(-1); if (l && l[1] === m - 1) l[1] = m; else segs.push([m, m]); }
    const segments = segs.map(([a, b]) => ({ start: `${year}-${pad2(a + 1)}-01`, end: `${year}-${pad2(b + 1)}-${dim(year, b)}` }));
    return { days: ms.reduce((s, m) => s + dim(year, m), 0), months: ms, billMonths: ms.length, segments, start: segments[0].start, end: segments.at(-1).end };
  }
  const s = new Date(start + 'T00:00:00'), e = new Date(end + 'T00:00:00');
  const days = Math.round((e - s) / 86400000) + 1;
  const months = [];
  for (let d = new Date(s.getFullYear(), s.getMonth(), 1); d <= e; d.setMonth(d.getMonth() + 1)) months.push(d.getMonth()); // 0-11
  // 刊例按月计：30 天折一个月，不足一个月按一个月
  return { days, months, billMonths: Math.max(1, Math.round((days / 30) * 2) / 2), segments: [{ start, end }], start, end };
}

// 离线可售：所跨自然月里取最小空位数（与红豆按区间查询的口径一致：整段档期都空才算可售）
export function offlineFree(avail, kind, rid, months) {
  const a = avail?.[kind]?.[rid]; if (!a) return 0;
  return Math.min(...months.map((m) => a.free[m] ?? 0));
}

// ---------- 覆盖匹配 ----------
// anchors: [{lng,lat,w,store:bool,name}]，返回每个媒体附近的锚点
// 最近目标优先取门店：有门店时不让写字楼等人群锚点抢"最近门店"
const closer = (cur, a, d) => !cur || (a.store && !cur.store) || (a.store === cur.store && d < cur.d);
export function matchCoverage(universe, anchors, opt) {
  const busR = opt.busRadius, metroR = opt.metroRadius;
  const bus = universe.bus.map((b) => {
    if (!b.path) return { ...b, near: [], nearest: null };
    // 先用包围盒粗筛，再算点到折线距离
    let minX = 180, maxX = 0, minY = 90, maxY = 0;
    for (const [x, y] of b.path) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const pad = busR / 90000;
    const near = []; let nearest = null;
    anchors.forEach((a, i) => {
      if (a.lng < minX - pad || a.lng > maxX + pad || a.lat < minY - pad || a.lat > maxY + pad) return;
      const d = distPointPath([a.lng, a.lat], b.path);
      if (d <= busR) { near.push(i); if (closer(nearest, a, d)) nearest = { i, d, store: a.store }; }
    });
    return { ...b, near, nearest };
  });
  const metro = universe.metro.map((m) => {
    if (m.lng == null) return { ...m, near: [], nearest: null };
    const near = []; let nearest = null;
    anchors.forEach((a, i) => {
      if (Math.abs(a.lat - m.lat) > 0.01 || Math.abs(a.lng - m.lng) > 0.012) return;
      const d = distPointPoint([a.lng, a.lat], [m.lng, m.lat]);
      if (d <= metroR) { near.push(i); if (closer(nearest, a, d)) nearest = { i, d, store: a.store }; }
    });
    return { ...m, near, nearest };
  });
  return { bus, metro };
}

const median = (a) => { const s = a.filter((x) => x > 0).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

// ---------- 单价 ----------
export function unitCost(kind, level, period, discount) {
  const card = RATE[kind][level];
  if (!card) return null;
  const media = Math.round(card * period.billMonths);
  const make = kind === 'bus' ? RATE.busMake : RATE.metroMakePerSqm * RATE.metroAreaDefault;
  return { card, media, net: Math.round(media * discount), make };
}

// ---------- 组案 ----------
// input: { universe, anchors, free:{bus:{rid:n},metro:{rid:n}}, budget, media:['bus','metro'], start, end, ...DEFAULTS }
//   period    可选，periodInfo() 结果（多选月份时传入）
//   forced    客户指定的线路/点位 [{kind,rid,qty}]，先买，预算不够也保留并标超支
//   exclude   销售排除的 key 列表（'bus:12'），不再推荐
//   autoFill  false 时只出指定线路，不自动补足
export const keyOf = (kind, rid) => kind + ':' + rid;
export function buildPlan(input) {
  const opt = { ...DEFAULTS, ...input };
  const period = opt.period ?? periodInfo(opt.start, opt.end);
  const flights = period.segments.length; // 每段档期单独上画一次，制作费按段计
  const cov = input.coverage ?? matchCoverage(input.universe, input.anchors, opt);
  const anchors = input.anchors;
  const storeIdx = anchors.map((a, i) => (a.store ? i : -1)).filter((i) => i >= 0);
  const pvMed = { bus: median(input.universe.bus.map((b) => b.pv)), metro: median(input.universe.metro.map((m) => m.pv)) };
  // 到店目标：门店相关性权重高；曝光目标：人流权重高
  const lambda = opt.objective === 'visit' ? 3 : 0.8;
  const nearRef = 4; // 途经 4 家门店即视为满相关
  const forcedKeys = new Set((opt.forced || []).map((f) => keyOf(f.kind, f.rid)));
  const excluded = new Set(opt.exclude || []);
  const costOf = (kind, level) => { const c = unitCost(kind, level, period, opt.discount); if (c) c.make *= flights; return c; };
  const candOf = (kind, m) => {
    const free = input.free[kind]?.[m.rid] ?? 0;
    const nearW = m.near.reduce((s, i) => s + anchors[i].w, 0);
    const pv = m.pv || pvMed[kind] * 0.6; // 平台无人流的线路按同类中位数打六折，避免高估
    return { kind, m, free, cost: costOf(kind, m.level), pv, pvEstimated: !m.pv, nearW, fit: 1 + lambda * Math.min(1, nearW / nearRef), cap: kind === 'bus' ? Math.min(free, opt.maxPerLine) : Math.min(free, 1), n: 0 };
  };

  const cands = [];
  for (const kind of opt.media) for (const m of cov[kind]) {
    const k = keyOf(kind, m.rid);
    if (forcedKeys.has(k) || excluded.has(k)) continue;
    const c = candOf(kind, m);
    if (c.free <= 0 || !c.cost) continue;
    if (opt.objective === 'visit' && c.nearW === 0) continue; // 到店引流只要途经门店/目标人群的媒体
    cands.push(c);
  }

  // 单位边际价值：公交同线加车按 0.6^n 递减（频次饱和），地铁口单点
  // 公交起订：一条线首次入选至少买 minPerLine 辆（样本合同每线 2 辆），单辆车频次太低也不便施工
  const step = (c) => (c.kind === 'bus' && c.n === 0 ? Math.min(opt.minPerLine, c.cap) : 1);
  const reachGain = (c) => {
    if (c.kind === 'metro') return c.pv * c.fit;
    let g = 0; for (let k = 0; k < step(c); k++) g += c.pv * c.fit * 0.4 * Math.pow(0.6, c.n + k);
    return g;
  };
  const covered = new Set();
  const markCovered = (c) => c.m.near.forEach((i) => anchors[i].store && covered.add(i));
  const coverBonus = (c) => {
    if (c.n > 0) return 0;
    let w = 0; for (const i of c.m.near) if (anchors[i].store && !covered.has(i)) w += anchors[i].w;
    return pvMed.bus * 0.5 * Math.sqrt(w); // 首次覆盖新门店的额外价值，开方避免门店多的品牌被门店数绑架
  };
  const unitPrice = (c) => (c.cost.net + c.cost.make) * step(c);

  // 1) 客户指定的先买：数量不超过可售，可售为 0 也列出来让销售看到
  const picks = [];
  let left = opt.budget;
  for (const f of opt.forced || []) {
    const m = cov[f.kind]?.find((x) => x.rid === f.rid); if (!m) continue;
    const c = candOf(f.kind, m); if (!c.cost) continue;
    c.forced = true; c.want = f.qty; c.n = Math.max(0, Math.min(f.qty, c.free));
    picks.push(c); markCovered(c); left -= (c.cost.net + c.cost.make) * c.n;
  }

  // 2) 剩余预算自动补足。公交按"线路人次"、地铁口按"出口周边人次"计量，口径不同不能直接比性价比，
  //    所以组合投放先按媒介配比切预算，各自在本类里择优；一类花不完的钱再让另一类用。
  const greedy = (pool, budget) => {
    let rest = budget;
    for (let guard = 0; guard < 3000; guard++) {
      let best = null, bestScore = 0;
      for (const c of pool) {
        if (c.n >= c.cap || unitPrice(c) > rest) continue;
        const s = (reachGain(c) + coverBonus(c)) / unitPrice(c);
        if (s > bestScore) { bestScore = s; best = c; }
      }
      if (!best) break;
      if (best.n === 0) { picks.push(best); markCovered(best); }
      rest -= unitPrice(best); best.n += step(best);
    }
    return rest;
  };
  if (opt.autoFill !== false && left > 0) {
    const both = opt.media.includes('bus') && opt.media.includes('metro');
    const share = opt.metroShare ?? (opt.objective === 'visit' ? 0.35 : 0.2);
    if (both) {
      const mBudget = Math.round(left * share);
      const metroLeft = greedy(cands.filter((c) => c.kind === 'metro'), mBudget);
      const busLeft = greedy(cands.filter((c) => c.kind === 'bus'), left - mBudget + metroLeft);
      greedy(cands, busLeft);
    } else greedy(cands, left);
  }

  const lines = picks.filter((p) => p.n > 0 || p.forced).map((p) => ({
    key: keyOf(p.kind, p.m.rid), kind: p.kind, rid: p.m.rid, name: mediaName(p.kind, p.m),
    level: p.m.level, form: p.kind === 'bus' ? p.m.form : '出入口', qty: p.n, free: p.free, forced: !!p.forced, want: p.want ?? null,
    card: p.cost.card, media: p.cost.media * p.n, net: p.cost.net * p.n, make: p.cost.make * p.n,
    pv: p.n ? Math.round(p.pv) : 0, pvEstimated: p.pvEstimated, near: p.m.near.length,
    nearStores: p.m.near.filter((i) => anchors[i].store).length,
    nearest: p.m.nearest ? { name: anchors[p.m.nearest.i].name, d: Math.round(p.m.nearest.d) } : null,
    note: RATE_NOTE[`${p.kind}:${p.m.level}`] ?? (p.kind === 'metro' ? RATE_NOTE.metroMake : null) ?? (p.pvEstimated ? '平台无该线人流，按同类中位数六折估' : null),
    company: p.m.company ?? null, district: p.m.district ?? p.m.biz ?? null, proxy: !!p.m.proxy,
  })).sort((a, b) => (a.forced !== b.forced ? (a.forced ? -1 : 1) : a.kind === b.kind ? b.net + b.make - (a.net + a.make) : a.kind === 'bus' ? -1 : 1));

  const sum = (k, ls = lines) => ls.reduce((s, l) => s + l[k], 0);
  const coveredStores = new Set(lines.filter((l) => l.qty > 0).flatMap((l) => (cov[l.kind].find((m) => m.rid === l.rid)?.near ?? []).filter((i) => anchors[i].store)));
  const forcedLines = lines.filter((l) => l.forced);
  const totals = {
    media: sum('media'), net: sum('net'), make: sum('make'), total: sum('net') + sum('make'),
    forcedTotal: sum('net', forcedLines) + sum('make', forcedLines),
    shortage: forcedLines.filter((l) => l.want > l.qty).length,
    vehicles: lines.filter((l) => l.kind === 'bus').reduce((s, l) => s + l.qty, 0),
    gates: lines.filter((l) => l.kind === 'metro').reduce((s, l) => s + l.qty, 0),
    // 入选媒体的平台历史日均人流相加（未去重）。公交按线路计一次，与买几辆车无关；不是广告实际被看到的人次
    dailyPv: lines.reduce((s, l) => s + l.pv, 0),
    busPv: lines.filter((l) => l.kind === 'bus').reduce((s, l) => s + l.pv, 0),
    metroPv: lines.filter((l) => l.kind === 'metro').reduce((s, l) => s + l.pv, 0),
    storesCovered: coveredStores.size, storesTotal: storeIdx.length,
    candidates: cands.length,
  };
  totals.left = opt.budget - totals.total;

  // 选点证据链：门店 → 半径内媒体 → 红豆有空位 → 预算内入选（自检清单第 3 条）
  const nearAll = opt.media.flatMap((k) => cov[k].filter((m) => m.near.length).map((m) => [k, m]));
  const funnel = {
    anchors: storeIdx.length, near: nearAll.length,
    nearFree: nearAll.filter(([k, m]) => (input.free[k]?.[m.rid] ?? 0) > 0).length,
    candidates: cands.length, chosen: lines.filter((l) => l.qty).length,
  };
  // 各媒体预算占比（自检第 5 条）
  const shares = ['bus', 'metro'].map((k) => { const ls = lines.filter((l) => l.kind === k); return { kind: k, net: sum('net', ls), make: sum('make', ls), total: sum('net', ls) + sum('make', ls), n: ls.reduce((s, l) => s + l.qty, 0) }; })
    .filter((x) => x.total).map((x) => ({ ...x, pct: totals.total ? x.total / totals.total : 0 }));
  // 替换方案：未入选但有空位、性价比最高的候选，入选线路临时换车/缺位时顶上（自检第 8 条）
  const backups = cands.filter((c) => c.n === 0 && c.free > 0).map((c) => ({ c, s: (reachGain(c) + coverBonus(c)) / unitPrice(c) }))
    .sort((a, b) => b.s - a.s).slice(0, 6).map(({ c }) => ({ key: keyOf(c.kind, c.m.rid), kind: c.kind, name: mediaName(c.kind, c.m), level: c.m.level, free: c.free, nearStores: c.m.near.filter((i) => anchors[i].store).length, card: c.cost.card }));
  return { lines, totals, funnel, shares, backups, period, schedule: schedule(opt, totals, period), coveredStores: [...coveredStores], opt: { ...opt, universe: undefined, anchors: undefined, free: undefined, coverage: undefined, period: undefined } };
}
export const mediaName = (kind, m) => (kind === 'bus' ? `${m.name}${/[路线]$/.test(m.name) ? '' : '路'}` : `${m.station} ${m.exit}`);

// ---------- 上刊倒排 ----------
// 依据《02 上下刊流程卡点》：设计→定稿→审批→制作→夜间安装，单晚有作业上限、雨天停工；
// 《直客合同》：发布期从最后一辆车施工照当日起算；《4A 框架》：乙方延误按"误一补二"补偿。
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const workBack = (d, n) => { let x = new Date(d); while (n > 0) { x = addDays(x, -1); if (x.getDay() % 6) n--; } return x; };
const fmt = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export function schedule(opt, totals, period) {
  const start = new Date(period.start + 'T00:00:00');
  const busNights = Math.ceil(totals.vehicles / opt.busPerNight), metroNights = Math.ceil(totals.gates / opt.metroPerNight);
  const nights = Math.max(busNights, metroNights); // 公交和地铁口是不同施工队，可并行
  const buffer = nights ? Math.ceil(nights / opt.rainBufferEvery) : 0;
  const installStart = addDays(start, -(nights + buffer));
  const makeStart = workBack(installStart, opt.makeDays);
  const approveStart = workBack(makeStart, opt.approveDays + opt.adReviewDays);
  const designStart = workBack(approveStart, opt.designDays);
  const dailyValue = period.days ? totals.net / period.days : 0;
  const steps = [
    { k: 'design', name: '设计与客户定稿', from: fmt(designStart), to: fmt(addDays(approveStart, -1)) },
    { k: 'approve', name: opt.adReviewDays ? '内容审批（含广告审查证明）' : '内容审批', from: fmt(approveStart), to: fmt(addDays(makeStart, -1)) },
    { k: 'make', name: '画面制作', from: fmt(makeStart), to: fmt(addDays(installStart, -1)) },
    { k: 'install', name: `夜间安装 ${nights} 夜 + 雨天缓冲 ${buffer} 夜`, from: fmt(installStart), to: fmt(addDays(start, -1)) },
  ];
  period.segments.forEach((seg, i) => {
    if (i > 0) { const s = new Date(seg.start + 'T00:00:00'); steps.push({ k: 'install', name: `第 ${i + 1} 段重新上画`, from: fmt(addDays(s, -(nights + buffer))), to: fmt(addDays(s, -1)) }); }
    steps.push({ k: 'live', name: period.segments.length > 1 ? `发布期 · 第 ${i + 1} 段` : '发布期', from: seg.start, to: seg.end });
  });
  return { nights, buffer, busNights, metroNights, steps, finalArtDeadline: fmt(addDays(approveStart, -1)), delayCostPerDay: Math.round(dailyValue * 2) }; // 误一补二：延误 1 天补 2 天
}

// 两版方案对比：预算调整时告诉销售加了什么、减了什么
export function diffPlans(a, b) {
  const A = new Map(a.lines.map((l) => [l.key, l])), B = new Map(b.lines.map((l) => [l.key, l]));
  const out = [];
  for (const [k, l] of B) { const o = A.get(k); if (!o) { if (l.qty) out.push({ type: 'add', l, d: l.qty }); } else if (o.qty !== l.qty) out.push({ type: l.qty > o.qty ? 'more' : 'less', l, d: l.qty - o.qty }); }
  for (const [k, l] of A) if (!B.has(k) && l.qty) out.push({ type: 'remove', l, d: -l.qty });
  return out;
}
