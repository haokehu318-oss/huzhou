// 对没有人流标签的公交线路，从覆盖分析用的轨迹库（getLineJson）取线路走向，存 data/bd/paths.json
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import fs from 'node:fs';
const cookie = fs.readFileSync('data/.bd_cookie', 'utf8');
const inv = JSON.parse(fs.readFileSync('data/snapshot/inv-2027-05.json', 'utf8'));
const labels = JSON.parse(fs.readFileSync('data/bd/labels.json', 'utf8'));
const extra = JSON.parse(fs.readFileSync('data/bd/extra_map.json', 'utf8'));
const own = new Set(labels.filter((l) => l.first === '公交' && l.level !== '其他' && l.level !== '补').map((l) => l.name));
const todo = [...new Set(inv.bus.map((b) => b.lineName))].filter((n) => !own.has(n) && !extra[n]);
const out = {};
for (const n of todo) {
  const names = [n + '路', n, n.replace(/-.*$/, '') + '路'];
  for (const nm of names) {
    const r = await fetch('https://flairmedia.com.cn:38880/baseInfoLine/getLineJson?linePath=' + encodeURIComponent('D:\\SOP\\media-res\\JSON\\' + nm), { headers: { cookie } });
    const j = await r.json().catch(() => null);
    if (j?.code === 0 && j.data) {
      const d = JSON.parse(j.data), step = Math.max(1, Math.ceil(d.path.length / 120));
      // 轨迹文件里 lng/lat 字段是反的：lng 存的是纬度
      out[n] = { title: d.name, path: d.path.filter((_, i) => i % step === 0 || i === d.path.length - 1).map((p) => [p.lat, p.lng]) };
      break;
    }
  }
  if (!out[n]) console.log('no path', n);
}
fs.writeFileSync('data/bd/paths.json', JSON.stringify(out));
console.log('paths', Object.keys(out).length, '/', todo.length);
