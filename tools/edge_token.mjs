// 从 Edge 本地 localStorage（leveldb 原始文件）里只取 flairmedia.com.cn:881 的 ACCESS_TOKEN / REFRESH_TOKEN
// 仅读取红豆系统这个源的两个键，不读其他站点数据。
import fs from 'node:fs';
import path from 'node:path';
const root = path.join(process.env.LOCALAPPDATA, 'Microsoft/Edge/User Data');
const profiles = fs.readdirSync(root).filter((d) => d === 'Default' || d.startsWith('Profile'));
const hits = [];
for (const p of profiles) {
  const dir = path.join(root, p, 'Local Storage/leveldb');
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((f) => /\.(log|ldb)$/.test(f))) {
    let buf; try { buf = fs.readFileSync(path.join(dir, f)); } catch { continue; }
    const s = buf.toString('latin1');
    const re = /_https:\/\/flairmedia\.com\.cn:881\x00\x01(ACCESS_TOKEN|REFRESH_TOKEN)[\s\S]{0,8}?(\{[^\x00]{0,400}?\})/g;
    let m; while ((m = re.exec(s))) hits.push({ profile: p, file: f, key: m[1], raw: m[2], mtime: fs.statSync(path.join(dir, f)).mtimeMs });
  }
}
// leveldb 日志里越靠后越新
const pick = (k) => hits.filter((h) => h.key === k).at(-1);
const a = pick('ACCESS_TOKEN'), r = pick('REFRESH_TOKEN');
console.log('hits', hits.length, hits.map((h) => `${h.profile}/${h.file}/${h.key}`).slice(0, 10));
const val = (h) => { let v; try { v = JSON.parse(h.raw); v = v.v ?? v.c ?? v; } catch { v = h?.raw; } return String(v).replace(/^"+|"+$/g, ''); };
if (a && r) {
  fs.writeFileSync('data/.hd_token.json', JSON.stringify({ accessToken: val(a), refreshToken: val(r) }, null, 2));
  console.log('saved token (len)', String(val(a)).length, String(val(r)).length);
}
