// 规则版 brief 解析：从 4A 邮件 / 销售口述里抽出 行业、品牌、预算、档期、媒体、目标。
// 抽不到的字段留 null，由销售在界面上补，不猜。
const INDUSTRY = [
  ['bank', /银行|保险|理财|信用卡|金融/], ['food', /食品|饮料|咖啡|茶饮|饮用水|零食|乳/],
  ['health', /保健|滋补|营养|维生素|养生/], ['hospital', /医院|医疗|诊所|口腔|眼科|妇产|体检/],
  ['park', /乐园|主题公园|迪士尼|乐高|游乐/],
];
const num = (s) => +String(s).replace(/,/g, '');

export function parseBrief(text, year = 2027) {
  const t = String(text || '');
  const out = { industry: null, brand: null, budget: null, start: null, end: null, media: null, objective: null };
  for (const [k, re] of INDUSTRY) if (re.test(t)) { out.industry = k; break; }
  const brand = t.match(/(?:客户|品牌)[：:\s]*[「“"【《『\[]([^」”"】》』\]]{1,20})[」”"】》』\]]/) || t.match(/(?:客户|品牌)[：:]\s*([^\s，,。、]{2,20})/);
  if (brand && !/某/.test(brand[1])) out.brand = brand[1];
  const wan = t.match(/(?:预算|总价|费用|budget)[^0-9]{0,8}([\d,.]+)\s*(万|w|W)/) || t.match(/([\d,.]+)\s*万(?:元)?(?:预算|以内|左右)?/);
  if (wan) out.budget = Math.round(num(wan[1]) * 10000);
  // 日期：2027 年 5 月 1 日 – 5 月 10 日 / 5/1–5/10 / 2027-05-01 至 2027-05-31
  const ymd = [...t.matchAll(/(?:(20\d{2})\s*[年\-/.])?\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*日?/g)]
    .map((m) => ({ y: m[1] ? +m[1] : null, mo: +m[2], d: +m[3] })).filter((x) => x.mo >= 1 && x.mo <= 12 && x.d >= 1 && x.d <= 31);
  const iso = (x) => `${year}-${String(x.mo).padStart(2, '0')}-${String(x.d).padStart(2, '0')}`; // 赛题档期限定 2027 年
  if (ymd.length >= 2) { out.start = iso(ymd[0]); out.end = iso(ymd[1]); }
  else {
    const mon = t.match(/(\d{1,2})\s*月(?:份)?(?:投放|上刊|发布)?/);
    if (mon && +mon[1] >= 1 && +mon[1] <= 12) { const m = +mon[1]; out.start = iso({ mo: m, d: 1 }); out.end = iso({ mo: m, d: new Date(year, m, 0).getDate() }); }
  }
  const media = [];
  if (/公交|车身|巴士|大三侧/.test(t)) media.push('bus');
  if (/地铁|出入口|站口/.test(t)) media.push('metro');
  if (media.length) out.media = media;
  // 地铁 / 公交的预算倾向：明确百分比或几成优先，其次「地铁多、公交少」这类说法；范围同界面滑块 5%–95%
  const pct = t.match(/地铁(?:口|出入口)?[^0-9，,。]{0,6}(\d{1,2})\s*(%|％|成)/);
  const lean = /(?:以|侧重|偏重|主打|多投)地铁|地铁(?:口|出入口)?(?:为主|多|偏多|主投|重点)|公交(?:车身)?(?:为辅|少|偏少)/.test(t) ? 0.6
    : /(?:以|侧重|偏重|主打|多投)公交|公交(?:车身)?(?:为主|多|偏多|主投|重点)|地铁(?:口|出入口)?(?:为辅|少|偏少)/.test(t) ? 0.2 : null;
  // 服务半径：「地铁步行半径1000米」「公交途经 300 米」「半径1公里」；没写媒体的同时用于两者
  const rad = (re) => { const m = t.match(re); return m ? Math.round(+m[1] * (m[2] === '米' ? 1 : 1000)) : null; };
  const R = '[^0-9，,。]{0,8}?([\\d.]+)\\s*(米|公里|千米|km)';
  let busR = rad(new RegExp('公交' + R)), metroR = rad(new RegExp('地铁' + R));
  if (!busR && !metroR) busR = metroR = rad(new RegExp('(?:半径|范围)' + R));
  if (busR || metroR) out.radius = { bus: busR, metro: metroR };
  const busPct = t.match(/公交(?:车身)?[^0-9，,。]{0,6}(\d{1,2})\s*(%|％|成)/); // 只写公交占比时，地铁 = 1 − 公交
  const share = pct ? +pct[1] / (pct[2] === '成' ? 10 : 100) : busPct ? 1 - +busPct[1] / (busPct[2] === '成' ? 10 : 100) : lean;
  if (share != null) { out.metroShare = Math.min(0.95, Math.max(0.05, share)); out.media = ['bus', 'metro']; }
  if (/到店|引流|门店|网点|转化/.test(t)) out.objective = 'visit';
  else if (/曝光|声量|品牌形象|认知|新品/.test(t)) out.objective = 'reach';
  return out;
}
