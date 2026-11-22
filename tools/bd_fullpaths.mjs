// 地图显示用的全精度公交轨迹：取平台轨迹库（getLineJson）与人流标签轨迹（xs/ys）中点数多的一份，
// 道格拉斯-普克抽稀到 2 米误差（肉眼贴合道路，体积可控），写 web/data/paths-full.json {rid: [[lng,lat],...]}
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import fs from 'node:fs';
const cookie = fs.readFileSync('data/.bd_cookie', 'utf8');
const u = JSON.parse(fs.readFileSync('web/data/universe.json', 'utf8'));
const BD = 'https://flairmedia.com.cn:38880';
const k = Math.cos(31.2 * Math.PI / 180) * 111320, M = 111320;
function simplify(pts, tol) { // 米
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let best = 0, bi = -1;
    const ax = pts[a][0] * k, ay = pts[a][1] * M, bx = pts[b][0] * k, by = pts[b][1] * M, dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][0] * k, py = pts[i][1] * M;
      const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; st.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]).map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]);
}
async function lineJson(name) {
  for (const n of [name + '路', name, name.replace(/路$/, '')]) {
    const r = await fetch(BD + '/baseInfoLine/getLineJson?linePath=' + encodeURIComponent('D:\\SOP\\media-res\\JSON\\' + n), { headers: { cookie } });
    const j = await r.json().catch(() => null);
    if (j?.code === 0 && j.data) return JSON.parse(j.data).path.map((p) => [p.lat, p.lng]); // 字段互换
  }
  return null;
}
async function labelPath(id) {
  const r = await fetch(BD + '/label/queryLabelData', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: `labelId=${id}&dataMonth=202305` });
  const j = await r.json().catch(() => null); const s = j?.data?.sopLabelLines?.[0]; if (!s?.xs) return null;
  const xs = s.xs.split(','), ys = s.ys.split(','); return xs.map((x, i) => [+x, +ys[i]]);
}
const out = {}, todo = [...u.bus]; let n = 0;
const worker = async () => {
  while (todo.length) {
    const b = todo.shift();
    const [a, c] = await Promise.all([lineJson(b.name).catch(() => null), b.labelId ? labelPath(b.labelId).catch(() => null) : null]);
    const best = [a, c].filter(Boolean).sort((x, y) => y.length - x.length)[0];
    if (best) out[b.rid] = simplify(best, 2);
    if (++n % 50 === 0) console.log('done', n, 'raw pts', best?.length, '->', out[b.rid]?.length);
  }
};
await Promise.all([worker(), worker(), worker(), worker()]);
fs.writeFileSync('web/data/paths-full.json', JSON.stringify(out));
console.log('lines', Object.keys(out).length, 'KB', Math.round(fs.statSync('web/data/paths-full.json').size / 1024));
