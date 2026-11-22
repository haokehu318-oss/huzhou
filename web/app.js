import { buildPlan, matchCoverage, offlineFree, periodInfo, diffPlans, unitCost, mediaName, keyOf, DEFAULTS } from './engine.js';
import { PRESETS, BUDGETS, REF_BRIEFS } from './presets.js';
import { assess, OBJ_LABEL } from './review.js';
import { anchorsFor } from './anchors.js';
import { mountPlanMap, PLAN_MAP_CSS } from './leafmap.js';
import { buildReport } from './report.js';
import { parseBrief } from './brief.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const wan = (n) => (n / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 1 }) + ' 万';
const ppl = (n) => (n >= 1e8 ? (n / 1e8).toFixed(2) + ' 亿' : n >= 10000 ? (n / 10000).toFixed(1) + ' 万' : String(Math.round(n)));
const yuan = (n) => Math.round(n).toLocaleString('zh-CN');
const getJson = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText); return r.json(); };
document.head.insertAdjacentHTML('beforeend', `<style>${PLAN_MAP_CSS}</style>`);
// 现场演示时出错要看得见，不能静默失败
const showErr = (m) => { const f = $('foot'); if (f) f.innerHTML = `<span class="warn">出错：${esc(m)}</span>`; };
addEventListener('error', (e) => showErr(e.message));
addEventListener('unhandledrejection', (e) => showErr(e.reason?.message || e.reason));

const [universe, avail] = await Promise.all(['data/universe.json', 'data/avail-2027.json'].map(getJson));
// 地图画的就是选点用的轨迹，保证"图上看着经过"和"算作覆盖"一致
const pathOf = (rid) => universe.bus.find((b) => b.rid === rid)?.path;
const byKey = new Map([...universe.bus.map((b) => [keyOf('bus', b.rid), { kind: 'bus', m: b }]), ...universe.metro.map((m) => [keyOf('metro', m.rid), { kind: 'metro', m }])]);
const poiCache = new Map();
const S = {
  key: 'bank', preset: null, brand: '', mode: 'brand', addrs: [], budget: 2000000, media: [], objective: 'visit', start: '', end: '', monthSel: [],
  discount: 1, metroShare: 0.35, busRadius: DEFAULTS.busRadius, metroRadius: DEFAULTS.metroRadius, maxPerLine: DEFAULTS.maxPerLine, busPerNight: DEFAULTS.busPerNight,
  forced: new Map(), exclude: new Set(), autoFill: true, sel: null, tab: 'plan',
  live: null, anchors: [], coverage: null, covKey: '', plan: null, prev: null, pinned: null, t0: Date.now(), timerStop: false, mapApi: null,
};

// ---------- 数据装载 ----------
async function loadPoi(kw) {
  if (poiCache.has(kw)) return poiCache.get(kw);
  let d = await getJson(`data/poi/${encodeURIComponent(kw)}.json`).catch(() => null);
  if (!d) d = await getJson(`/api/poi?kw=${encodeURIComponent(kw)}`); // 本地没有就去大数据平台实时检索
  poiCache.set(kw, d); return d;
}
async function applyPreset(key) {
  S.key = key; const p = PRESETS[key];
  S.preset = { ...p }; S.brand = p.brand; S.hypo = { ...p.hypo };
  S.media = [...p.media]; S.objective = p.objective; S.start = p.start; S.end = p.end; S.monthSel = [];
  S.metroShare = p.objective === 'visit' ? 0.35 : 0.2; S.live = null; S.prev = null; S.pinned = null; S.forced.clear(); S.exclude.clear(); S.sel = null;
  await Promise.all([p.poi, ...p.audience.map((a) => a.poi)].map((k) => loadPoi(k)));
  syncInputs(); refreshAnchors(true); S.t0 = Date.now(); S.timerStop = false;
}
function refreshAnchors(fit = false) {
  const p = S.preset;
  if (S.mode === 'addr') {
    S.anchors = S.addrs.map((a) => ({ ...a, w: 1, store: true, kind: 'store' }));
    $('brandInfo').innerHTML = S.addrs.length ? `按 ${S.addrs.length} 个客户地址圈选：公交 ${S.busRadius} 米内途经、地铁口直线距离 ${S.metroRadius} 米内。` : '输入客户地址后点「查询」。';
  } else {
    S.anchors = anchorsFor(p, (k) => poiCache.get(k)?.rows || []);
    const src = poiCache.get(p.poi), stores = S.anchors.filter((a) => a.kind === 'store').length;
    $('brandInfo').innerHTML = `${esc(p.industry)} · 平台检索到 <b>${stores}</b> 处「${esc(p.poi)}」${p.audience.length ? '，叠加人群锚点：' + p.audience.map((a) => esc(a.label)).join('、') : ''}<br><span>${esc(src?.source || '')} · ${esc((src?.fetchedAt || '').slice(0, 10))}</span>`;
  }
  S.covKey = ''; S.fit = fit; if (fit) S.sel = null; replan();
}

// ---------- 组案 ----------
const period = () => periodInfo(S.start, S.end, S.monthSel);
const segKey = (per) => per.segments.map((s) => s.start + '~' + s.end).join(',');
function freeMap(per) {
  if (S.live && S.live.key === segKey(per)) {
    const f = { bus: {}, metro: {} };
    for (const k of ['bus', 'metro']) for (const [rid, v] of Object.entries(S.live[k])) f[k][rid] = v.free;
    return { free: f, src: S.live };
  }
  const f = { bus: {}, metro: {} };
  for (const b of universe.bus) f.bus[b.rid] = offlineFree(avail, 'bus', b.rid, per.months);
  for (const m of universe.metro) f.metro[m.rid] = offlineFree(avail, 'metro', m.rid, per.months);
  return { free: f, src: { source: 'snapshot', fetchedAt: avail.months[0].fetchedAt } };
}
function replan() {
  const inYear = (d) => /^2027-\d\d-\d\d$/.test(d || ''); // 库存快照只有 2027 年
  if (!S.preset || !inYear(S.start) || !inYear(S.end) || S.start > S.end) return renderEmpty('请设置有效档期（2027 年内，开始不晚于结束）');
  if (!S.media.length && !S.forced.size) return renderEmpty('请至少选择一种媒体，或指定线路');
  const t = performance.now(), per = period();
  const ck = [S.mode, S.anchors.length, S.anchors[0]?.lng, S.preset.poi, S.busRadius, S.metroRadius].join('|');
  if (S.covKey !== ck) { S.coverage = matchCoverage(universe, S.anchors, { busRadius: S.busRadius, metroRadius: S.metroRadius }); S.covKey = ck; }
  const { free, src } = freeMap(per);
  S.free = free;
  const plan = buildPlan({
    universe, anchors: S.anchors, coverage: S.coverage, free, budget: S.budget, media: S.media, period: per,
    objective: S.objective, discount: S.discount, metroShare: S.metroShare, maxPerLine: S.maxPerLine, busPerNight: S.busPerNight,
    busRadius: S.busRadius, metroRadius: S.metroRadius, adReviewDays: S.preset.adReviewDays ?? 0,
    forced: [...S.forced].map(([k, qty]) => ({ kind: k.split(':')[0], rid: +k.split(':')[1], qty })), exclude: [...S.exclude], autoFill: S.autoFill,
  });
  plan.ms = Math.round(performance.now() - t); plan.inv = src;
  S.prev = S.plan ?? S.prev; S.plan = plan;
  $('work').classList.remove('empty'); ['liveBtn', 'pinBtn', 'reportBtn'].forEach((id) => ($(id).disabled = false));
  render();
  // 档期一定下来就在后台预取红豆实时库存（只暖服务端缓存，不改方案），点「实时核对」时秒出
  clearTimeout(S.prefetch); S.prefetch = setTimeout(() => per.segments.forEach((s) => fetch(`/api/inventory?start=${s.start}&end=${s.end}`).catch(() => {})), 1500);
}

