// 调用 OpenAI 兼容的生图接口生成易拉宝主视觉：node tools/gen_image.mjs <输出文件> <尺寸> [模型]
// 密钥与地址从 .env.local 读取（IMG_API_BASE / IMG_API_KEY），不写进代码
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => l.split(/=(.*)/s).slice(0, 2)));
const [, , out = 'banner/img/hero.png', size = '1024x1536', model = 'gpt-image-2-4k'] = process.argv;
const prompt = process.env.PROMPT || `Editorial isometric illustration of Shanghai at golden hour, viewed from above at a gentle angle.
A red city bus with a large blank colorful side advertisement panel drives along a tree-lined avenue; a second bus in the distance.
In the foreground, a metro station entrance with a big blank lightbox billboard; office workers and a parent with a child walking past.
Subtle glowing route lines in cinnabar red trace along the streets connecting small shop storefronts, like a media coverage map.
Oriental Pearl Tower and Lujiazui skyline softly in the far background haze.
Warm stone and paper palette (#f6f2ec, #e9e1d6) with cinnabar red (#c2372d) accents and muted slate blue (#1f5f8b), clean flat shading, fine detail, calm and premium.
Absolutely no text, no letters, no numbers, no logos anywhere. Leave the top 30% of the image as a calm, empty, light sky area.`;
const t0 = Date.now();
// 该接口偶发 TLS 断连，失败重试 3 次
let r;
for (let i = 0; i < 4 && !r; i++) {
  try {
    r = await fetch(env.IMG_API_BASE.replace(/\/$/, '') + '/v1/images/generations', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.IMG_API_KEY },
      body: JSON.stringify({ model, prompt, size, n: 1, response_format: 'b64_json' }), signal: AbortSignal.timeout(600000),
    });
  } catch (e) { console.log('retry', i + 1, e.cause?.code || e.cause?.message || e.message); await new Promise((s) => setTimeout(s, 3000)); }
}
if (!r) process.exit(1);
const txt = await r.text();
if (!r.ok) { console.log('HTTP', r.status, txt.slice(0, 500)); process.exit(1); }
const j = JSON.parse(txt), d = j.data?.[0];
if (d?.b64_json) fs.writeFileSync(out, Buffer.from(d.b64_json, 'base64'));
else if (d?.url) { // 结果图放在 CDN 上，连接慢，记下链接并重试下载
  fs.writeFileSync(out + '.url.txt', d.url); console.log('url', d.url);
  let ok = false;
  for (let i = 0; i < 6 && !ok; i++) { try { const b = await (await fetch(d.url, { signal: AbortSignal.timeout(120000) })).arrayBuffer(); fs.writeFileSync(out, Buffer.from(b)); ok = true; } catch (e) { console.log('download retry', i + 1, e.cause?.code || e.message); await new Promise((s) => setTimeout(s, 4000)); } }
  if (!ok) process.exit(1);
}
else { console.log('no image', txt.slice(0, 500)); process.exit(1); }
console.log('saved', out, Math.round((Date.now() - t0) / 1000) + 's', fs.statSync(out).size);
