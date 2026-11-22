// 取上海地铁各线走向作为方案地图底图：web/data/metro_lines.json
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import fs from 'node:fs';
const cookie = fs.readFileSync('data/.bd_cookie', 'utf8');
const names = [...Array.from({ length: 18 }, (_, i) => `地铁${i + 1}号线`), '浦江线', '磁悬浮'];
const COLOR = { 1: '#E4002B', 2: '#97D700', 3: '#FFD100', 4: '#5F259F', 5: '#AC4FC6', 6: '#D7006C', 7: '#FF6900', 8: '#009EDB', 9: '#71C5E8', 10: '#C1A7E2', 11: '#76232F', 12: '#007B5F', 13: '#EF95CF', 14: '#827A04', 15: '#BCA886', 16: '#2CD5C4', 17: '#BC796F', 18: '#C09C83' };
const out = [];
for (const n of names) {
  const r = await fetch('https://flairmedia.com.cn:38880/baseInfoLine/getLineJson?linePath=' + encodeURIComponent('D:\\SOP\\media-res\\JSON\\' + n), { headers: { cookie } });
  const j = await r.json().catch(() => null);
  if (j?.code !== 0 || !j.data) { console.log('miss', n); continue; }
  const d = JSON.parse(j.data), num = +(n.match(/(\d+)号线/)?.[1] ?? 0);
  // 文件里 lng/lat 字段互换
  out.push({ name: n, color: COLOR[num] ?? '#8a8f98', path: d.path.map((p) => [+p.lat.toFixed(5), +p.lng.toFixed(5)]) });
}
fs.writeFileSync('web/data/metro_lines.json', JSON.stringify(out));
console.log('lines', out.length);
