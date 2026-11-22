// 把红豆库存主键 与 大数据平台的坐标/轨迹/日均人次 关联成一份"可售媒体宇宙"：web/data/universe.json
import fs from 'node:fs';
const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const labels = J('data/bd/labels.json'), flow = J('data/bd/flow.json'), extra = J('data/bd/extra_map.json'), paths = J('data/bd/paths.json');
const detail = (id) => { const f = `data/bd/detail/${id}.json`; return fs.existsSync(f) ? J(f) : null; };
const inv = J('data/snapshot/inv-2027-05.json');
const LV = { 1: 'S', 2: 'A++', 3: 'A+', 5: 'AA', 6: '其他' };
const r = (x, n = 5) => +(+x).toFixed(n);

// ---------- 公交 ----------
const busLabel = new Map();
for (const l of labels) if (l.first === '公交' && l.level !== '其他' && l.level !== '补') busLabel.set(l.name, l.id);
const bus = [], seen = new Set();
for (const b of inv.bus) {
  const key = b.resourceId; if (seen.has(key)) continue; seen.add(key);
  const id = busLabel.get(b.lineName) ?? extra[b.lineName];
  const d = id ? detail(id) : null, f = id ? flow[id] : null;
  const path = d?.lines?.[0]?.path ?? paths[b.lineName]?.path ?? null;
  bus.push({
    rid: b.resourceId, name: b.lineName, company: b.companyName, level: LV[b.lineLevel] ?? b.lineLevel, form: b.mediaName,
    labelId: id ?? null, title: d?.lines?.[0]?.title ?? paths[b.lineName]?.title ?? null,
    pv: f?.pv || null, uv: f?.uv || null,
    path: path ? path.map(([x, y]) => [r(x), r(y)]) : null,
    stops: d ? d.points.filter((p) => p.loc).map((p) => { const [x, y] = p.loc.split(' '); return [r(x), r(y), Math.round(p.crowd)]; }) : null,
    district: d?.area?.[0]?.district?.replace(/，$/, '') ?? null,
  });
}

// ---------- 地铁出入口 ----------
const norm = (s) => String(s || '').replace(/[(（]原[^)）]*[)）]/g, '').replace(/[\s()（）·・.]/g, '').replace(/站$/, '');
const metroLabel = new Map();
for (const l of labels) if (l.first === '地铁出入口') {
  const m = l.name.match(/^(.+?)[（(](.*?)[）)](.+)$/);
  if (m) metroLabel.set(norm(m[1]) + '|' + norm(m[3]), l.id);
}
const metro = [];
for (const m of inv.metro) {
  let id = metroLabel.get(norm(m.lineName) + '|' + norm(m.exitName)), proxy = false;
  if (!id) { // 该出口在平台没有单独标签：借用同站其他出口的坐标和人次，标记为"同站参考"
    const st = norm(m.lineName) + '|';
    const k = [...metroLabel.keys()].find((k) => k.startsWith(st));
    if (k) { id = metroLabel.get(k); proxy = true; }
  }
  const d = id ? detail(id) : null, f = id ? flow[id] : null;
  const p = d?.points?.find((q) => q.loc);
  const [x, y] = p ? p.loc.split(' ') : [null, null];
  metro.push({
    rid: m.resourceId, no: m.metroNumber, station: m.lineName, exit: m.exitName, lines: m.stationAttr, level: LV[m.lineLevel] ?? m.lineLevel,
    biz: m.businessAreaName, tags: m.categoryTags, labelId: id ?? null, proxy,
    pv: f?.pv || null, uv: f?.uv || null, lng: x ? r(x) : null, lat: y ? r(y) : null,
  });
}
const stat = (a, k) => a.filter((x) => x[k] != null && x[k] !== 0).length;
console.log('bus', bus.length, 'withPath', stat(bus, 'path'), 'withPV', stat(bus, 'pv'));
console.log('metro', metro.length, 'withLoc', stat(metro, 'lng'), 'withPV', stat(metro, 'pv'));
fs.mkdirSync('web/data', { recursive: true });
fs.writeFileSync('web/data/universe.json', JSON.stringify({ builtAt: new Date().toISOString(), flowMonth: '2023-05', bus, metro }));
console.log('size KB', Math.round(fs.statSync('web/data/universe.json').size / 1024));