// ---------- 渲染 ----------
// 输入无效：丢掉旧方案并隐藏旧地图、清单、排期，禁用核对和导出，避免拿旧结果出提案
function renderEmpty(msg) {
  S.plan = null;
  $('work').classList.add('empty'); ['liveBtn', 'pinBtn', 'reportBtn'].forEach((id) => ($(id).disabled = true));
  $('kpis').innerHTML = `<div class="kpi over"><b>暂无方案</b><span>${esc(msg)}</span></div>`;
}
function render() {
  const p = S.plan, t = p.totals;
  $('budgetOut').textContent = wan(S.budget);
  [...$('budgetChips').children].forEach((b) => b.classList.toggle('on', +b.dataset.v === S.budget));
  const over = t.total > S.budget;
  $('kpis').innerHTML = `
    <div class="kpi main ${over ? 'over' : ''}"><b>${wan(t.total)}</b><span>${over ? `超预算 ${wan(-t.left)}` : `方案总价 · 余 ${wan(t.left)}`}${t.forcedTotal ? ` · 其中指定 ${wan(t.forcedTotal)}` : ''}</span><div class="bar"><i style="width:${Math.min(100, t.total / S.budget * 100)}%"></i></div></div>
    <div class="kpi"><b>${t.vehicles} 辆 / ${t.gates} 口</b><span>公交车身 / 地铁出入口</span></div>
    <div class="kpi" title="公交：线路沿线日均人流，按线路计一次，与车辆数无关；地铁口：出入口周边日均人流。新云大数据平台 2023-05，各媒体相加未去重，不是广告实际看到的人次。"><b>${ppl(t.dailyPv)}</b><span>入选媒体历史日均人流合计（2023-05，未去重）${t.busPv && t.metroPv ? `<br>公交沿线 ${ppl(t.busPv)} · 地铁口周边 ${ppl(t.metroPv)}` : ''}</span></div>
    <div class="kpi"><b>${t.storesCovered}<small> / ${t.storesTotal}</small></b><span>${S.mode === 'addr' ? '客户地址被覆盖' : S.preset.storeIsTarget === false ? '人群锚点覆盖' : '门店覆盖'}</span><div class="bar"><i style="width:${t.storesTotal ? t.storesCovered / t.storesTotal * 100 : 0}%"></i></div></div>
    <div class="kpi"><b>${p.schedule.finalArtDeadline.slice(5)}</b><span>客户最晚定稿日</span></div>`;
  renderMap();
  renderDetail();
  renderSched();
  renderList();
  renderDiff();
  const inv = p.inv;
  $('foot').textContent = `可售数据：${inv.source === 'live' ? `红豆实时（${new Date(inv.fetchedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 查询）` : `红豆逐月快照（${inv.fetchedAt.slice(0, 10)}）`} · 候选媒体 ${t.candidates} 个 · 组案计算 ${p.ms} ms · 人流口径：大数据平台 2023-05 日均人次 · 底图：高德地图`;
  renderMonths();
  renderForced();
  renderHypo();
  renderChecks();
}

// 左侧「客户指定」清单：数量可直接键盘输入，超过可售即提示，不写入方案
function renderForced() {
  const p = S.plan, t = p.totals, lines = p.lines.filter((l) => l.forced);
  $('forcedList').innerHTML = lines.map((l) => `<li data-key="${l.key}" class="${l.want > l.qty ? 'bad' : ''}">
    <button type="button" class="nm" title="查看详情">${esc(l.name)}<small>${l.level} · 可售 ${l.free}</small></button>
    <input type="number" min="0" max="${l.free}" step="1" value="${l.want}" aria-label="${esc(l.name)} 数量">
    <span class="amt">${wan(l.net + l.make)}</span><button type="button" class="x" aria-label="移除 ${esc(l.name)}">×</button>
    ${l.want > l.qty ? `<em>可售只有 ${l.free}${l.kind === 'bus' ? ' 辆' : ' 个'}，已按 ${l.qty} 计</em>` : ''}</li>`).join('');
  $('forceInfo').innerHTML = S.forced.size ? `已指定 ${S.forced.size} 项，共 ${wan(t.forcedTotal)}，占预算 ${Math.round(t.forcedTotal / S.budget * 100)}%${t.forcedTotal > S.budget ? '，<span class="warn">已超预算</span>' : ''}。` : '指定的线路先占预算；可售不足会标红，不会超卖。';
  $('forcedList').querySelectorAll('li').forEach((li) => {
    const k = li.dataset.key, inp = li.querySelector('input');
    li.querySelector('.nm').onclick = () => select(k, true);
    li.querySelector('.x').onclick = () => { S.forced.delete(k); replan(); };
    inp.onchange = () => setQty(k, inp, li);
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); setQty(k, inp, li); } };
  });
}
// 校验键盘输入的数量：必须是 0..可售 的整数，否则就地提示，不改方案
function setQty(key, inp, host) {
  const it = byKey.get(key), free = S.free[it.kind][it.m.rid] ?? 0, v = Number(inp.value);
  const old = host.querySelector('em.err'); old && old.remove();
  const err = (msg) => { inp.classList.add('bad'); inp.setAttribute('aria-invalid', 'true'); inp.insertAdjacentHTML('afterend', `<em class="err" role="alert">${msg}</em>`); inp.focus(); };
  if (!Number.isInteger(v) || v < 1) return err('请输入大于 0 的整数');
  if (v > free) return err(`输入有误：本档期可售只有 ${free} ${it.kind === 'bus' ? '辆' : '个'}`);
  if (it.kind === 'metro' && v > 1) return err('地铁出入口每个点位只能买 1 个');
  inp.classList.remove('bad'); inp.removeAttribute('aria-invalid');
  S.forced.set(key, v); S.exclude.delete(key); replan();
}

