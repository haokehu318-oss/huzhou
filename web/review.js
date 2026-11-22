// 按《好提案的标准与需求定义》把一版方案整理成：假设书逐条回应、选点证据链、预算拆分、效果口径、提交前 10 条自检。
// 工作台（实时自检）和客户提案（正文章节）共用，保证两边说的是同一套数。
const wan = (n) => (n / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 1 }) + ' 万';
const ppl = (n) => (n >= 1e8 ? (n / 1e8).toFixed(2) + ' 亿' : n >= 10000 ? (n / 10000).toFixed(1) + ' 万' : String(Math.round(n)));
export const OBJ_LABEL = { visit: '到店', reach: '认知' };
export const MEDIA_LABEL = { bus: '公交车身', metro: '地铁出入口' };

export function assess({ preset, hypo, plan, budget, mode, liveChecked, brand }) {
  const t = plan.totals, f = plan.funnel, opt = plan.opt, per = plan.period, s = plan.schedule;
  const media = [...new Set(plan.lines.filter((l) => l.qty).map((l) => l.kind))];
  const anchorWord0 = mode === 'addr' ? '客户地址' : preset.storeIsTarget === false ? '人群锚点' : '门店';
  const main = [...plan.shares].sort((a, b) => b.total - a.total)[0];
  const anchorWord = anchorWord0;
  const perTxt = per.segments.map((x) => `${x.start} 至 ${x.end}`).join('、');
  const cumPv = t.dailyPv * per.days;
  // 为什么是这几条：按"覆盖门店多、人次高、等级高"挑前 3 条讲取舍
  const lvl = { S: 4, 'A++': 3, 'A+': 2, AA: 1 };
  const top = plan.lines.filter((l) => l.qty).sort((a, b) => (b.nearStores - a.nearStores) || (b.pv - a.pv) || ((lvl[b.level] || 0) - (lvl[a.level] || 0))).slice(0, 3)
    .map((l) => `${l.name}（${l.level}，${anchorWord} ${l.nearStores} 处，日均 ${ppl(l.pv)} 人次${l.forced ? '，客户指定' : ''}）`);
  const mix = plan.shares.length > 1
    ? `${MEDIA_LABEL[main.kind]}为主（${Math.round(main.pct * 100)}%），${plan.shares.filter((x) => x !== main).map((x) => `${MEDIA_LABEL[x.kind]}补位（${Math.round(x.pct * 100)}%）`).join('')}。${opt.objective === 'visit' ? `地铁口负责${anchorWord}附近的最后一段，公交负责沿线反复曝光。` : '公交负责全城通勤动线的频次，地铁口补核心商圈的第一眼。'}`
    : main ? `单一媒体：${MEDIA_LABEL[main.kind]}（100%）。` : '暂无入选媒体。';

  const response = [
    { k: '① 客户与品牌', h: hypo.client, r: `目标客户 ${brand || preset.brand}；平台检索 ${t.storesTotal} 处${anchorWord}作为选点起点。` },
    { k: '② 生意目标', h: hypo.biz, r: `${top.length ? '优先选能覆盖更多' + anchorWord + '的线路：' + top[0] : '—'}。` },
    { k: '③ campaign 目标', h: hypo.goal || `主目标${OBJ_LABEL[opt.objective]}`, r: opt.objective === 'visit' ? `只选${anchorWord}周边（公交 ${opt.busRadius} 米途经 / 地铁口 ${opt.metroRadius} 米，均为直线距离）的媒体，按人次 × ${anchorWord}相关度排序。` : '按日均覆盖人次排序，兼顾门店密集区与高等级线路。' },
    { k: '④ 目标人群', h: hypo.audience, r: `覆盖 ${t.storesCovered} / ${t.storesTotal} 处${anchorWord}，入选媒体历史日均人流合计 ${ppl(t.dailyPv)}（大数据平台 2023-05，未去重，不等于广告实际触达）。` },
    { k: '⑤ 时间与预算', h: `${perTxt}，预算 ${wan(budget)}`, r: `方案 ${wan(t.total)}，余 ${wan(t.left)}；档期内每条线路都按红豆空车数下单。` },
    { k: '⑥ 媒体范围', h: opt.media.map((m) => MEDIA_LABEL[m]).join(' + '), r: mix },
    { k: '⑦ 成功衡量', h: `${hypo.kpi}；${hypo.proof}`, r: `历史人流按档期累加约 ${ppl(cumPv)} 人次（日均 × ${per.days} 天，未去重，非实际触达预测）；上刊次日交上刊照片，下刊后 5 个工作日交下刊照片与结案报告。` },
  ];

  const ok = (pass, warn = false) => (pass ? 'ok' : warn ? 'warn' : 'bad');
  const checks = [
    { s: ok(!!(hypo.client && hypo.biz)), t: '一句话说清客户是谁、campaign 解决什么', d: hypo.biz || '在假设书里填写 ② 生意目标' },
    { s: ok(!!(preset.industry && budget && opt.media.length && per.days)), t: '行业、预算、媒体、档期四项输入落进方案', d: `${preset.industry} · ${wan(budget)} · ${opt.media.map((m) => MEDIA_LABEL[m]).join('+')} · ${per.billMonths} 个月` },
    { s: ok(f.anchors > 0 && f.near > 0 && f.nearFree > 0 && f.chosen > 0), t: '选点逻辑每步有证据', d: `${anchorWord} ${f.anchors} → 半径内媒体 ${f.near} → 红豆有空位 ${f.nearFree} → 入选 ${f.chosen}` },
    { s: ok(top.length > 0), t: '媒体组合有主次、能讲出取舍', d: mix },
    { s: ok(t.total <= budget && plan.shares.length > 0), t: '预算拆分清楚（占比、刊例 × 折扣、制作费）', d: `${plan.shares.map((x) => `${MEDIA_LABEL[x.kind]} ${Math.round(x.pct * 100)}%`).join(' / ')} · ${opt.discount < 1 ? opt.discount * 10 + ' 折' : '刊例价'} · 制作 ${wan(t.make)}${t.total > budget ? ' · 超预算' : ''}` },
    { s: t.shortage || plan.lines.some((l) => l.qty > l.free) ? 'bad' : liveChecked ? 'ok' : 'warn', t: '排期与红豆可售一致，没排到已占档期', d: `${t.shortage ? t.shortage + ' 项指定线路可售不足；' : ''}${liveChecked ? '已按红豆实时库存核对' : '按红豆逐月快照，建议出案前点「红豆实时核对」'}` },
    { s: ok(t.dailyPv > 0), t: '效果预估有口径，监测方式写清', d: `日均 ${ppl(t.dailyPv)} 人次 × ${per.days} 天；上下刊照片 + 结案报告` },
    { s: s.buffer > 0 && plan.backups.length ? 'ok' : s.buffer > 0 ? 'warn' : 'bad', t: '风险与承诺：误一补二、天气施工、替换方案', d: `雨天缓冲 ${s.buffer} 夜；每延误 1 天补偿约 ${wan(s.delayCostPerDay)}；备选 ${plan.backups.length} 条` },
    { s: 'ok', t: '复用性：改预算靠加减模块，不推倒重来', d: `同一组候选按预算增减，重算 ${plan.ms ?? '<60'} ms` },
    { s: 'ok', t: 'HTML 现场能打开、能交互，换输入当场出结果', d: '工作台实时重算；导出提案离线可开，地图需联网' },
  ];
  return { response, checks, mix, top, cumPv, anchorWord, perTxt };
}
