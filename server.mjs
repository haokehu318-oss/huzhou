// 本地服务：静态页面 + 两个比赛系统的代理（红豆库存、大数据平台 POI/覆盖分析）+ brief 解析。
// 零依赖，node server.mjs 即可。账号凭据只从环境变量或本地 data/ 目录读取，不写进代码。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { parseBrief } from './web/brief.js';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // 比赛系统证书不完整
const PORT = +(process.env.PORT || 5188), HOST = process.env.HOST || '127.0.0.1';
const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const WEB = path.join(ROOT, 'web'), DATA = path.join(ROOT, 'data');
const HD = 'https://flairmedia.com.cn:881/admin-api', BD = 'https://flairmedia.com.cn:38880';
fs.mkdirSync(DATA, { recursive: true });

// ---------- 凭据 ----------
const file = (n) => path.join(DATA, n);
const readJson = (n, d = null) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return d; } };
let bdCookie = (() => { try { return fs.readFileSync(file('.bd_cookie'), 'utf8').trim(); } catch { return ''; } })();
let hdToken = readJson('.hd_token.json');

async function hdGet(p, q) {
  const go = () => fetch(HD + p + '?' + new URLSearchParams(q), { headers: { 'tenant-id': '1', authorization: 'Bearer ' + (hdToken?.accessToken ?? '') } }).then((r) => r.json());
  let j = await go();
  if (j.code === 401 && hdToken?.refreshToken) { // access token 过期，用 refresh token 续期，不需要再过滑块验证码
    const r = await fetch(HD + '/system/auth/refresh-token?refreshToken=' + hdToken.refreshToken, { method: 'POST', headers: { 'tenant-id': '1' } }).then((r) => r.json());
    if (r.code === 0) { hdToken = r.data; fs.writeFileSync(file('.hd_token.json'), JSON.stringify(hdToken)); j = await go(); }
  }
  if (j.code !== 0) throw Object.assign(new Error('红豆：' + (j.msg || j.code)), { status: j.code === 401 ? 401 : 502 });
  return j.data;
}
async function hdAll(p, q) {
  const first = await hdGet(p, { ...q, pageNo: 1, pageSize: 100 });
  const pages = Math.min(50, Math.ceil(first.total / 100));
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => hdGet(p, { ...q, pageNo: i + 2, pageSize: 100 })));
  return [first, ...rest].flatMap((d) => d.list);
}
async function bdPost(p, body, json = true) {
  const r = await fetch(BD + p, { method: 'POST', headers: { cookie: bdCookie, 'content-type': json ? 'application/json' : 'application/x-www-form-urlencoded' }, body: json ? JSON.stringify(body) : new URLSearchParams(body) });
  const t = await r.text();
  if (t.trimStart().startsWith('<')) throw Object.assign(new Error('大数据平台未登录或会话过期'), { status: 401 });
  return JSON.parse(t);
}

// ---------- 业务接口 ----------
const invCache = new Map();
async function inventory(start, end) {
  const key = start + '~' + end, hit = invCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;
  const q = { startDate: start, endDate: end };
  const [bus, metro] = await Promise.all([hdAll('/orders/media-inventory/bus/page', q), hdAll('/orders/media-inventory/metro/page', q)]);
  const pick = (rows) => Object.fromEntries(rows.map((x) => [x.resourceId, { free: x.freeCount, contract: x.contractCount, reserve: x.reservationCount, maint: x.maintenanceForbiddenCount, renew: (x.renewPossibleCount || 0) + (x.protectCount || 0), total: x.totalCount }]));
  const data = { source: 'live', fetchedAt: new Date().toISOString(), start, end, bus: pick(bus), metro: pick(metro) };
  invCache.set(key, { at: Date.now(), data });
  return data;
}