function mapData(all = false) { // all：导出提案用，忽略工作台「只看一条」
  const p = S.plan, covered = new Set(p.coveredStores), solo = !all && S.solo && S.sel;
  const data = {
    anchors: S.anchors.map((a, i) => ({ lng: a.lng, lat: a.lat, kind: a.kind, on: covered.has(i), name: a.name })),
    bus: p.lines.filter((l) => l.kind === 'bus' && l.qty && (!solo || l.key === S.sel)).map((l) => ({ key: l.key, name: l.name, qty: l.qty, path: pathOf(l.rid) })),
    gates: p.lines.filter((l) => l.kind === 'metro' && l.qty && (!solo || l.key === S.sel)).map((l) => { const m = byKey.get(l.key)?.m; return { key: l.key, name: l.name, lng: m?.lng, lat: m?.lat }; }),
    circles: S.mode === 'addr' ? S.addrs.map((a) => ({ ...a, r: Math.max(S.busRadius, S.metroRadius) })) : [],
    fit: S.fit,
  };
  if (S.sel && !p.lines.some((l) => l.key === S.sel && l.qty)) {
    const it = byKey.get(S.sel);
    if (it) data.extra = { key: S.sel, name: mediaName(it.kind, it.m), path: it.kind === 'bus' ? pathOf(it.m.rid) : null, lng: it.m.lng, lat: it.m.lat };
  }
  return data;
}
function renderMap() {
  S.mapApi = mountPlanMap(window.L, $('map'), mapData(), { onPick: (k) => select(k) });
  $('map').querySelector('.map-solo')?.remove();
  if (S.solo && S.sel) $('map').insertAdjacentHTML('beforeend', '<p class="map-solo">只显示这一条 · 再点一次看全部方案</p>');
  S.fit = false;
  S.mapApi.highlight(S.solo && S.sel ? S.sel : null); // 看全部方案时清掉高亮，不淡化其他线路（地图组件会记住上次高亮）
}
function select(key) {
  S.solo = key && key === S.sel ? !S.solo : !!key; // 点一次地图只看这条，同一条再点一次回到全部方案
  S.sel = key; if (!S.solo) S.fit = true;
  renderMap(); renderDetail();
  if (S.solo) S.mapApi.focus(key);
  document.querySelectorAll('#list tr[data-key]').forEach((r) => r.classList.toggle('sel', r.dataset.key === key));
}

// 线路 / 点位详情：客户点名的线路能直接看到可售、占用、人流、价格
function renderDetail() {
  if (!S.plan) return;
  const key = S.sel, box = $('detail');
  if (!key || !byKey.has(key)) { box.innerHTML = '<h3>线路 / 点位详情</h3><p class="hint">点地图上的线路、地铁口，或清单里的任意一行，查看可售、占用、人流和价格；也可以在左侧第 5 步直接输入客户指定的线路。</p>'; return; }
  const { kind, m } = byKey.get(key), per = period(), p = S.plan;
  const line = p.lines.find((l) => l.key === key), cov = S.coverage[kind].find((x) => x.rid === m.rid);
  const a = avail[kind][m.rid] || { free: [], total: 0, contract: [], reserve: [], maint: [] };
  const live = S.live && S.live.key === segKey(per) ? S.live[kind][m.rid] : null;
  const cur = live || { free: S.free[kind][m.rid] ?? 0, total: a.total, contract: Math.max(...per.months.map((i) => a.contract[i] ?? 0)), reserve: Math.max(...per.months.map((i) => a.reserve[i] ?? 0)), maint: Math.max(...per.months.map((i) => a.maint[i] ?? 0)) };
  const c = unitCost(kind, m.level, per, S.discount);
  const qty = line?.qty ?? (S.forced.get(key) || 0);
  const showQty = qty || (kind === 'bus' ? Math.min(cur.free, 2) : Math.min(cur.free, 1));
  const make = c ? c.make * per.segments.length : 0;
  const maxA = Math.max(1, a.total || 1);
  const status = S.forced.has(key) ? '<span class="tag lock">客户指定</span>' : line?.qty ? '<span class="tag add">系统推荐</span>' : S.exclude.has(key) ? '<span class="tag remove">已排除</span>' : '<span class="tag">未入选</span>';
  box.innerHTML = `<h3>${esc(mediaName(kind, m))} <span class="tag">${esc(m.level)}</span> <span class="tag">${kind === 'bus' ? esc(m.form) : '出入口'}</span> ${status}</h3>
    <p class="hint">${esc(kind === 'bus' ? [m.title, m.company, m.district].filter(Boolean).join(' · ') : [m.lines, m.biz, m.tags].filter(Boolean).join(' · '))}${m.proxy ? ' · 坐标为同站参考' : ''}</p>
    <div class="facts">
      <div><b class="${cur.free ? '' : 'warn'}">${cur.free}<small> / ${cur.total}</small></b><span>本档期可售 / 总量</span></div>
      <div><b>${cur.contract} · ${cur.reserve} · ${cur.maint}</b><span>合同 · 预定 · 保养</span></div>
      <div><b>${m.pv ? ppl(m.pv) : '—'}</b><span>${kind === 'bus' ? '线路沿线' : '出入口周边'}历史日均人流（2023-05）</span></div>
      <div><b>${cov?.near.length ?? 0}</b><span>${cov?.nearest ? `半径内目标 · 最近 ${Math.round(cov.nearest.d)} 米` : '半径内无目标'}</span></div>
    </div>
    <div class="mini" aria-label="2027 各月可售">${Array.from({ length: 12 }, (_, i) => `<span class="${per.months.includes(i) ? 'in' : ''}" title="${i + 1} 月可售 ${a.free[i] ?? 0} / ${a.total}"><i style="height:${((a.free[i] ?? 0) / maxA) * 100}%"></i><b>${i + 1}</b></span>`).join('')}</div>
    ${c ? `<p class="price">刊例 ${yuan(c.card)} 元/${kind === 'bus' ? '辆' : '个'}/月 × ${per.billMonths} 个月${S.discount < 1 ? ` × ${S.discount}` : ''} × ${showQty} = <b>${yuan(c.net * showQty)}</b>，制作 ${yuan(make * showQty)}${per.segments.length > 1 ? `（${per.segments.length} 段上画）` : ''}，小计 <b>${yuan((c.net + make) * showQty)}</b> 元</p>` : '<p class="hint warn">该等级无刊例，需单独核价。</p>'}
    <div class="ctl">
      ${kind === 'bus' ? `<span class="stepper"><button type="button" data-q="-1" aria-label="减少">−</button><input type="number" id="dQty" min="1" max="${cur.free}" step="1" value="${S.forced.get(key) ?? showQty}" aria-label="购买数量"><button type="button" data-q="1" aria-label="增加">+</button></span>` : ''}
      <button type="button" class="ghost" id="dLock">${S.forced.has(key) ? '取消指定' : '按此数量指定'}</button>
      <button type="button" class="ghost" id="dEx">${S.exclude.has(key) ? '恢复推荐' : '不再推荐'}</button>
      <button type="button" class="ghost" id="dFocus">地图定位</button>
      <button type="button" class="ghost" id="dCheck">向红豆核对</button>
    </div>
    <div id="dUsage"></div>`;
  const q = $('dQty');
  if (q) { q.onchange = () => setQty(key, q, q.parentElement.parentElement); q.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); setQty(key, q, q.parentElement.parentElement); } }; }
  box.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => { q.value = Math.max(1, (+q.value || 0) + +b.dataset.q); setQty(key, q, q.parentElement.parentElement); });
  $('dCheck').onclick = () => checkLine(key, cur);
  $('dLock').onclick = () => { if (S.forced.has(key)) S.forced.delete(key); else { S.forced.set(key, showQty || 1); S.exclude.delete(key); } replan(); };
  $('dEx').onclick = () => { if (S.exclude.has(key)) S.exclude.delete(key); else { S.exclude.add(key); S.forced.delete(key); } replan(); };
  $('dFocus').onclick = () => S.mapApi.focus(key);
}

