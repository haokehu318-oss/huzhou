// 大数据平台登录：
//   node tools/bd_login.mjs captcha        -> 保存 data/captcha.jpg 和会话 cookie
//   node tools/bd_login.mjs login <验证码>  -> 登录，cookie 存 data/.bd_cookie
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import fs from 'node:fs';
const base = 'https://flairmedia.com.cn:38880';
const user = process.env.BD_USER, pass = process.env.BD_PASS;
fs.mkdirSync('data', { recursive: true });
const [, , cmd, code] = process.argv;
const pick = (res) => (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');

if (cmd === 'captcha') {
  const r = await fetch(base + '/captcha.jpg');
  fs.writeFileSync('data/.bd_cookie', pick(r));
  fs.writeFileSync('data/captcha.jpg', Buffer.from(await r.arrayBuffer()));
  console.log('cookie', fs.readFileSync('data/.bd_cookie', 'utf8'));
} else {
  const cookie = fs.readFileSync('data/.bd_cookie', 'utf8');
  const r = await fetch(base + '/doLogin', {
    method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ userCode: user, password: pass, captcha: code }),
  });
  const extra = pick(r);
  if (extra) fs.writeFileSync('data/.bd_cookie', cookie + '; ' + extra);
  console.log(r.status, await r.text());
}
