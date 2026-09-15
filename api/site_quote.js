// 官网询盘表单 · Vercel Serverless Function（零依赖 SMTP + 询盘落库）
// 环境变量：
//   GAVA_SMTP_HOST / GAVA_SMTP_PORT(465) / GAVA_SMTP_USER / GAVA_SMTP_PASS / GAVA_MAIL_TO
//   GAVA_KV_REST_URL / GAVA_KV_TOKEN  （可选：生产落库用 Upstash KV REST；未配置时退回本地文件（自托管））
// 落库优先级：KV（生产持久） → 本地 data/官网询盘.csv（自托管/本地） → 都不可用则不发成功、如实告知
// 返回 mode 含义（前端按 mode 决定提示文案，语义必须真实）：
//   email            = 已落库 + 已发通知邮件
//   stored_no_notify = 已落库，但通知邮件未送达（SMTP 未配或发信失败）
//   email_no_store   = 未落库（无 KV 且无持久磁盘），但通知邮件已送达 —— 线索不丢，编号未入库
//   503 code=storage = 既未落库也未发出通知（不假成功）
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const INQUIRY_FILE = path.join(DATA_DIR, '官网询盘.csv');
const INQUIRY_HEADERS = ['询盘编号','提交时间','来源页面','页面语言','姓名','公司','邮箱','WhatsApp/电话','产品类别','数量','需求描述','当前状态','负责人','首次响应时间','下次跟进时间','跟进记录'];
const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

// 字段长度限制（与前端 maxlength 对齐，后端为最终判断）
const LIMITS = { name: 80, email: 254, whatsapp: 40, company: 120, industry: 100, category: 100, quantity: 50, message: 3000 };

// 简单内存频率限制（单实例有效；生产多实例建议升级为 KV 计数）
const RATE = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const win = 60 * 1000; // 1 分钟窗口
  const max = 10;        // 每分钟最多 10 次
  const rec = RATE.get(ip);
  if (!rec || now - rec.t > win) { RATE.set(ip, { t: now, n: 1 }); return true; }
  rec.n += 1;
  if (rec.n > max) return false;
  return true;
}

function smtpSend({ host, port, user, pass, to, subject, text }) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, servername: host, rejectUnauthorized: false });
    let buf = '';
    let step = 0; // 0问候 1EHLO 2AUTH user 3AUTH pass 4MAIL 5RCPT 6DATA 7正文 8结束
    const timer = setTimeout(() => { try { sock.destroy(); } catch (e) {} reject(new Error('SMTP timeout')); }, 20000);
    const clean = () => clearTimeout(timer);
    const fail = (err) => { clean(); try { sock.destroy(); } catch (e) {} reject(err); };
    const send = (line) => sock.write(line + '\r\n');
    sock.on('error', fail);
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const last = line.length <= 3 || line[3] === ' ';
        if (!last) continue;
        try {
          if (step === 0) { step = 1; send('EHLO gavatech.cn'); }
          else if (step === 1) { step = 2; send('AUTH LOGIN'); }
          else if (step === 2) { step = 3; send(Buffer.from(user).toString('base64')); }
          else if (step === 3) { step = 4; send(Buffer.from(pass).toString('base64')); }
          else if (step === 4) { step = 5; send('MAIL FROM:<' + user + '>'); }
          else if (step === 5) { step = 6; send('RCPT TO:<' + to + '>'); }
          else if (step === 6) { step = 7; send('DATA'); }
          else if (step === 7) { step = 8; send(msgText() + '\r\n.'); }
          else if (step === 8) { clean(); send('QUIT'); sock.end(); resolve(true); }
        } catch (e) { fail(e); }
      }
    });
    function msgText() {
      const crlf = '\r\n';
      return [
        'From: ' + user,
        'To: ' + to,
        'Subject: =?UTF-8?B?' + Buffer.from(subject, 'utf8').toString('base64') + '?=',
        'Date: ' + new Date().toUTCString(),
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from(text, 'utf8').toString('base64')
      ].join(crlf);
    }
  });
}

// 时间一律以 Asia/Shanghai 输出。
// Vercel 运行在 UTC，若直接用本地时间，台账「提交时间」会比北京时间晚 8 小时，
// 会直接导致「2 小时未认领 / 24 小时未回复」监控算错。
function shanghaiParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(d).reduce((acc, x) => (acc[x.type] = x.value, acc), {});
  return parts;
}

