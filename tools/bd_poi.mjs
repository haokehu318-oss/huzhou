// 用大数据平台的 POI 检索（/nearby/detail，全上海）拉品牌门店，缓存到 web/data/poi/<关键词>.json
//   node tools/bd_poi.mjs 招商银行 瑞幸咖啡 ...
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import fs from 'node:fs';
const cookie = fs.readFileSync('data/.bd_cookie', 'utf8');
fs.mkdirSync('web/data/poi', { recursive: true });
// 百度区域检索单次最多约 100 条，按区拆开查再去重，才能拿到全量门店
const DIST = ['黄浦区', '徐汇区', '长宁区', '静安区', '普陀区', '虹口区', '杨浦区', '闵行区', '宝山区', '嘉定区', '浦东新区', '金山区', '松江区', '青浦区', '奉贤区', '崇明区'];
const ask = async (kw, region) => {
  const r = await fetch('https://flairmedia.com.cn:38880/nearby/detail', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ searchMode: 'region', keywords: [kw], region, maxPage: 10 }) });
  const j = await r.json(); if (j.code !== 0) throw new Error(j.msg); return j.data;
};
for (const kw of process.argv.slice(2)) {
  let raw = await ask(kw, '上海市');
  if (raw.length >= 80) for (const d of DIST) raw = raw.concat(await ask(kw, '上海市' + d).catch(() => []));
  const seen = new Set();
  // 品牌词要求名称含品牌字样，去掉"附近停车场"之类噪声；人群类关键词（商场、幼儿园…）不做此过滤
  const isBrand = !['幼儿园', '商场', '写字楼', '小学', '中学', '大学', '医院', '景点', '社区', '住宅区'].includes(kw);
  const rows = raw.filter((p) => (!isBrand || p.name.includes(kw.slice(0, 2))) && !seen.has(p.uid) && seen.add(p.uid))
    .map((p) => ({ name: p.name, address: p.address, area: p.area, lng: +p.lng.toFixed(6), lat: +p.lat.toFixed(6) }));
  fs.writeFileSync(`web/data/poi/${kw}.json`, JSON.stringify({ keyword: kw, fetchedAt: new Date().toISOString(), source: '新云大数据平台 /nearby/detail', rows }));
  console.log(kw, rows.length, rows.slice(0, 3).map((x) => x.name).join(' / '));
}
