// 把品牌门店 + 人群锚点 POI 变成组案用的加权锚点。
// getPoi(keyword) -> [{name,lng,lat,area}]
const AUDIENCE_MAX = 600; // 人群类 POI 动辄上千，抽样到 600 个足够刻画分布，也让覆盖计算保持在 1 秒内

export function anchorsFor(preset, getPoi) {
  const out = [];
  const stores = (getPoi(preset.poi) || []).filter((s) => !(preset.exclude && preset.exclude.test(s.name)));
  const storeIsTarget = preset.storeIsTarget !== false;
  for (const s of stores) out.push({ ...s, w: storeIsTarget ? 1 : 0, store: storeIsTarget, kind: 'store' });
  for (const a of preset.audience || []) {
    const rows = getPoi(a.poi) || [];
    const step = Math.max(1, Math.ceil(rows.length / AUDIENCE_MAX));
    rows.forEach((r, i) => { if (i % step === 0) out.push({ ...r, w: a.w, store: !storeIsTarget, kind: 'audience', label: a.label }); });
  }
  return out;
}
