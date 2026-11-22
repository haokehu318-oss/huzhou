// 拉取大数据平台的标签清单（公交线路 / 地铁出入口），再逐个取 2023-05 人流与坐标
//   node tools/bd_labels.mjs list           -> data/bd/labels.json
//   node tools/bd_labels.mjs detail [limit] -> data/bd/detail/<id>.json（已存在则跳过，可断点续传）
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import fs from 'node:fs';
const base = 'https://flairmedia.com.cn:38880';
const cookie = fs.readFileSync('data/.bd_cookie', 'utf8');
const post = async (p, form) => {
  const r = await fetch(base + p, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  return r.json();
};
fs.mkdirSync('data/bd/detail', { recursive: true });
const [, , cmd, limit = '99999'] = process.argv;
if (cmd === 'list') {
  const out = [];
  for (const first of ['公交', '地铁出入口']) {
    const rows = await post('/label/queryThirdLabel', { firstLabel: first, secondLabel: '' });
    for (const x of rows) out.push({ id: x.id, first: x.firstLabel, level: x.secondLabel, name: x.thirdLabel, alias: x.ext1, type: x.type });
    console.log(first, rows.length);
  }
  fs.writeFileSync('data/bd/labels.json', JSON.stringify(out));
} else if (cmd === 'detail') {
  // 公交只取公司自营等级（S/A++/A+/AA），"其他"是非自营线路
  const labels = JSON.parse(fs.readFileSync('data/bd/labels.json', 'utf8'))
    .filter((l) => l.level !== '其他' && !fs.existsSync(`data/bd/detail/${l.id}.json`)).slice(0, +limit);
  let done = 0;
  const worker = async () => {
    while (labels.length) {
      const l = labels.shift();
      try {
        const j = await post('/label/queryLabelData', { labelId: l.id, dataMonth: '202305' });
        if (j.code !== '0000') { console.log('fail', l.id, j.code); continue; }
        const d = j.data;
        // 只保留方案要用的字段，去掉大段 POI 文本
        const slim = {
          id: d.id, first: d.firstLabel, level: d.secondLabel, name: d.thirdLabel, alias: d.ext1,
          points: (d.sopLabelPoints || []).map((p) => ({ loc: p.location, crowd: +p.crowdDensity || 0, crowd2: +p.crowdDensity2 || 0, grid500: p.grid500 })),
          // 线路轨迹抽稀到最多 120 个点，够画图
          lines: (d.sopLabelLines || []).map((s) => {
            const xs = (s.xs || '').split(','), ys = (s.ys || '').split(','), step = Math.max(1, Math.ceil(xs.length / 120));
            const path = [];
            xs.forEach((x, i) => { if (i % step === 0 || i === xs.length - 1) path.push([+x, +ys[i]]); });
            return { title: s.ext2, path };
          }),
          area: (d.sopExtendDatas || []).slice(0, 1).map((e) => ({ district: e.val2, ring: e.val4, biz: e.val6 })),
        };
        fs.writeFileSync(`data/bd/detail/${l.id}.json`, JSON.stringify(slim));
        if (++done % 50 === 0) console.log('done', done, 'left', labels.length);
      } catch (e) { console.log('err', l.id, e.message); }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  console.log('finished', done);
}
