// 生成可直接对客户演示的单文件 HTML 提案（内联样式、内联地图，离线可开）。
import { mountPlanMap, PLAN_MAP_CSS } from './leafmap.js';
import { assess, MEDIA_LABEL } from './review.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const yuan = (n) => Math.round(n).toLocaleString('zh-CN');
const wan = (n) => (n / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 1 });
const ppl = (n) => (n >= 1e8 ? (n / 1e8).toFixed(2) + ' 亿' : n >= 10000 ? (n / 10000).toFixed(1) + ' 万' : String(Math.round(n)));

export function buildReport({ preset, brand, plan, anchors, universe, inv, budget, coverCheck, mode = 'brand', addrs = [], radius = { bus: 500, metro: 800 }, leaflet, mapData, hypo, liveChecked = false }) {
  const t = plan.totals, s = plan.schedule, opt = plan.opt;
  const covered = new Set(plan.coveredStores);
  const data = mapData ?? {
    anchors: anchors.map((a, i) => ({ lng: a.lng, lat: a.lat, kind: a.kind, on: covered.has(i), name: a.name })),
    bus: plan.lines.filter((l) => l.kind === 'bus' && l.qty).map((l) => ({ key: l.key, name: l.name, qty: l.qty, path: (({ mapPath, path }) => mapPath ?? path)(universe.bus.find((b) => b.rid === l.rid) || {}) })),
    gates: plan.lines.filter((l) => l.kind === 'metro' && l.qty).map((l) => { const m = universe.metro.find((x) => x.rid === l.rid); return { key: l.key, name: l.name, lng: m?.lng, lat: m?.lat }; }),
    circles: mode === 'addr' ? addrs.map((a) => ({ ...a, r: Math.max(radius.bus, radius.metro) })) : [], fit: true,
  };
  const per = plan.period, perTxt = per.segments.length > 1 ? per.segments.map((s) => `${s.start} 至 ${s.end}`).join('、') + `（共 ${per.billMonths} 个月，分 ${per.segments.length} 段上画）` : `${per.start} 至 ${per.end}（${per.days} 天，按 ${per.billMonths} 个月计费）`;
  const forcedN = plan.lines.filter((l) => l.forced).length;
  const stores = anchors.filter((a) => a.kind === 'store');
  const mediaName = opt.media.map((m) => (m === 'bus' ? '公交车身' : '地铁出入口')).join(' + ');
  const discountTxt = opt.discount < 1 ? `${(opt.discount * 10).toFixed(1).replace(/\.0$/, '')} 折` : '刊例价';
  const invTxt = inv.source === 'live' ? `红豆系统实时查询（${new Date(inv.fetchedAt).toLocaleString('zh-CN')}，档期 ${inv.start} 至 ${inv.end}）` : `红豆系统 2027 年逐月库存快照（${inv.fetchedAt.slice(0, 10)} 导出，按所跨月份取最小空位）`;

  const rows = plan.lines.map((l, i) => `<tr data-key="${l.kind}:${l.rid}" data-kind="${l.kind}">
    <td>${i + 1}</td><td><b>${esc(l.name)}</b>${l.forced ? '<small style="color:#1f5f8b">客户指定</small>' : ''}${l.company ? `<small>${esc(l.company)}</small>` : ''}</td><td>${esc(l.level)}</td><td>${esc(l.form)}</td>
    <td class="n">${l.qty}</td><td class="n">${l.free}</td><td class="n">${ppl(l.pv)}${l.pvEstimated ? '<sup>估</sup>' : ''}</td>
    <td class="n">${l.nearStores}</td><td>${l.nearest ? `${esc(l.nearest.name)} <small>${l.nearest.d} 米</small>` : '—'}</td>
    <td class="n">${yuan(l.card)}</td><td class="n">${yuan(l.net)}</td><td class="n">${yuan(l.make)}</td><td class="n"><b>${yuan(l.net + l.make)}</b></td></tr>`).join('');

  const span = (a, b) => (new Date(b) - new Date(a)) / 86400000;
  const g0 = s.steps[0].from, g1 = s.steps.at(-1).to, total = span(g0, g1) + 1;
  const gantt = s.steps.map((st) => `<div class="g-row"><span>${esc(st.name)}</span><div class="g-track"><i class="g-${st.k}" style="left:${(span(g0, st.from) / total * 100).toFixed(2)}%;width:${Math.max(0.8, (span(st.from, st.to) + 1) / total * 100).toFixed(2)}%"></i></div><em>${st.from.slice(5)} – ${st.to.slice(5)}</em></div>`).join('');

  const R = assess({ preset, hypo: hypo ?? preset.hypo ?? {}, plan, budget, mode, liveChecked, brand }), f = plan.funnel;
  const checkRows = (coverCheck || []).slice(0, 12).map((c) => `<li>${esc(c.center)}：${esc(c.line)}（${c.type === 'bus' ? '公交' : '地铁'}，最近 ${c.d} 米${c.station ? '，' + esc(c.station) : ''}）</li>`).join('');

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(brand)} × 新云传媒 · ${esc(preset.campaign.split('」')[0].replace('「', ''))} 户外投放方案</title>
<style>
:root{--ink:#221c1a;--ink2:#5d544f;--line:rgba(34,28,26,.12);--paper:#faf8f5;--card:#fffdfa;--accent:#c2372d;--metro:#1f5f8b}
*{box-sizing:border-box}html,body{margin:0;overflow-x:clip}
body{font:15px/1.65 "PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:var(--ink);background:var(--paper)}
.wrap{max-width:1120px;margin:0 auto;padding:0 28px}
header.cover{padding:72px 0 40px;border-bottom:1px solid var(--line)}
.cover .who{font-size:13px;color:var(--ink2);letter-spacing:.02em}
.cover h1{font-size:clamp(30px,4.4vw,52px);line-height:1.12;margin:14px 0 18px;letter-spacing:-.02em;overflow-wrap:anywhere}
.cover p{font-size:18px;color:var(--ink2);max-width:760px;margin:0}
.facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line);margin:36px 0 0}
.facts div{background:var(--card);padding:16px 18px}.facts b{display:block;font-size:24px;font-variant-numeric:tabular-nums}.facts span{font-size:13px;color:var(--ink2)}
section{padding:52px 0;border-bottom:1px solid var(--line)}
h2{font-size:24px;margin:0 0 18px;letter-spacing:-.01em}
.cols{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:40px}
ol.insight{margin:0;padding-left:20px}ol.insight li{margin:0 0 10px}
.note{font-size:13px;color:var(--ink2)}
.mapbox{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#f4f1ec}
.legend{display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:var(--ink2);margin:10px 0 0}
.legend i{display:inline-block;width:14px;height:4px;vertical-align:middle;margin-right:6px;background:var(--accent)}
.legend i.g{width:10px;height:10px;border:2px solid var(--metro);background:none}.legend i.s{width:8px;height:8px;border-radius:50%;background:var(--ink)}
.filters{display:flex;gap:8px;margin:0 0 12px}.filters button{font:inherit;font-size:13px;border:1px solid var(--line);background:var(--card);padding:6px 12px;border-radius:999px;cursor:pointer}
.filters button[aria-pressed=true]{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.tbl{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--card)}
table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}
th,td{padding:9px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th{font-weight:600;color:var(--ink2);background:#f6f2ed;position:sticky;top:0}
td small{display:block;color:var(--ink2);font-size:11px}td.n,th.n{text-align:right}tr:hover td{background:#f8efe9}tr.hide{display:none}tbody tr{cursor:pointer}tr.flash td{background:#f3d9cf}
sup{color:var(--accent);font-size:10px;margin-left:2px}
tfoot td{font-weight:600;background:#f6f2ed}
.quote{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:32px;align-items:start}
.sum{border:1px solid var(--line);border-radius:10px;background:var(--card);padding:18px 20px}
.sum div{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--line)}.sum div:last-child{border:0;font-size:18px;font-weight:700}
.chain{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;list-style:none;padding:0;margin:0 0 18px;border:1px solid var(--line);border-radius:10px;overflow:hidden}.chain li{padding:12px 16px;background:var(--card);border-right:1px solid var(--line)}.chain li:last-child{border:0;background:#f8ece7}.chain b{display:block;font-size:22px}.chain span{font-size:12.5px;color:var(--ink2)}table.hypo td{white-space:normal;vertical-align:top}table.hypo td:first-child{white-space:nowrap}
.g-row{display:grid;grid-template-columns:220px minmax(0,1fr) 120px;gap:12px;align-items:center;font-size:13px;margin:8px 0}
.g-track{position:relative;height:14px;background:#efe9e2;border-radius:4px}.g-track i{position:absolute;top:0;bottom:0;border-radius:4px;background:#9c8f85}
.g-track .g-install{background:var(--ink)}.g-track .g-live{background:var(--accent)}.g-row em{font-style:normal;color:var(--ink2)}
ul.promise{margin:0;padding-left:20px}ul.promise li{margin:0 0 8px}
footer{padding:36px 0 60px;font-size:12px;color:var(--ink2)}
@media (max-width:760px){.chain{grid-template-columns:repeat(2,minmax(0,1fr))}.facts{grid-template-columns:repeat(2,minmax(0,1fr))}.cols,.quote{grid-template-columns:minmax(0,1fr)}.g-row{grid-template-columns:minmax(0,1fr)}}
${PLAN_MAP_CSS}${leaflet?.css ?? ''}
</style></head><body>
<header class="cover"><div class="wrap">
  <div class="who">上海新云传媒 · ${esc(preset.industry)} · 提案编号 XY-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}</div>
  <h1>${esc(brand)}<br>${esc(preset.campaign.split('：')[0])}</h1>
  <p>${esc(preset.campaign.split('：').slice(1).join('：') || preset.campaign)}</p>
  <div class="facts">
    <div><b>${wan(t.total)} 万</b><span>方案总价（预算 ${wan(budget)} 万）</span></div>
    <div><b>${t.vehicles ? t.vehicles + ' 辆' : ''}${t.vehicles && t.gates ? ' + ' : ''}${t.gates ? t.gates + ' 口' : ''}</b><span>${esc(mediaName)}</span></div>
    <div><b>${ppl(t.dailyPv)}</b><span>入选媒体历史日均人流合计（2023-05，未去重）</span></div>
    <div><b>${t.storesCovered} / ${t.storesTotal}</b><span>${preset.storeIsTarget === false ? '目标人群锚点被覆盖' : '门店被线路或地铁口覆盖'}</span></div>
  </div>
</div></header>

<section><div class="wrap cols">
  <div><h2>我们对 ${esc(brand)} 的理解</h2><ol class="insight">${preset.insight.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
  <p class="note">活动主题为新云提案团队的投放建议，非品牌已发布计划。${preset.sources.length ? '来源：' + preset.sources.map((x) => `<a href="${esc(x.u)}">${esc(x.t)}</a>`).join('；') : ''}</p></div>
  <div><h2>选媒逻辑</h2>
  <p>${esc(preset.kpi)}。档期 ${perTxt}。${forcedN ? `其中 ${forcedN} 项为客户指定线路/点位，优先排入。` : ''}</p>
  <p>${mode === 'addr' ? `按客户提供的 ${addrs.length} 个地址圈选（平台地理编码），公交 ${radius.bus} 米内途经、地铁口直线距离 ${radius.metro} 米内；` : `门店清单来自新云大数据平台 POI 检索，共 ${stores.length} 处；`}线路走向、地铁口坐标和日均人次来自平台「媒体查询」2023 年 5 月数据；可售数量来自${esc(invTxt)}。</p>
  <p>${opt.objective === 'visit' ? '目标是到店：只选途经门店或目标人群的媒体，再按「人次 × 门店相关度」排序，优先覆盖还没被覆盖的门店。' : '目标是曝光：按日均覆盖人次排序，同时兼顾门店密集区。'}同一线路加车按频次递减计价值，单线最多 ${opt.maxPerLine} 辆，保证分散覆盖。</p></div>
</div></section>

<section><div class="wrap">
  <h2>campaign 假设书与方案回应</h2>
  <p class="note">需求由新云提案团队按公开信息拟定，七要素逐条对应方案里的做法。</p>
  <div class="tbl"><table class="hypo"><thead><tr><th>要素</th><th>假设</th><th>方案如何回应</th></tr></thead><tbody>
  ${R.response.map((x) => `<tr><td><b>${esc(x.k)}</b></td><td>${esc(x.h)}</td><td>${esc(x.r)}</td></tr>`).join('')}
  </tbody></table></div>
</div></section>
<section><div class="wrap">
  <h2>门店圈选与媒体覆盖</h2>
  <ol class="chain">
    <li><b>${f.anchors}</b><span>${esc(R.anchorWord)}（大数据平台 POI / 地理编码）</span></li>
    <li><b>${f.near}</b><span>半径内自营媒体（公交 ${opt.busRadius} 米途经 / 地铁口 ${opt.metroRadius} 米，均为直线距离）</span></li>
    <li><b>${f.nearFree}</b><span>档期内红豆有空车 / 空位</span></li>
    <li><b>${f.chosen}</b><span>预算内入选（人次 × 相关度择优）</span></li>
  </ol>
  <p><b>为什么是这几条：</b>${R.top.map(esc).join('；')}。<br><b>组合主次：</b>${esc(R.mix)}</p>  <div class="mapbox" id="pmap" style="height:620px"></div>
  <div class="legend"><span><i></i>彩色线为选中公交线路（每条一色，越粗车越多，终点标线路名）</span><span><i class="g"></i>选中地铁出入口</span><span><i class="s"></i>${mode === 'addr' ? '客户地址' : '已覆盖门店'}</span><span>底图 © 高德地图（需联网加载，右上角可切换灰白 / 彩色）</span></div>
  ${checkRows ? `<p class="note" style="margin-top:16px">平台「媒体覆盖分析」在线复核（半径 500 米）：</p><ul class="note">${checkRows}</ul>` : ''}
</div></section>

<section><div class="wrap">
  <h2>线路 / 点位清单</h2>
  <div class="filters" role="group" aria-label="按媒体筛选"><button aria-pressed="true" data-f="all">全部 ${plan.lines.length}</button>${t.vehicles ? `<button aria-pressed="false" data-f="bus">公交 ${plan.lines.filter((l) => l.kind === 'bus').length} 条线</button>` : ''}${t.gates ? `<button aria-pressed="false" data-f="metro">地铁口 ${t.gates}</button>` : ''}</div>
  <div class="tbl"><table><thead><tr><th>#</th><th>线路 / 点位</th><th>等级</th><th>形式</th><th class="n">数量</th><th class="n">可售</th><th class="n">日均人次</th><th class="n">近邻门店</th><th>最近门店</th><th class="n">刊例单价/月</th><th class="n">发布费</th><th class="n">制作费</th><th class="n">小计</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td colspan="4">合计</td><td class="n">${t.vehicles + t.gates}</td><td></td><td class="n">${ppl(t.dailyPv)}</td><td colspan="3"></td><td class="n">${yuan(t.net)}</td><td class="n">${yuan(t.make)}</td><td class="n">${yuan(t.total)}</td></tr></tfoot></table></div>
  <p class="note">「可售」为该档期内红豆系统空位数，已扣除合同、预定、保养和续约保护。「估」表示平台无该线人流数据，按同类中位数六折估算。</p>
</div></section>

<section><div class="wrap">
  <h2>排期与上刊计划</h2>
  ${gantt}
  <p class="note">倒排依据：设计→定稿→审批→制作→夜间安装（资料包《上下刊流程卡点》）。公交单晚施工按 ${opt.busPerNight} 台、地铁口按 ${opt.metroPerNight} 个估算，每 ${opt.rainBufferEvery} 个施工夜留 1 夜雨天缓冲。<b>客户最晚定稿日：${s.finalArtDeadline}</b>。</p>
</div></section>

<section><div class="wrap cols">
  <div><h2>效果预估与监测</h2>
  <p>档期 ${esc(R.perTxt)}，共 ${per.days} 天。入选媒体历史日均人流合计 <b>${ppl(t.dailyPv)}</b>（公交线路沿线 ${ppl(t.busPv)}，地铁出入口周边 ${ppl(t.metroPv)}），按档期天数累加约 <b>${ppl(R.cumPv)}</b> 人次。</p>
  <p class="note">口径：取新云大数据平台「媒体查询」2023 年 5 月数据。公交是该线路沿线的日均人流，按线路计一次，与投放车辆数无关；同线多买车提高的是沿线人群看到广告的频次，不增加这个数。地铁口是出入口周边的日均人流。各媒体直接相加、乘以天数，未去重，这是历史人流，不是 2027 年广告实际被看到的人次预测，只用于量级判断和媒体间比较。到店、预约、扫码等转化以客户侧数据为准（${esc(R.response[6].h)}）。</p>
  <ul class="promise"><li>上刊：最后一辆车 / 点位施工完成次日，提供带报头日期的上刊照片和上刊报告。</li><li>在刊：抽查车辆运营与画面完好，碰擦、调度按「损一补一」补足。</li><li>下刊：下刊后 5 个工作日内交下刊照片，并出具结案报告（分期人流、覆盖${esc(R.anchorWord)}清单）。</li></ul></div>
  <div><h2>风险与替换方案</h2>
  <ul class="promise">
    <li>夜间施工、雨天停工：已按单晚 ${opt.busPerNight} 台车 / ${opt.metroPerNight} 个地铁口排产，另留 ${s.buffer} 夜缓冲；客户最晚 ${s.finalArtDeadline} 定稿。</li>
    <li>误一补二：每延误 1 天对应补偿约 ${yuan(s.delayCostPerDay)} 元发布价值，所以排期不压到最后一晚。</li>
    <li>换车改档、临时缺位：按下表备选顺位替换，同步更新制作单与施工计划。</li>
  </ul>
  ${plan.backups.length ? `<div class="tbl"><table><thead><tr><th>备选顺位</th><th>线路 / 点位</th><th>等级</th><th class="n">可售</th><th class="n">近邻${esc(R.anchorWord)}</th></tr></thead><tbody>${plan.backups.map((b, i) => `<tr><td>${i + 1}</td><td>${esc(b.name)}</td><td>${b.level}</td><td class="n">${b.free}</td><td class="n">${b.nearStores}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>
</div></section>
<section><div class="wrap quote">
  <div><h2>报价</h2>
  <p>报价按资料包刊例口径：公交 S / A++ / A+ 分别 58,000 / 48,000 / 38,000 元·辆·月，制作费 5,000 元/辆；地铁出入口 A++ 30 万、A+ 20 万元·个·月，制作费 100 元/㎡。本方案执行${esc(discountTxt)}。</p>
  ${plan.lines.some((l) => l.note) ? `<p class="note">待核价项：${[...new Set(plan.lines.filter((l) => l.note).map((l) => l.note))].map(esc).join('；')}。</p>` : ''}
  <h2 style="margin-top:28px">执行承诺</h2>
  <ul class="promise">
    <li>发布期以最后一辆车（或最后一个点位）施工照当日起算，分批上刊按批次分别起算。</li>
    <li>上刊后次日提供带报头日期的上刊照片；下刊后 5 个工作日内提供下刊照片。</li>
    <li>车辆碰擦、调度导致画面不能正常发布的，按「损一补一」补足发布天数。</li>
    <li>因我方原因延误发布，按「误一补二」补偿；本方案每延误 1 天对应补偿约 ${yuan(s.delayCostPerDay)} 元的发布价值，所以排期已含 ${s.buffer} 夜缓冲。</li>
    <li>${esc(preset.compliance)}</li>
  </ul></div>
  <div class="sum">${plan.shares.map((x) => `<div><span>${MEDIA_LABEL[x.kind]} ${Math.round(x.pct * 100)}%</span><span>${yuan(x.total)}</span></div>`).join('')}<div><span>刊例发布费</span><span>${yuan(t.media)}</span></div><div><span>${opt.discount < 1 ? esc(discountTxt) + '后发布费' : '执行发布费（无折扣）'}</span><span>${yuan(t.net)}</span></div><div><span>制作安装费</span><span>${yuan(t.make)}</span></div><div><span>预算余量</span><span>${yuan(t.left)}</span></div><div><span>合计（含税前）</span><span>${yuan(t.total)}</span></div></div>
</div></section>

<footer><div class="wrap">数据来源：红豆广告媒体管理系统、新云大数据可视化平台（比赛专用账号，数据已脱敏）；价格为资料包区间化刊例口径。最终点位、数量与金额以双方签署的排期单为准。生成于 ${new Date().toLocaleString('zh-CN')}。</div></footer>
<script>
document.querySelectorAll('.filters button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.filters button').forEach(x=>x.setAttribute('aria-pressed',x===b));const f=b.dataset.f;document.querySelectorAll('tbody tr').forEach(r=>r.classList.toggle('hide',f!=='all'&&r.dataset.kind!==f));});
</script>
<script>${(leaflet?.js ?? '').replace(/<\/script/gi, '<\\/script')}</script>
<script>
const mountPlanMap = ${mountPlanMap.toString()};
const DATA = ${JSON.stringify(data).replace(/</g, '\\u003c')};
if (window.L) {
  const rows = [...document.querySelectorAll('tbody tr')];
  const api = mountPlanMap(L, document.getElementById('pmap'), DATA, { onPick: (k) => { const r = rows.find((x) => x.dataset.key === k); if (r) { r.scrollIntoView({ block: 'center', behavior: 'smooth' }); r.classList.add('flash'); setTimeout(() => r.classList.remove('flash'), 1600); } } });
  rows.forEach((r) => { r.onmouseenter = () => api.highlight(r.dataset.key); r.onmouseleave = () => api.highlight(null); r.onclick = () => { api.focus(r.dataset.key); document.getElementById('pmap').scrollIntoView({ block: 'center', behavior: 'smooth' }); }; });
}
</script></body></html>`;
}
