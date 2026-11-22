// 把稀疏的公交轨迹吸附到真实道路：OSRM 路径规划（OpenStreetMap 路网），逐段沿路连接相邻轨迹点。
// 坐标链：平台 BD-09 → GCJ-02 → WGS-84 送去匹配，结果 WGS-84 → GCJ-02 → BD-09 存回，前端统一按 BD-09 处理。
//   node tools/snap_roads.mjs [线路名...]   不带参数则处理全部，结果写 web/data/paths-road.json（断点续传）
import fs from 'node:fs';
const OSRM = process.env.OSRM_URL || 'https://router.project-osrm.org';
const PI = Math.PI, A = 6378245, EE = 0.00669342162296594323, XP = PI * 3000 / 180;
const bd2gcj = ([lng, lat]) => { const x = lng - 0.0065, y = lat - 0.006, z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * XP), t = Math.atan2(y, x) - 0.000003 * Math.cos(x * XP); return [z * Math.cos(t), z * Math.sin(t)]; };
const gcj2bd = ([lng, lat]) => { const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * XP), t = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * XP); return [z * Math.cos(t) + 0.0065, z * Math.sin(t) + 0.006]; };
const tlat = (x, y) => { let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x)); r += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3; r += (20 * Math.sin(y * PI) + 40 * Math.sin(y / 3 * PI)) * 2 / 3; r += (160 * Math.sin(y / 12 * PI) + 320 * Math.sin(y * PI / 30)) * 2 / 3; return r; };
const tlng = (x, y) => { let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x)); r += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3; r += (20 * Math.sin(x * PI) + 40 * Math.sin(x / 3 * PI)) * 2 / 3; r += (150 * Math.sin(x / 12 * PI) + 300 * Math.sin(x / 30 * PI)) * 2 / 3; return r; };
const delta = ([lng, lat]) => { let dl = tlat(lng - 105, lat - 35), dn = tlng(lng - 105, lat - 35); const r = lat / 180 * PI; let m = Math.sin(r); m = 1 - EE * m * m; const s = Math.sqrt(m); dl = dl * 180 / ((A * (1 - EE)) / (m * s) * PI); dn = dn * 180 / (A / s * Math.cos(r) * PI); return [dn, dl]; };
const wgs2gcj = (p) => { const [a, b] = delta(p); return [p[0] + a, p[1] + b]; };
const gcj2wgs = (p) => { const [a, b] = delta(p); return [p[0] - a, p[1] - b]; };
const toWgs = (p) => gcj2wgs(bd2gcj(p)), toBd = (p) => gcj2bd(wgs2gcj(p));

const k = Math.cos(31.2 * PI / 180) * 111320;
const dist = (a, b) => Math.hypot((a[0] - b[0]) * k, (a[1] - b[1]) * 111320);
// 特别稀疏的段先线性插点（≤700 米一个），避免匹配器把长空档当成断线
function densify(path) { const out = [path[0]]; for (let i = 1; i < path.length; i++) { const n = Math.ceil(dist(path[i - 1], path[i]) / 700); for (let j = 1; j <= n; j++) out.push([path[i - 1][0] + (path[i][0] - path[i - 1][0]) * j / n, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * j / n]); } return out; }
const segDist = (p, path) => { let b = Infinity; for (let i = 0; i < path.length - 1; i++) { const [ax, ay] = [path[i][0] * k, path[i][1] * 111320], [bx, by] = [path[i + 1][0] * k, path[i + 1][1] * 111320], [px, py] = [p[0] * k, p[1] * 111320], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0; b = Math.min(b, Math.hypot(px - ax - t * dx, py - ay - t * dy)); } return b; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 逐段路径规划：相邻两个轨迹点之间沿道路走（OSRM /route，单次最多 100 个途经点）。
// 某一段沿路距离 > 直线 1.5 倍 + 150 米，说明被单行道或掉头绕远了，这一段保留直线。
let fails = 0;
async function snap(path) {
  const pts = path.map(toWgs), out = [];
  for (let i = 0; i < pts.length - 1; i += 99) {
    const chunk = pts.slice(i, i + 100);
    const q = chunk.map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`).join(';');
    const url = `${OSRM}/route/v1/driving/${q}?overview=false&steps=true&geometries=geojson&continue_straight=true`;
    let j = null;
    for (let t = 0; t < 4 && !j; t++) { try { const r = await fetch(url); if (r.status === 429) { await sleep(3000); continue; } j = await r.json(); } catch { await sleep(1500); } }
    if (process.env.DEBUG) console.log('chunk', i, j?.code, j?.message);
    if (j?.code !== 'Ok') { out.push(...chunk); fails++; await sleep(1100); continue; }
    j.routes[0].legs.forEach((leg, li) => {
      const a = chunk[li], b = chunk[li + 1], straight = dist(a, b);
      if (leg.distance > straight * 1.5 + 150) { out.push(a, b); fails++; return; }
      for (const st of leg.steps) out.push(...st.geometry.coordinates);
    });
    await sleep(1100); // 公共服务限速 1 次/秒
  }
  return out.map(toBd).map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]);
}
const full = JSON.parse(fs.readFileSync('web/data/paths-full.json', 'utf8'));
const u = JSON.parse(fs.readFileSync('web/data/universe.json', 'utf8'));
const file = process.env.OUT || 'web/data/paths-road.json';
const done = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const only = process.argv.slice(2);
const todo = u.bus.filter((b) => full[b.rid] && !(b.rid in done) && (!only.length || only.includes(b.name))).sort((a, b) => (b.pv || 0) - (a.pv || 0)); // 人次高的线路更常入选，先处理
let n = 0;
for (const b of todo) {
  const orig = full[b.rid], s = await snap(orig);
  // 匹配结果比原始长太多说明绕路了（单行道、掉头），这种不用
  const len = (p) => p.slice(1).reduce((t, q, i) => t + dist(p[i], q), 0), r = len(s) / len(orig);
  done[b.rid] = r < 1.35 ? s : null;
  console.log(b.name, orig.length, '->', s.length, 'len ratio', r.toFixed(2), r < 1.35 ? 'ok' : 'skip', 'straight legs', fails); fails = 0;
  if (++n % 10 === 0) fs.writeFileSync(file, JSON.stringify(done));
}
fs.writeFileSync(file, JSON.stringify(done));