const DIST = ['黄浦区', '徐汇区', '长宁区', '静安区', '普陀区', '虹口区', '杨浦区', '闵行区', '宝山区', '嘉定区', '浦东新区', '金山区', '松江区', '青浦区', '奉贤区', '崇明区'];
async function poiLive(kw) {
  const ask = async (region) => { const j = await bdPost('/nearby/detail', { searchMode: 'region', keywords: [kw], region, maxPage: 10 }); if (j.code !== 0) throw new Error(j.msg); return j.data; };
  let raw = await ask('上海市');
  if (raw.length >= 80) for (const d of DIST) raw = raw.concat(await ask('上海市' + d).catch(() => []));
  const seen = new Set();
  const rows = raw.filter((p) => !seen.has(p.uid) && seen.add(p.uid)).map((p) => ({ name: p.name, address: p.address, area: p.area, lng: +(+p.lng).toFixed(6), lat: +(+p.lat).toFixed(6) }));
  const data = { keyword: kw, fetchedAt: new Date().toISOString(), source: '新云大数据平台 /nearby/detail', rows };
  fs.writeFileSync(path.join(WEB, 'data/poi', safeName(kw) + '.json'), JSON.stringify(data));
  return data;
}
const safeName = (s) => String(s).replace(/[\\/:*?"<>|.\s]/g, '').slice(0, 40);

async function llmBrief(text) {
  // 可选：配置任一 OpenAI 兼容接口后，用大模型补全规则解析不出的字段
  const { LLM_BASE_URL: base, LLM_API_KEY: key, LLM_MODEL: model } = process.env;
  if (!base || !key || !model) return null;
  const r = await fetch(base.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({ model, temperature: 0, response_format: { type: 'json_object' }, messages: [
      { role: 'system', content: '从户外广告投放 brief 中抽取 JSON：{"brand":品牌名,"industry":"bank|food|health|hospital|park","budget":元,"start":"YYYY-MM-DD","end":"YYYY-MM-DD","media":["bus"|"metro"],"objective":"visit|reach","campaign":一句话活动主题}。缺失字段填 null，不要编造。' },
      { role: 'user', content: text.slice(0, 4000) }] }),
  });
  const j = await r.json(); return JSON.parse(j.choices?.[0]?.message?.content || '{}');
}

// ---------- HTTP ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const send = (res, code, data, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(type.startsWith('application/json') ? JSON.stringify(data) : data); };
const readBody = async (req) => { let s = ''; for await (const c of req) { s += c; if (s.length > 20000) throw Object.assign(new Error('请求过大'), { status: 413 }); } return s ? JSON.parse(s) : {}; };
const DATE = /^2027-\d{2}-\d{2}$/;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) {
      // 修改类接口只接受同源请求，防止别的网页借本机服务操作比赛账号
      if (req.method === 'POST' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(res, 403, { error: '仅限本工作台调用' });
      switch (url.pathname) {
        case '/api/status': {
          const out = { hd: false, bd: false };
          try { await hdGet('/system/auth/get-permission-info', {}); out.hd = true; } catch {}
          try { const r = await fetch(BD + '/user/getCurrentUser', { method: 'POST', headers: { cookie: bdCookie } }); out.bd = (await r.text()).trimStart().startsWith('{'); } catch {}
          return send(res, 200, out);
        }
        case '/api/inventory': {
          const start = url.searchParams.get('start'), end = url.searchParams.get('end');
          if (!DATE.test(start) || !DATE.test(end) || start > end) return send(res, 400, { error: '档期须在 2027 年内，且开始不晚于结束' });
          return send(res, 200, await inventory(start, end));
        }
        case '/api/poi': {
          const kw = (url.searchParams.get('kw') || '').trim();
          if (!kw || kw.length > 20) return send(res, 400, { error: '请输入品牌或门店关键词' });
          return send(res, 200, await poiLive(kw));
        }
        case '/api/usage': { // 单个资源在某档期的库存拆解 + 合同/预定占用明细（红豆「点击数字查看占用明细」同一接口）
          const kind = url.searchParams.get('kind'), rid = +url.searchParams.get('rid'), start = url.searchParams.get('start'), end = url.searchParams.get('end');
          if (!['bus', 'metro'].includes(kind) || !Number.isInteger(rid) || !DATE.test(start) || !DATE.test(end) || start > end) return send(res, 400, { error: '参数有误' });
          const inv = await inventory(start, end), r = inv[kind][rid];
          if (!r) return send(res, 404, { error: '红豆里没有这个资源' });
          const q = { mediaType: kind.toUpperCase(), resourceId: rid, startDate: start, endDate: end };
          const [occupy, hold] = await Promise.all(['OCCUPY', 'HOLD'].map((phase) => hdGet('/orders/media-inventory/media-usage', { ...q, phase }).catch(() => [])));
          const slim = (u) => ({ phase: u.phase, orderNo: u.orderNo, adContent: u.adContent, extraInfo: u.extraInfo, startTime: u.startTime, endTime: u.endTime, canReservationTime: u.canReservationTime });
          return send(res, 200, { start, end, fetchedAt: inv.fetchedAt, row: { ...r, renew: r.renew ?? 0 }, occupy: (occupy || []).map(slim), hold: (hold || []).map(slim) });
        }
        case '/api/geocode': { // 客户地址 → 坐标：平台地理编码，可信度低时按平台前端的做法用 POI 检索兜底
          const q = (url.searchParams.get('q') || '').trim();
          if (!q || q.length > 60) return send(res, 400, { error: '请输入地址' });
          const j = await bdPost('/nearby/geocode', { address: q, city: '上海市' });
          const d = j.data;
          if (j.code === 0 && d && !(d.confidence > 0 && d.confidence < 50)) return send(res, 200, { name: q, lng: +d.lng, lat: +d.lat, by: '平台地理编码', level: d.level });
          const p = await bdPost('/nearby/detail', { searchMode: 'region', keywords: [q], region: '上海市', maxPage: 1 });
          const hit = p.data?.[0];
          if (hit) return send(res, 200, { name: q, lng: +hit.lng, lat: +hit.lat, by: '平台 POI 检索', level: hit.name });
          if (j.code === 0 && d) return send(res, 200, { name: q, lng: +d.lng, lat: +d.lat, by: '平台地理编码（低可信度）', level: d.level });
          return send(res, 404, { error: '没有找到这个地址' });
        }
        case '/api/cover-check': { // 平台"媒体覆盖分析"原接口，给提案里的门店做一次在线复核
          const b = await readBody(req);
          const centers = (b.centers || []).slice(0, 20).map((c) => ({ name: String(c.name).slice(0, 60), address: String(c.name).slice(0, 60), lng: +c.lng, lat: +c.lat }));
          const j = await bdPost('/baseInfoLine/matchCoverLines', { radius: Math.min(2000, +b.radius || 500), mediaTypes: b.mediaTypes || ['bus', 'metro'], lineScope: 'self', centers });
          return send(res, 200, { lines: (j.data || []).map((x) => ({ center: x.centerName, line: x.lineName, type: x.mediaType, d: Math.round(x.minDistance), station: x.nearestStaName })) });
        }
        case '/api/bd/captcha': {
          const r = await fetch(BD + '/captcha.jpg?id=' + Date.now());
          bdCookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
          res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' });
          return res.end(Buffer.from(await r.arrayBuffer()));
        }
        case '/api/bd/login': {
          const b = await readBody(req);
          const user = b.user || process.env.BD_USER, pass = b.pass || process.env.BD_PASS;
          if (!user || !pass || !b.captcha) return send(res, 400, { error: '缺少账号、密码或验证码' });
          const j = await bdPost('/doLogin', { userCode: user, password: pass, captcha: b.captcha }, false).catch((e) => ({ code: 'x', message: e.message }));
          if (j.code !== '0000') return send(res, 401, { error: j.code === '0002' ? '验证码错误' : '登录失败' });
          fs.writeFileSync(file('.bd_cookie'), bdCookie);
          return send(res, 200, { ok: true });
        }
        case '/api/hd/token': { // 红豆是滑块验证码：在浏览器登录后，把 localStorage 里的 ACCESS_TOKEN/REFRESH_TOKEN 贴进来
          const b = await readBody(req);
          if (!/^[a-f0-9]{32}$/i.test(b.accessToken || '') || !/^[a-f0-9]{32}$/i.test(b.refreshToken || '')) return send(res, 400, { error: '令牌格式不对' });
          hdToken = { accessToken: b.accessToken, refreshToken: b.refreshToken };
          fs.writeFileSync(file('.hd_token.json'), JSON.stringify(hdToken));
          return send(res, 200, { ok: true });
        }
        case '/api/brief': {
          const b = await readBody(req);
          const text = String(b.text || '');
          const rule = parseBrief(text);
          let ai = null; try { ai = await llmBrief(text); } catch {}
          const merged = { ...rule }; if (ai) for (const [k, v] of Object.entries(ai)) if (v != null && merged[k] == null) merged[k] = v;
          return send(res, 200, { parsed: merged, by: ai ? 'rules+llm' : 'rules' });
        }
      }
      return send(res, 404, { error: '接口不存在' });
    }
    // 静态文件
    const p = path.normalize(path.join(WEB, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
    if (!p.startsWith(WEB) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return send(res, 404, 'not found', 'text/plain; charset=utf-8');
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(p).pipe(res);
  } catch (e) {
    send(res, e.status === 401 ? 401 : e.status || 502, { error: e.message });
  }
});
server.listen(PORT, HOST, () => console.log(`提案工作台：http://${HOST}:${PORT}/`));
// 大数据平台会话闲置会过期：每 10 分钟访问一次当前用户接口保活
setInterval(() => { if (bdCookie) fetch(BD + '/user/getCurrentUser', { method: 'POST', headers: { cookie: bdCookie } }).catch(() => {}); }, 10 * 60 * 1000);
