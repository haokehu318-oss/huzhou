// 真实地图：Leaflet + 高德街道底图。工作台与导出提案共用同一个函数（提案里用 toString() 内联）。
// 平台数据（百度 POI、线路轨迹、地铁口）是百度 BD-09 坐标，高德底图是 GCJ-02，画之前先转换。
// data: { anchors:[{lng,lat,kind,on,name}], bus:[{key,name,qty,path}], gates:[{key,name,lng,lat}],
//         circles:[{lng,lat,r,name}], extra:{key,name,path?|lng,lat}, fit:boolean }
// opts: { onPick(key) }，返回 { highlight(key|null) }
export function mountPlanMap(L, el, data, opts = {}) {
  const PI = Math.PI * 3000 / 180;
  const g = (lng, lat) => { // BD-09 -> GCJ-02
    const x = lng - 0.0065, y = lat - 0.006;
    const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * PI), t = Math.atan2(y, x) - 0.000003 * Math.cos(x * PI);
    return [z * Math.sin(t), z * Math.cos(t)]; // Leaflet 用 [lat, lng]
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let st = el._plan;
  if (!st) {
    const map = L.map(el, { preferCanvas: true, zoomSnap: 0.5, scrollWheelZoom: true }).setView(g(121.475, 31.232), 11);
    // 同一套高德瓦片两种呈现：灰白（默认，让彩色线路更突出）与原色（对比用），右上角切换
    const tile = (cls) => L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', { subdomains: '1234', maxZoom: 18, attribution: '底图 © 高德地图', className: cls });
    const gray = tile('pm-gray').addTo(map), color = tile('');
    map.on('baselayerchange', (e) => { st.gray = e.layer === gray; });
    L.control.layers({ '灰白底图': gray, '彩色底图': color }, null, { position: 'topright', collapsed: false }).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    // 线路名称标签开关（右下角），线多时可隐藏
    const Toggle = L.Control.extend({ onAdd() { const b = L.DomUtil.create('button', 'pm-toggle'); b.type = 'button'; b.textContent = '隐藏媒体名称'; L.DomEvent.disableClickPropagation(b); b.onclick = () => { st.labels = !st.labels; b.textContent = st.labels ? '隐藏媒体名称' : '显示媒体名称'; el.classList.toggle('pm-nolabel', !st.labels); }; return b; } });
    new Toggle({ position: 'bottomright' }).addTo(map);
    st = el._plan = { map, layer: L.layerGroup().addTo(map), byKey: new Map(), fitted: false, hl: null, labels: true, gray: true };
    map.on('zoomend', () => st.restyle && st.restyle());
  }
  const { map, layer, byKey } = st;
  // 线宽跟缩放走：全市视图细、街道级粗，像真实地图上的道路一样；Leaflet 默认是固定像素宽，缩小时会糊成一片
  const zf = () => Math.max(0.45, Math.min(1.35, Math.pow(2, (map.getZoom() - 13) * 0.35)));
  layer.clearLayers(); byKey.clear();
  const bounds = [], focus = []; // focus：地址、已覆盖门店、地铁口；整条公交线太长，只在没有焦点时参与取景
  const pick = (key) => opts.onPick && opts.onPick(key);

  for (const c of data.circles || []) {
    const p = g(c.lng, c.lat);
    L.circle(p, { radius: c.r, color: '#1f5f8b', weight: 1, dashArray: '4 4', fillOpacity: 0.04 }).addTo(layer);
    const b = L.latLng(p).toBounds(c.r * 4); focus.push(b.getSouthWest(), b.getNorthEast()); // 取景留出半径两倍余量
    L.marker(p, { icon: L.divIcon({ className: 'pm-pin', html: '<i></i>', iconSize: [18, 18], iconAnchor: [9, 18] }) }).bindTooltip(esc(c.name)).addTo(layer);
  }
  for (const a of data.anchors || []) {
    if (a.kind === 'audience' && !a.on) continue; // 人群锚点只画被覆盖的，避免满屏噪点
    const p = g(a.lng, a.lat); if (a.on) focus.push(p);
    L.circleMarker(p, { radius: a.kind === 'store' ? (a.on ? 4.5 : 3) : 2.5, weight: a.on ? 1.5 : 0, color: '#fff', fillColor: a.kind === 'store' ? (a.on ? '#2b2523' : '#9a8f87') : '#8c7f74', fillOpacity: a.on ? 0.95 : 0.6 })
      .bindTooltip(esc(a.name)).addTo(layer);
  }
  const addBus = (b, style) => {
    const pts = b.path.map(([x, y]) => g(x, y)); pts.forEach((p) => bounds.push(p));
    const casing = L.polyline(pts, { color: '#fff', weight: (style.weight + 2) * zf(), opacity: 0.9, lineJoin: 'round' }).addTo(layer);
    const line = L.polyline(pts, { ...style, weight: style.weight * zf(), lineJoin: 'round', lineCap: 'round' }).bindTooltip(esc(b.name) + (b.qty ? ` · ${b.qty} 辆` : ''), { sticky: true }).on('click', () => pick(b.key)).on('mouseover', () => st.hover(b.key)).on('mouseout', () => st.hover(null)).addTo(layer);
    // 线路名标在终点，边框用线路颜色，和平台「AI 线路」的读法一致
    const lab = b.label === false ? null : L.marker(pts[pts.length - 1], { interactive: true, icon: L.divIcon({ className: 'pm-label', html: `<span style="border-color:${style.color};color:${style.color}">${esc(String(b.name).replace(/路$/, ''))}</span>`, iconSize: null, iconAnchor: [-4, 10] }) }).on('click', () => pick(b.key)).addTo(layer);
    const dot = L.circleMarker(pts[0], { radius: 3.5, weight: 0, fillColor: style.color, fillOpacity: 0.9 }).addTo(layer);
    byKey.set(b.key, { line, casing, base: style, lab, dot });
  };
  // 每条线一种颜色：高区分度色板循环，同一方案内颜色稳定
  const PAL = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#0aa5b8', '#d61eaf', '#7fa315', '#c47a00', '#1d3fa8', '#b8326e', '#2a8c5a', '#8a5a2b', '#ff5fa2', '#5a6fd6', '#d9a400', '#00897b', '#a83232', '#6a3fb5', '#3f8fd6'];
  (data.bus || []).forEach((b, i) => { if (b.path) addBus(b, { color: PAL[i % PAL.length], weight: 2 + Math.min(2.5, b.qty * 0.4), opacity: 0.9 }); });
  for (const m of data.gates || []) {
    if (m.lng == null) continue;
    const p = g(m.lng, m.lat); focus.push(p);
    const mk = L.marker(p, { icon: L.divIcon({ className: 'pm-gate', html: 'M', iconSize: [18, 18] }) }).bindTooltip(esc(m.name)).on('click', () => pick(m.key)).addTo(layer);
    byKey.set(m.key, { mk });
  }
  const x = data.extra;
  if (x) { // 详情里查看、但还不在方案里的线路/点位：虚线显示
    if (x.path) addBus(x, { color: '#1f5f8b', weight: 4, opacity: 0.9, dashArray: '8 6' });
    else if (x.lng != null) byKey.set(x.key, { mk: L.marker(g(x.lng, x.lat), { icon: L.divIcon({ className: 'pm-gate pm-extra', html: 'M', iconSize: [18, 18] }) }).bindTooltip(esc(x.name)).addTo(layer) });
  }
  const fb = focus.length ? focus : bounds;
  if ((data.fit || !st.fitted) && fb.length) { map.fitBounds(fb, { padding: [24, 24], maxZoom: 15 }); st.fitted = true; }

  const api = {
    highlight(key, dim = true) { // dim=false：只把这条标红，其他线路不变淡（悬停用）
      st.hl = key; const z = zf();
      for (const [k, o] of byKey) {
        const on = !key || !dim || k === key, hot = key && k === key;
        // 被指向的线路变成加粗红线（灰白、彩色底图都一样）
        if (o.line) { o.line.setStyle({ color: hot ? '#e60012' : o.base.color, opacity: on ? (hot ? 1 : o.base.opacity) : 0.15, weight: (hot ? o.base.weight + 2.5 : o.base.weight) * z }); o.casing.setStyle({ opacity: on ? 0.9 : 0.1, weight: ((hot ? o.base.weight + 2.5 : o.base.weight) + 2) * z }); if (hot) o.line.bringToFront(); }
        if (o.mk) o.mk.setOpacity(on ? 1 : 0.3);
        if (o.lab) o.lab.setOpacity(on ? 1 : 0.25);
      }
    },
    focus(key) { const o = byKey.get(key); if (!o) return; if (o.line) map.fitBounds(o.line.getBounds(), { padding: [30, 30], maxZoom: 15 }); else map.setView(o.mk.getLatLng(), 16); },
    invalidate() { map.invalidateSize(); },
    hover: (k) => st.hover(k),
    hover: (k) => st.hover(k),
  };
  st.restyle = () => api.highlight(st.hl);
  // 鼠标悬停只是临时标红，不淡化其他线路；移开后回到原状态（只看一条时仍是那一条）
  st.hover = (k) => { const keep = st.hl; api.highlight(k ?? keep, !k); st.hl = keep; };
  return api;
}

export const PLAN_MAP_CSS = `
.pm-gray{filter:grayscale(1) contrast(.62) brightness(1.22)}
.pm-label span{display:inline-block;padding:0 4px;background:#fff;border:1.5px solid;border-radius:2px;font:700 11px/16px system-ui,sans-serif;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.2);cursor:pointer}
.pm-nolabel .pm-label{display:none}
.pm-toggle{border:0;border-radius:4px;background:#7fc4e8;color:#fff;font:600 12px/1 system-ui,sans-serif;padding:8px 12px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.2)}
.leaflet-control-layers{font-size:12px}
.pm-gate{background:#fff;border:2.5px solid #1f5f8b;border-radius:4px;color:#1f5f8b;font:700 10px/13px system-ui,sans-serif;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.3)}
.pm-gate.pm-extra{border-style:dashed}
.pm-pin i{display:block;width:14px;height:14px;margin:0 auto;background:#1f5f8b;border:2px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 1px 3px rgba(0,0,0,.35)}
.leaflet-container{font:12px/1.4 "PingFang SC","Microsoft YaHei",system-ui,sans-serif;background:#eef0f2}
`;