// 单条线路向红豆实时核对：逐段查空车数与合同/预定占用明细，和工作台当前用的数字对比
const mask = (b) => (b ? b.slice(0, 1) + '＊'.repeat(Math.min(3, b.length - 1)) : '—'); // 其他客户品牌只露首字
async function checkLine(key, cur) {
  const box = $('dUsage'), it = byKey.get(key), per = period();
  box.innerHTML = '<p class="hint">正在查询红豆…</p>';
  try {
    const segs = await Promise.all(per.segments.map((s) => getJson(`/api/usage?kind=${it.kind}&rid=${it.m.rid}&start=${s.start}&end=${s.end}`)));
    const free = Math.min(...segs.map((s) => s.row.free));
    const d = (t) => new Date(t).toLocaleDateString('sv-SE');
    const groups = new Map();
    for (const s of segs) for (const u of [...s.occupy, ...s.hold]) {
      const g = groups.get(u.orderNo + u.phase) || { ...u, n: 0, plates: new Set() };
      g.plates.add(u.extraInfo); g.n = g.plates.size; groups.set(u.orderNo + u.phase, g);
    }
    const unit = it.kind === 'bus' ? '辆' : '个';
    box.innerHTML = `<div class="verify ${free === cur.free ? 'ok' : 'diff'}">
      ${free === cur.free ? `✓ 红豆实时空车 ${free} ${unit}，与工作台一致` : `红豆实时空车 ${free} ${unit}，工作台当前用的是 ${cur.free}（快照）。点上方「红豆实时核对可售」按实时库存重算。`}
      <small>${segs.map((s) => `${s.start.slice(5)}~${s.end.slice(5)}：总 ${s.row.total} − 合同 ${s.row.contract} − 预定 ${s.row.reserve} − 保养 ${s.row.maint}${s.row.renew ? ` − 续约保护 ${s.row.renew}` : ''} = 空 ${s.row.free}`).join('<br>')}</small></div>` +
      (groups.size ? `<table class="usage"><thead><tr><th>占用</th><th>品牌</th><th class="n">${unit}</th><th>档期</th></tr></thead><tbody>${[...groups.values()].map((g) => `<tr><td>${g.phase === 'occupy' ? '合同' : '预定'}</td><td>${esc(mask(g.adContent))}<small>${esc(g.orderNo)}</small></td><td class="n">${g.n}</td><td>${d(g.startTime)} ~ ${d(g.endTime)}${g.phase === 'hold' && g.canReservationTime ? `<small>预定保留至 ${d(g.canReservationTime)}</small>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">该档期内没有合同或预定占用。</p>');
  } catch (e) { box.innerHTML = `<p class="hint warn">核对失败：${esc(e.message)}</p>`; }
}

// campaign 假设书：七要素可编辑；⑤⑥ 随输入自动生成，方案逐条回应
const HYPO_FIELDS = [['client', '① 客户与品牌'], ['biz', '② 生意目标'], ['audience', '④ 目标人群'], ['kpi', '⑦ 成功衡量 · KPI 口径'], ['proof', '⑦ 怎么证明投出去了']];
function renderHypo() {
  if (!S.plan) return;
  const box = $('hypo'), per = S.plan.period;
  if (box.contains(document.activeElement)) return; // 正在输入时不重绘
  box.innerHTML = HYPO_FIELDS.slice(0, 2).map(fieldHtml).join('') +
    `<p class="hyp-auto"><b>③ campaign 目标</b>主目标${OBJ_LABEL[S.objective]}（随第 4 步「到店引流 / 品牌曝光」切换）</p>` +
    fieldHtml(HYPO_FIELDS[2]) +
    `<p class="hyp-auto"><b>⑤ 时间与预算</b>${per.segments.map((x) => `${x.start.slice(5)}~${x.end.slice(5)}`).join('、')} · ${wan(S.budget)}</p>` +
    `<p class="hyp-auto"><b>⑥ 媒体范围</b>${S.media.map((m) => (m === 'bus' ? '公交车身' : '地铁出入口')).join(' + ') || '—'}</p>` +
    HYPO_FIELDS.slice(3).map(fieldHtml).join('');
  box.querySelectorAll('textarea').forEach((ta) => ta.oninput = () => { S.hypo[ta.dataset.k] = ta.value; renderChecks(); });
}
const fieldHtml = ([k, label]) => `<label class="field">${label}<textarea rows="2" data-k="${k}">${esc(S.hypo?.[k] ?? '')}</textarea></label>`;

// 提交前自检：10 条逐条打勾，红黄绿实时跟着方案变
function renderChecks() {
  if (!S.plan) return;
  const R = assess({ preset: S.preset, hypo: S.hypo || {}, plan: S.plan, budget: S.budget, mode: S.mode, liveChecked: S.plan.inv.source === 'live', brand: S.brand });
  const n = R.checks.filter((c) => c.s === 'ok').length;
  $('checks').innerHTML = `<h3>提交前自检 <span class="tag ${n === 10 ? 'add' : ''}">${n} / 10</span></h3><ol class="checks">${R.checks.map((c) => `<li class="${c.s}"><b>${esc(c.t)}</b><span>${esc(c.d)}</span></li>`).join('')}</ol>`;
}
$('refBrief').innerHTML += REF_BRIEFS.map((b, i) => `<option value="${i}">${esc(b.label)}</option>`).join('');
$('refBrief').onchange = async (e) => { const b = REF_BRIEFS[e.target.value]; if (!b) return; $('briefText').value = b.text; await $('briefGo').onclick(); if (b.radius?.metro) { S.metroRadius = b.radius.metro; syncInputs(); replan(); } S.hypo.biz = b.text.split(/，\d{4}/)[0] + '（参考 brief）'; renderHypo(); renderChecks(); };

function renderSched() {
  const s = S.plan.schedule;
  $('sched').innerHTML = `<h3>上刊倒排</h3><ul class="steps">${s.steps.map((x) => `<li><span>${esc(x.name)}</span><span>${x.from.slice(5)} – ${x.to.slice(5)}</span></li>`).join('')}</ul>
    <p class="hint">${S.preset.adReviewDays ? `<span class="warn">已预留 ${S.preset.adReviewDays} 个工作日广告审查。</span>` : ''}按误一补二，每延误 1 天约补偿 ${wan(s.delayCostPerDay)}。</p>`;
}

function renderList() {
  const p = S.plan;
  $('tabPlan').setAttribute('aria-selected', S.tab === 'plan'); $('tabCand').setAttribute('aria-selected', S.tab === 'cand');
  $('tabPlan').textContent = `方案线路 / 点位 ${p.lines.length}`;
  const per = period();
  let html;
  if (S.tab === 'plan') {
    const base = S.pinned || S.prev, changed = new Set(base ? diffPlans(base, p).map((x) => x.l.key) : []);
    const picked = p.lines.filter((l) => l.forced).length;
    html = `<div class="pick-bar"><span>勾选 = 我要这条（转为客户指定，数量锁定）。已勾选 ${picked} / ${p.lines.length}。<i class="chg-key"></i>黄底 = 相对${S.pinned ? '基准方案' : '上一版'}新增或数量有变化</span><button type="button" class="mini-btn" id="pickAll">全部勾选</button><button type="button" class="mini-btn" id="pickOnly" ${picked ? '' : 'disabled'}>${S.autoFill ? '只要勾选的（不再自动补足）' : '恢复自动补足剩余预算'}</button></div>` +
      `<table><thead><tr><th class="ck"><span class="sr">要</span></th><th>线路 / 点位</th><th>来源</th><th>等级</th><th>形式</th><th class="n">数量</th><th class="n">可售</th><th class="n">日均人次</th><th class="n">半径内目标</th><th>最近目标</th><th class="n">发布费</th><th class="n">制作</th><th class="n">小计</th></tr></thead><tbody>` +
      p.lines.map((l) => `<tr data-key="${l.key}" class="${changed.has(l.key) ? 'chg' : ''} ${S.sel === l.key ? 'sel' : ''}"><td class="ck"><input type="checkbox" data-pick="${l.key}" data-qty="${l.qty}" ${l.forced ? 'checked' : ''} aria-label="要 ${esc(l.name)}"></td><td><b>${esc(l.name)}</b>${l.company ? `<small>${esc(l.company)}</small>` : ''}${l.proxy ? '<small>同站参考</small>' : ''}</td><td>${l.forced ? '<span class="tag lock">指定</span>' : '<span class="tag">推荐</span>'}</td><td>${l.level}</td><td>${esc(l.form)}</td><td class="n ${l.forced && l.want > l.qty ? 'warn' : ''}">${l.qty}${l.forced && l.want > l.qty ? `<small>要 ${l.want}</small>` : ''}</td><td class="n">${l.free}</td><td class="n">${l.qty ? ppl(l.pv) : '—'}${l.pvEstimated ? '<small>估</small>' : ''}</td><td class="n">${l.nearStores}</td><td>${l.nearest ? `${esc(l.nearest.name)}<small>${l.nearest.d}m</small>` : '—'}</td><td class="n">${yuan(l.net)}</td><td class="n">${yuan(l.make)}</td><td class="n"><b>${yuan(l.net + l.make)}</b></td></tr>`).join('') +
      `</tbody><tfoot><tr><td></td><td colspan="4">合计</td><td class="n">${p.totals.vehicles + p.totals.gates}</td><td></td><td class="n">${ppl(p.totals.dailyPv)}</td><td colspan="2"></td><td class="n">${yuan(p.totals.net)}</td><td class="n">${yuan(p.totals.make)}</td><td class="n"><b>${yuan(p.totals.total)}</b></td></tr></tfoot></table>`;
  } else {
    // 服务半径内全部候选：按离目标的距离排，可一键指定
    const inPlan = new Map(p.lines.map((l) => [l.key, l]));
    const rows = [];
    for (const kind of ['bus', 'metro']) for (const m of S.coverage[kind]) if (m.near.length) {
      const c = unitCost(kind, m.level, per, S.discount);
      rows.push({ key: keyOf(kind, m.rid), kind, m, d: m.nearest?.d ?? 1e9, free: S.free[kind][m.rid] ?? 0, c });
    }
    rows.sort((a, b) => a.d - b.d);
    $('tabCand').textContent = `服务半径内全部候选 ${rows.length}`;
    html = `<table><thead><tr><th class="ck"><span class="sr">要</span></th><th>线路 / 点位</th><th>类型</th><th>等级</th><th class="n">最近距离</th><th>最近目标</th><th class="n">半径内目标</th><th class="n">可售</th><th class="n">日均人次</th><th class="n">单价/月</th><th>状态</th></tr></thead><tbody>` +
      rows.slice(0, 300).map((r) => { const l = inPlan.get(r.key); return `<tr data-key="${r.key}" class="${S.sel === r.key ? 'sel' : ''}"><td class="ck"><input type="checkbox" data-pick="${r.key}" data-qty="${l?.qty || (r.kind === 'bus' ? Math.min(2, r.free) : 1)}" ${l?.forced ? 'checked' : ''} ${r.free ? '' : 'disabled'} aria-label="要 ${esc(mediaName(r.kind, r.m))}"></td><td><b>${esc(mediaName(r.kind, r.m))}</b></td><td>${r.kind === 'bus' ? '公交' : '地铁口'}</td><td>${r.m.level}</td><td class="n">${Math.round(r.d)} m</td><td>${esc(S.anchors[r.m.nearest.i]?.name)}</td><td class="n">${r.m.near.length}</td><td class="n ${r.free ? '' : 'warn'}">${r.free}</td><td class="n">${r.m.pv ? ppl(r.m.pv) : '—'}</td><td class="n">${r.c ? yuan(r.c.card) : '待核价'}</td><td>${l?.qty ? `<span class="tag ${l.forced ? 'lock' : 'add'}">${l.forced ? '指定' : '入选'} ${l.qty}</span>` : S.exclude.has(r.key) ? '<span class="tag remove">排除</span>' : ''}</td></tr>`; }).join('') + '</tbody></table>' +
      (rows.length > 300 ? `<p class="hint">只显示最近的 300 个，共 ${rows.length} 个。</p>` : '') + (rows.length ? '' : '<p class="hint" style="padding:12px">服务半径内没有自营媒体，试试扩大半径。</p>');
  }
  $('list').innerHTML = html;
  $('list').querySelectorAll('tr[data-key]').forEach((r) => {
    r.onmouseenter = () => S.mapApi.hover(r.dataset.key); // 和地图上悬停一样：临时标红，移开恢复
    r.onmouseleave = () => S.mapApi.hover(null);
    r.onclick = (e) => { if (e.target.dataset.pick) return; select(r.dataset.key, true); };
  });
  // 勾选 = 我要这条：转为客户指定并锁定当前数量；取消勾选 = 放回系统推荐
  $('list').querySelectorAll('[data-pick]').forEach((c) => c.onchange = () => {
    const k = c.dataset.pick;
    if (c.checked) { S.forced.set(k, Math.max(1, +c.dataset.qty || 1)); S.exclude.delete(k); } else S.forced.delete(k);
    replan();
  });
  const all = $('pickAll'), only = $('pickOnly');
  if (all) all.onclick = () => { for (const l of p.lines) if (!l.forced && l.qty) S.forced.set(l.key, l.qty); replan(); };
  if (only) only.onclick = () => { S.autoFill = !S.autoFill; syncInputs(); replan(); };
}

// 预算/媒体/档期调整后的变化，放在清单之后
function renderDiff() {
  const p = S.plan, t = p.totals, base = S.pinned || S.prev, d = base ? diffPlans(base, p) : [];
  const label = { add: '新增', more: '加量', less: '减量', remove: '移除' };
  $('diff').innerHTML = `<h3>${S.pinned ? '相对基准方案' : '相对上一版'}的变化 ${base ? `<span class="tag">${wan(base.totals.total)} → ${wan(t.total)}</span>` : ''}</h3>` +
    (d.length ? `<ul class="diffs">${d.map((x) => `<li data-key="${x.l.key}"><span class="tag ${x.type === 'add' || x.type === 'more' ? 'add' : 'remove'}">${label[x.type]}</span> ${esc(x.l.name)} <small>${x.d > 0 ? '+' : ''}${x.d} ${x.l.kind === 'bus' ? '辆' : '个'}</small></li>`).join('')}</ul>` : '<p class="hint">调整预算、媒体、档期或指定线路后，这里列出增减的线路和点位。</p>');
  $('diff').querySelectorAll('li[data-key]').forEach((li) => li.onclick = () => select(li.dataset.key, true));
}

function renderMonths() {
  // 服务半径内媒体在 2027 每个月的可售量，帮助挑档期；可多选
  const kinds = S.media.length ? S.media : ['bus', 'metro'];
  const near = kinds.flatMap((k) => S.coverage[k].filter((m) => m.near.length).map((m) => [k, m.rid]));
  const per = period();
  const vals = Array.from({ length: 12 }, (_, i) => near.reduce((s, [k, rid]) => s + (avail[k][rid]?.free[i] ?? 0), 0));
  const max = Math.max(1, ...vals);
  $('months').innerHTML = vals.map((v, i) => `<button type="button" class="${per.months.includes(i) ? 'in' : ''}" aria-pressed="${per.months.includes(i)}" data-m="${i}" title="${i + 1} 月：半径内可售 ${v}"><i style="height:${Math.max(3, v / max * 52)}px"></i><b>${i + 1}</b></button>`).join('');
  $('months').querySelectorAll('button').forEach((b) => b.onclick = () => {
    const m = +b.dataset.m;
    if (!S.monthSel.length) S.monthSel = [...per.months]; // 从当前档期覆盖的月份开始增减
    if (!S.monthSel.includes(m)) S.monthSel = [...S.monthSel, m].sort((a, b) => a - b);
    else if (S.monthSel.length > 1) S.monthSel = S.monthSel.filter((x) => x !== m);
    const p2 = period(); S.start = p2.start; S.end = p2.end; syncInputs(); replan();
  });
  $('monthHint').textContent = S.monthSel.length > 1 ? `已选 ${S.monthSel.map((m) => m + 1).join('、')} 月，共 ${per.billMonths} 个月${per.segments.length > 1 ? `，分 ${per.segments.length} 段上画` : ''}。再点一次取消。` : '柱高 = 该月服务半径内可售车辆与地铁口数量。点柱子多选月份，不连续的月份每段单独上画。';
}

// ---------- 输入 ----------
function syncInputs() {
  $('brandKw').value = S.brand;
  [...$('industry').children].forEach((b) => b.setAttribute('aria-pressed', b.dataset.k === S.key));
  document.querySelectorAll('input[name=mode]').forEach((r) => (r.checked = r.value === S.mode));
  $('addrBox').hidden = S.mode !== 'addr'; $('brandGo').hidden = S.mode === 'addr';
  $('budget').value = S.budget; $('mBus').checked = S.media.includes('bus'); $('mMetro').checked = S.media.includes('metro');
  $('shareWrap').hidden = S.media.length < 2; $('share').value = S.metroShare; $('shareOut').textContent = Math.round(S.metroShare * 100) + '%';
  document.querySelectorAll('input[name=obj]').forEach((r) => (r.checked = r.value === S.objective));
  $('start').value = S.start; $('end').value = S.end; $('autoFill').checked = S.autoFill;
  $('discount').value = S.discount; $('discOut').textContent = S.discount >= 1 ? '刊例价' : (S.discount * 10).toFixed(1).replace(/\.0$/, '') + ' 折';
  $('busR').value = S.busRadius; $('metroR').value = S.metroRadius; $('maxLine').value = S.maxPerLine; $('perNight').value = S.busPerNight;
}
$('industry').innerHTML = Object.entries(PRESETS).map(([k, p]) => `<button type="button" aria-pressed="false" data-k="${k}">${p.industry.replace('（主题公园）', '')}</button>`).join('');
$('industry').onclick = async (e) => { const k = e.target.closest('button')?.dataset.k; if (k) { const mode = S.mode; await applyPreset(k); if (mode === 'addr') { S.mode = 'addr'; syncInputs(); refreshAnchors(true); } } };
$('budgetChips').innerHTML = BUDGETS.map((v) => `<button type="button" data-v="${v}">${v / 10000} 万</button>`).join('');
$('budgetChips').onclick = (e) => { const v = +e.target.dataset.v; if (v) { S.budget = v; syncInputs(); replan(); } };
$('budget').oninput = (e) => { S.budget = +e.target.value; replan(); };
const mediaChange = () => { S.media = [$('mBus').checked && 'bus', $('mMetro').checked && 'metro'].filter(Boolean); syncInputs(); replan(); };
$('mBus').onchange = mediaChange; $('mMetro').onchange = mediaChange;
$('share').oninput = (e) => { S.metroShare = +e.target.value; $('shareOut').textContent = Math.round(S.metroShare * 100) + '%'; replan(); };
document.querySelectorAll('input[name=obj]').forEach((r) => (r.onchange = () => { S.objective = r.value; replan(); }));
document.querySelectorAll('input[name=mode]').forEach((r) => (r.onchange = () => { S.mode = r.value; if (S.mode === 'addr') S.objective = 'visit'; syncInputs(); refreshAnchors(true); }));
$('start').onchange = (e) => { S.start = e.target.value; S.monthSel = []; replan(); };
$('end').onchange = (e) => { S.end = e.target.value; S.monthSel = []; replan(); };
$('discount').oninput = (e) => { S.discount = +e.target.value; syncInputs(); replan(); };
$('autoFill').onchange = (e) => { S.autoFill = e.target.checked; replan(); };
for (const [id, k] of [['busR', 'busRadius'], ['metroR', 'metroRadius'], ['maxLine', 'maxPerLine'], ['perNight', 'busPerNight']]) $(id).onchange = (e) => { S[k] = +e.target.value; if (S.mode === 'addr') refreshAnchors(); else replan(); };
$('tabPlan').onclick = () => { S.tab = 'plan'; renderList(); };
$('tabCand').onclick = () => { S.tab = 'cand'; renderList(); };

// 客户指定线路：输入框带全部 430 条线路和 861 个出入口的联想
const optLabel = (k, it) => `${it.kind === 'bus' ? '公交' : '地铁'} · ${mediaName(it.kind, it.m)} · ${it.m.level}`;
const labelToKey = new Map([...byKey].map(([k, it]) => [optLabel(k, it), k]));
$('mediaList').innerHTML = [...labelToKey.keys()].map((l) => `<option value="${esc(l)}">`).join('');
const addForced = () => {
  const v = $('forceKw').value.trim(); if (!v) return;
  let k = labelToKey.get(v);
  if (!k) { // 允许只输"18"或"18路"、"人民广场 1号口"
    const q = v.replace(/路$/, '').replace(/\s+/g, '');
    k = [...byKey].find(([, it]) => it.kind === 'bus' && it.m.name.replace(/路$/, '') === q)?.[0]
      ?? [...byKey].find(([, it]) => it.kind === 'metro' && (it.m.station + it.m.exit).replace(/\s+/g, '') === q)?.[0]
      ?? [...byKey].find(([, it]) => mediaName(it.kind, it.m).replace(/\s+/g, '').includes(q))?.[0];
  }
  if (!k) { $('forceInfo').innerHTML = `<span class="warn">红豆媒体库里没有「${esc(v)}」。</span>`; return; }
  const it = byKey.get(k), free = S.free[it.kind][it.m.rid] ?? 0;
  S.forced.set(k, it.kind === 'bus' ? Math.max(1, Math.min(free || 1, 3)) : 1); S.exclude.delete(k); S.sel = k; S.solo = false; S.tab = 'plan';
  $('forceKw').value = ''; replan(); S.mapApi.focus(k);
};
$('forceGo').onclick = addForced;
$('forceKw').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addForced(); } };

$('brandGo').onclick = async () => {
  const kw = $('brandKw').value.trim(); if (!kw) return;
  const btn = $('brandGo'); btn.disabled = true; btn.textContent = '检索中…';
  try {
    const d = await loadPoi(kw);
    if (!d.rows.length) throw new Error('平台没有检索到该品牌门店');
    S.brand = kw; S.preset = { ...S.preset, brand: kw, poi: kw, exclude: /停车|ATM|自助/ };
    refreshAnchors(true); S.t0 = Date.now(); S.timerStop = false;
  } catch (e) {
    $('brandInfo').innerHTML = `<span class="warn">${esc(e.message)}。大数据平台未登录时点右上角「大数据平台」登录。</span>`;
    if (e.message.includes('未登录')) { $('pillBd').click(); checkStatus(); } // 同地址检索：会话过期直接弹登录框
  }
  btn.disabled = false; btn.textContent = '检索门店';
};
$('brandKw').oninput = () => { setBrand($('brandKw').value.trim()); };
function setBrand(b) {
  S.brand = b;
  const p = PRESETS[S.key];
  if (S.hypo && (S.hypo.client === p.hypo.client || S.hypo.autoClient)) { S.hypo.client = b && b !== p.brand ? ` · ${b}（请补充规模、门店数）` : p.hypo.client; S.hypo.autoClient = b !== p.brand; }
  renderHypo(); renderChecks();
}

// 客户具体地址 → 坐标 → 服务半径内的线路与出入口
$('addrGo').onclick = async () => {
  const lines = $('addrText').value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 20);
  if (!lines.length) return;
  const btn = $('addrGo'); btn.disabled = true; btn.textContent = '解析地址中…';
  const out = [], fails = [];
  await Promise.all(lines.map(async (q) => {
    const xy = q.match(/^(1[12]\d\.\d+)\s*[,，\s]\s*(3[01]\.\d+)$/);
    if (xy) return out.push({ name: q, lng: +xy[1], lat: +xy[2], by: '坐标' });
    try { out.push(await getJson(`/api/geocode?q=${encodeURIComponent(q)}`)); } catch (e) { fails.push(`${q}：${e.message}`); }
  }));
  out.sort((a, b) => lines.indexOf(a.name) - lines.indexOf(b.name));
  S.addrs = out;
  $('addrList').innerHTML = out.map((a) => `<li><b>${esc(a.name)}</b><small>${a.lng.toFixed(5)}, ${a.lat.toFixed(5)} · ${esc(a.by)}${a.level ? ' · ' + esc(a.level) : ''}</small></li>`).join('') + fails.map((f) => `<li class="warn">${esc(f)}</li>`).join('');
  btn.disabled = false; btn.textContent = '查询服务半径内的线路与出入口';
  // 平台会话过期时直接弹出登录框，登录后再点一次查询即可
  if (fails.some((f) => f.includes('未登录'))) { $('pillBd').click(); checkStatus(); if (!out.length) return; }
  S.tab = 'cand'; refreshAnchors(true);
};

$('briefGo').onclick = async () => {
  const text = $('briefText').value; if (!text.trim()) return;
  let r; try { r = await (await fetch('/api/brief', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })).json(); } catch { r = { parsed: parseBrief(text), by: 'rules' }; }
  const b = r.parsed, got = [];
  // 每次解析从默认值开始：brief 没提到的项回到当前行业的预设，避免沿用上一次解析的结果
  await applyPreset(b.industry || S.key); if (b.industry) got.push('行业');
  Object.assign(S, { budget: 2000000, busRadius: DEFAULTS.busRadius, metroRadius: DEFAULTS.metroRadius, discount: 1, maxPerLine: DEFAULTS.maxPerLine, busPerNight: DEFAULTS.busPerNight, autoFill: true });
  const newBrand = b.brand && b.brand !== S.brand;
  if (b.brand) { setBrand(b.brand); got.push('品牌'); } // 先写进状态，syncInputs 才不会把输入框改回旧品牌
  if (b.budget) { S.budget = Math.min(5000000, Math.max(1000000, b.budget)); got.push('预算'); }
  if (b.start && b.end) { S.start = b.start; S.end = b.end; S.monthSel = []; got.push('档期'); }
  if (b.media) { S.media = b.media; got.push('媒体'); }
  if (b.radius?.bus) { S.busRadius = b.radius.bus; got.push(`公交半径 ${b.radius.bus} 米`); }
  if (b.radius?.metro) { S.metroRadius = b.radius.metro; got.push(`地铁半径 ${b.radius.metro} 米`); }
  if (b.metroShare != null) { S.metroShare = b.metroShare; got.push(`地铁占比 ${Math.round(b.metroShare * 100)}%`); }
  if (b.objective) { S.objective = b.objective; got.push('目标'); }
  syncInputs(); if (b.radius && S.mode === 'addr') refreshAnchors(); else replan(); // 地址模式改半径要重新圈选，同半径输入框
  $('briefInfo').textContent = got.length ? `已填写：${got.join('、')}（${r.by === 'rules' ? '规则解析' : '规则 + 大模型'}）。` : '没有识别出可用字段，请手动设置。';
  if (newBrand) await $('brandGo').onclick(); // 品牌变了就直接检索门店，不用再手点
};

$('liveBtn').onclick = async () => {
  if (!S.plan) return;
  const btn = $('liveBtn'); btn.disabled = true; btn.textContent = '查询红豆中…';
  try {
    const per = period(), before = S.plan;
    const segs = await Promise.all(per.segments.map((s) => getJson(`/api/inventory?start=${s.start}&end=${s.end}`)));
    // 多段档期：每个资源取各段里最紧的那段
    const live = { key: segKey(per), source: 'live', fetchedAt: segs[0].fetchedAt, start: per.start, end: per.end, bus: {}, metro: {} };
    for (const sg of segs) for (const k of ['bus', 'metro']) for (const [rid, v] of Object.entries(sg[k])) if (!live[k][rid] || v.free < live[k][rid].free) live[k][rid] = v;
    S.live = live; replan();
    const d = diffPlans(before, S.plan).length;
    btn.textContent = d ? `已按实时库存调整 ${d} 项` : '实时库存核对通过';
  } catch (e) { btn.textContent = '实时查询失败，沿用快照'; alertDlg('红豆实时查询失败', esc(e.message) + '<br>可点右上角「红豆库存」更新登录令牌。'); }
  setTimeout(() => { btn.disabled = false; btn.textContent = '红豆实时核对可售'; }, 2600);
};
$('pinBtn').onclick = () => { if (!S.plan) return; S.pinned = S.pinned ? null : S.plan; $('pinBtn').textContent = S.pinned ? '取消对比基准' : '设为对比基准'; render(); };
$('reportBtn').onclick = async () => {
  if (!S.plan) return; // 输入无效时没有方案，不导出旧结果
  const btn = $('reportBtn'); btn.disabled = true; btn.textContent = '生成中…';
  let coverCheck = null;
  try { // 用平台原生「媒体覆盖分析」对覆盖最多的门店做一次在线复核，写进提案
    const centers = S.plan.coveredStores.slice(0, 6).map((i) => S.anchors[i]);
    if (centers.length) {
      const r = await fetch('/api/cover-check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ centers, radius: S.busRadius, mediaTypes: S.media.length ? S.media : ['bus', 'metro'] }) });
      if (r.ok) { const chosen = new Set(S.plan.lines.map((l) => l.name.replace(/路$/, ''))); coverCheck = (await r.json()).lines.filter((x) => chosen.has(String(x.line).replace(/路$/, '')) || x.type === 'metro'); }
    }
  } catch {}
  const [ljs, lcss] = await Promise.all(['vendor/leaflet.js', 'vendor/leaflet.css'].map((u) => fetch(u).then((r) => r.text())));
  const custom = (S.brand || '') !== PRESETS[S.key].brand;
  const brand = S.brand || (S.mode === 'addr' && S.addrs[0] ? S.addrs[0].name : '目标客户');
  const preset = custom ? { ...S.preset, ...S.preset.generic, sources: [] } : S.preset;
  const html = buildReport({ preset, brand, plan: S.plan, anchors: S.anchors, universe, inv: S.plan.inv, budget: S.budget, coverCheck, mode: S.mode, addrs: S.addrs, radius: { bus: S.busRadius, metro: S.metroRadius }, leaflet: { js: ljs, css: lcss }, mapData: { ...mapData(true), extra: null, fit: true }, hypo: S.hypo, liveChecked: S.plan.inv.source === 'live' });
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const a = document.createElement('a'); a.href = url; a.download = `${S.brand}-新云户外提案-${S.budget / 10000}万.html`;
  window.open(url, '_blank'); a.click();
  if (!S.timerStop) { S.timerStop = true; tick(); }
  btn.disabled = false; btn.textContent = '生成客户提案';
};

// ---------- 系统连接 ----------
function alertDlg(title, html) { $('dlgBody').innerHTML = `<h3>${title}</h3><p>${html}</p><menu><button class="primary" value="ok">知道了</button></menu>`; $('dlg').showModal(); }
async function checkStatus() {
  try {
    const s = await getJson('/api/status');
    for (const [id, on] of [['pillHd', s.hd], ['pillBd', s.bd]]) { $(id).className = 'pill ' + (on ? 'on' : 'off'); $(id).querySelector('span').textContent = on ? '已连接' : '未连接'; }
  } catch { for (const id of ['pillHd', 'pillBd']) { $(id).className = 'pill off'; $(id).querySelector('span').textContent = '离线快照'; } }
}
$('pillBd').onclick = () => {
  $('dlgBody').innerHTML = `<h3>登录新云大数据平台</h3><p class="hint">用于实时检索门店、解析客户地址和覆盖分析复核。账号可留空，使用服务端环境变量 BD_USER / BD_PASS。</p>
    <label class="field">账号<input name="user" autocomplete="username"></label><label class="field">密码<input name="pass" type="password" autocomplete="current-password"></label>
    <img id="cap" src="/api/bd/captcha?${Date.now()}" width="100" height="40" alt="验证码，点击刷新"><label class="field">验证码<input name="captcha" required></label>
    <p class="hint" id="dlgMsg"></p><menu><button value="cancel" class="ghost">取消</button><button id="dlgOk" class="primary" value="ok">登录</button></menu>`;
  $('cap').onclick = () => ($('cap').src = '/api/bd/captcha?' + Date.now());
  $('dlgOk').onclick = async (e) => {
    e.preventDefault(); const f = new FormData($('dlgBody'));
    const r = await fetch('/api/bd/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(f)) });
    if (r.ok) { $('dlg').close(); checkStatus(); } else { $('dlgMsg').textContent = (await r.json()).error; $('cap').click(); }
  };
  $('dlg').showModal();
};
$('pillHd').onclick = () => {
  $('dlgBody').innerHTML = `<h3>连接红豆系统</h3><p class="hint">红豆登录是滑块验证码。请在浏览器登录红豆后，按 F12 → Application → Local Storage，复制 ACCESS_TOKEN 与 REFRESH_TOKEN 的 v 值（32 位）。之后服务会自动续期。</p>
    <label class="field">ACCESS_TOKEN<input name="accessToken" required></label><label class="field">REFRESH_TOKEN<input name="refreshToken" required></label>
    <p class="hint" id="dlgMsg"></p><menu><button value="cancel" class="ghost">取消</button><button id="dlgOk" class="primary" value="ok">保存</button></menu>`;
  $('dlgOk').onclick = async (e) => {
    e.preventDefault(); const f = new FormData($('dlgBody'));
    const r = await fetch('/api/hd/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(f)) });
    if (r.ok) { $('dlg').close(); checkStatus(); } else $('dlgMsg').textContent = (await r.json()).error;
  };
  $('dlg').showModal();
};

function tick() {
  const s = Math.floor((Date.now() - S.t0) / 1000);
  $('clock').textContent = `出案用时 ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}${S.timerStop ? ' · 已出案' : ''}`;
}
setInterval(() => { if (!S.timerStop) tick(); }, 1000);

await applyPreset('bank');
checkStatus();