function nowStr() {
  const p = shanghaiParts();
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

// 生成唯一询盘编号：INQ-YYYYMMDD-XXXX（当日序号）
function nextInquiryId(rows) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`;
  const prefix = `INQ-${day}-`;
  let max = 0;
  for (const r of rows) {
    const id = r[0] || '';
    if (id.startsWith(prefix)) {
      const n = parseInt(id.slice(prefix.length), 10) || 0;
      if (n > max) max = n;
    }
  }
  return prefix + String(max + 1).padStart(4, '0');
}

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csvRead(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const txt = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return txt.split(/\r?\n/).filter(l => l.trim()).map(l => {
      const out = []; let cur = '', inQ = false;
      for (let i = 0; i < l.length; i++) {
        const c = l[i];
        if (inQ) { if (c === '"' && l[i+1] === '"') { cur += '"'; i++; } else if (c === '"') { inQ = false; } else cur += c; }
        else if (c === '"') { inQ = true; }
        else if (c === ',') { out.push(cur); cur = ''; }
        else cur += c;
      }
      out.push(cur);
      return out;
    });
  } catch (e) { return []; }
}

function csvAppend(file, headers, values) {
  const rows = csvRead(file);
  const needHeader = rows.length === 0;
  const line = values.map(csvEscape).join(',');
  const fd = fs.openSync(file, 'a');
  try {
    if (needHeader) fs.writeSync(fd, '\uFEFF' + headers.map(csvEscape).join(',') + '\n');
    fs.writeSync(fd, line + '\n');
  } finally { fs.closeSync(fd); }
  return true;
}

// KV 落库（生产持久）：支持三种常见环境变量命名，任一组配好即可
//   GAVA_KV_REST_URL / GAVA_KV_TOKEN                    本项目原命名
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN   Upstash / Vercel Marketplace 集成注入
//   KV_REST_API_URL / KV_REST_API_TOKEN                 Vercel KV 旧命名
function kvCreds() {
  const pairs = [
    ['GAVA_KV_REST_URL', 'GAVA_KV_TOKEN'],
    ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
    ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
  ];
  for (const [uk, tk] of pairs) {
    const url = process.env[uk], token = process.env[tk];
    if (url && token) return { url: String(url).replace(/\/+$/, ''), token: String(token) };
  }
  return null;
}

async function kvAppend(record) {
  const c = kvCreds();
  if (!c) return { ok: false, reason: 'no_kv' };
  try {
    const key = 'inquiry:' + record[0];
    // Upstash REST「body-style」：POST <REST_URL>，请求体为命令数组 ["SET", key, value]
    // 注意：不能用 {"key":..,"value":..} 这种 JSON 对象——Upstash 会返回错误，
    // 若不再校验响应，就会「假成功」把询盘吞掉，故此处必须校验状态与 result。
    const res = await fetch(c.url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + c.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', key, JSON.stringify(record)])
    });
    if (!res.ok) return { ok: false, reason: 'kv_http_' + res.status };
    let parsed = null;
    try { parsed = JSON.parse(await res.text()); } catch (e) { parsed = null; }
    const okResult = parsed && !parsed.error && String(parsed.result).toUpperCase() === 'OK';
    if (!okResult) return { ok: false, reason: 'kv_result' };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'kv_error' };
  }
}

export default async function handler(req, res) {
  // 1. 只允许 POST
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, code: 'method', error: 'Method not allowed' });
  }
  // 2. 只接受 JSON
  const ctype = (req.headers['content-type'] || '').toLowerCase();
  if (!ctype.includes('application/json')) {
    return res.status(415).json({ ok: false, code: 'unsupported', error: 'Unsupported media type' });
  }
  // 3. 频率限制（按来源 IP；日志不记录请求体）
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (!rateLimit(ip)) {
    return res.status(429).json({ ok: false, code: 'rate', error: 'Too many requests, please retry later' });
  }
  // 4. 解析并校验
  let body = '';
  try {
    for await (const chunk of req) body += chunk;
  } catch (e) { return res.status(400).json({ ok: false, code: 'invalid', error: 'Invalid request body' }); }
  let data = {};
  try { data = JSON.parse(body || '{}'); } catch (e) { return res.status(400).json({ ok: false, code: 'invalid', error: 'Invalid JSON' }); }

  // 蜜罐：隐藏字段被填写 → 静默拒绝
  if ((data.company_website || '').trim()) {
    return res.status(200).json({ ok: true, mode: 'email', inquiry_id: 'N/A' });
  }

  const clean = (v) => typeof v === 'string' ? v.trim() : '';
  const name = clean(data.name);
  const email = clean(data.email).toLowerCase();
  const message = clean(data.message);

  if (!name) return res.status(400).json({ ok: false, code: 'invalid', error: 'Name is required' });
  if (!email) return res.status(400).json({ ok: false, code: 'invalid', error: 'Email is required' });
  if (email.length > 254 || !EMAIL_RE.test(email)) return res.status(400).json({ ok: false, code: 'invalid', error: 'Invalid email' });
  if (!message) return res.status(400).json({ ok: false, code: 'invalid', error: 'Message is required' });
  // 字段长度限制（后端最终判断）
  for (const k of Object.keys(LIMITS)) {
    const v = clean(data[k]);
    if (v.length > LIMITS[k]) return res.status(400).json({ ok: false, code: 'too_long', error: 'Field too long' });
  }

  // 5. 先落库，生成唯一询盘编号
  // 编号策略（必须保证唯一，否则台账去重会把不同询盘合并）：
  //   - 默认用「日期 + 时分秒 + 随机两位」——不依赖任何存储，天然不重号
  //   - 若本地 CSV 落库成功，再改写为顺序号 INQ-YYYYMMDD-0001（便于人工引用）
  const nowD = shanghaiParts();
  const dayStr = `${nowD.year}${nowD.month}${nowD.day}`;
  const timeStr = `${nowD.hour}${nowD.minute}${nowD.second}`;
  const id = 'INQ-' + dayStr + '-' + timeStr + String(Math.floor(Math.random() * 90) + 10);
  const record = [
    id, nowStr(), clean(data.page) || '/', clean(data.lang) || 'zh',
    name, clean(data.company), email, clean(data.whatsapp),
    clean(data.category), clean(data.quantity), message,
    '新询盘（待认领）', '', '', '', '网站提交'
  ];
  let stored = false;
  // 优先 KV（生产持久）
  const kv = await kvAppend(record);
  if (kv.ok) stored = true;
  else {
    // 退回本地 CSV（自托管/本地运行时）
    const uniqueId = record[0];
    try {
      const rows = csvRead(INQUIRY_FILE);
      record[0] = nextInquiryId(rows);
      csvAppend(INQUIRY_FILE, INQUIRY_HEADERS, record);
      stored = true;
    } catch (e) {
      // 写盘失败：**必须把编号恢复成唯一号**，否则当天所有询盘会同号，被台账去重合并
      record[0] = uniqueId;
      stored = false;
    }
  }
  if (!stored) {
    // 落库不可用（常见于 Vercel 未配 KV）：不再直接失败，改为「至少把线索通知到人」
    console.warn('[site_quote] storage unavailable; falling back to email-only notification');
  }

  // 6. 发送通知。落库成功后再通知；落库失败时**仍然尝试通知**——邮件送到即线索未丢。
  const cfg = {
    host: process.env.GAVA_SMTP_HOST || '',
    port: Number(process.env.GAVA_SMTP_PORT || 465),
    user: process.env.GAVA_SMTP_USER || '',
    pass: process.env.GAVA_SMTP_PASS || '',
    to: process.env.GAVA_MAIL_TO || ''
  };
  const mailReady = !!(cfg.host && cfg.user && cfg.pass && cfg.to);
  if (!mailReady) {
    // SMTP 未配置：没落库也没通知 → 如实失败（不假成功）
    if (!stored) {
      console.error('[site_quote] storage unavailable AND smtp not configured; inquiry NOT delivered');
      return res.status(503).json({ ok: false, code: 'storage', error: 'Service temporarily unavailable' });
    }
    // 已落库、仅通知未配置：明确告知状态（mode=stored_no_notify）
    return res.status(200).json({ ok: true, mode: 'stored_no_notify', inquiry_id: record[0] });
  }
  const subject = '[官网询盘] ' + name + ' · ' + (data.company || '未填公司') + ' · ' + (data.category || '未填类别');
  const text = '来自伽桦智能官网「获取报价/样品」表单：\n\n询盘编号：' + record[0] + '\n提交时间：' + record[1] + '\n来源页面：' + record[2] + '\n页面语言：' + record[3] + '\n称呼：' + name + '\n邮箱：' + email + '\nWhatsApp/电话：' + (data.whatsapp || '—') + '\n公司：' + (data.company || '—') + '\n行业：' + (data.industry || '—') + '\n产品类别：' + (data.category || '—') + '\n预计数量：' + (data.quantity || '—') + '\n需求描述：\n' + message + '\n' +
    (stored ? '' : '\n⚠️ 本封询盘**未写入台账**（服务端无 KV 且无持久磁盘），请人工登记。\n');
  try {
    await smtpSend({ ...cfg, subject, text });
    if (!stored) {
      console.warn('[site_quote] notified by email but NOT persisted: ' + record[0]);
      return res.status(200).json({ ok: true, mode: 'email_no_store', stored: false, inquiry_id: record[0] });
    }
    return res.status(200).json({ ok: true, mode: 'email', inquiry_id: record[0] });
  } catch (e) {
    // 邮件失败：已落库则告知未通知；未落库则如实失败（不假成功）
    console.error('[site_quote] email failed for ' + record[0] + ': ' + e.message);
    if (!stored) return res.status(503).json({ ok: false, code: 'storage', error: 'Service temporarily unavailable' });
    return res.status(200).json({ ok: true, mode: 'stored_no_notify', inquiry_id: record[0] });
  }
}
