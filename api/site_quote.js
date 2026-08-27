// 官网询盘表单 · Vercel Serverless Function（零依赖 SMTP + 询盘落库）
// 环境变量：
//   GAVA_SMTP_HOST / GAVA_SMTP_PORT(465) / GAVA_SMTP_USER / GAVA_SMTP_PASS / GAVA_MAIL_TO
//   GAVA_KV_REST_URL / GAVA_KV_TOKEN  （可选：生产落库用 Upstash KV REST；未配置时退回本地文件（自托管））
// 落库优先级：KV（生产持久） → 本地 data/官网询盘.csv（自托管/本地） → 都不可用则如实返回失败（不假成功）
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

function nowStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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

// KV 落库（生产持久）：GAVA_KV_REST_URL + GAVA_KV_TOKEN
async function kvAppend(record) {
  const url = process.env.GAVA_KV_REST_URL;
  const token = process.env.GAVA_KV_TOKEN;
  if (!url || !token) return { ok: false, reason: 'no_kv' };
  try {
    const key = 'inquiry:' + record[0];
    await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: JSON.stringify(record) })
    });
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
  const id = 'INQ-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + String(Math.floor(Math.random()*9000)+1000);
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
    try {
      const rows = csvRead(INQUIRY_FILE);
      record[0] = nextInquiryId(rows);
      csvAppend(INQUIRY_FILE, INQUIRY_HEADERS, record);
      stored = true;
    } catch (e) { stored = false; }
  }
  if (!stored) {
    // 落库失败：如实返回失败（不清空前端表单；前端展示备用联系方式）
    console.error('[site_quote] storage unavailable, inquiry NOT persisted');
    return res.status(503).json({ ok: false, code: 'storage', error: 'Service temporarily unavailable' });
  }

  // 6. 发送通知（落库成功后再通知；通知失败不影响已落库询盘）
  const cfg = {
    host: process.env.GAVA_SMTP_HOST || '',
    port: Number(process.env.GAVA_SMTP_PORT || 465),
    user: process.env.GAVA_SMTP_USER || '',
    pass: process.env.GAVA_SMTP_PASS || '',
    to: process.env.GAVA_MAIL_TO || ''
  };
  if (!(cfg.host && cfg.user && cfg.pass && cfg.to)) {
    // SMTP 未配置：不显示成功；但询盘已落库，明确告知状态（mode=stored_no_notify）
    return res.status(200).json({ ok: true, mode: 'stored_no_notify', inquiry_id: record[0] });
  }
  const subject = '[官网询盘] ' + name + ' · ' + (data.company || '未填公司') + ' · ' + (data.category || '未填类别');
  const text = '来自伽桦智能官网「获取报价/样品」表单：\n\n询盘编号：' + record[0] + '\n提交时间：' + record[1] + '\n来源页面：' + record[2] + '\n页面语言：' + record[3] + '\n称呼：' + name + '\n邮箱：' + email + '\nWhatsApp/电话：' + (data.whatsapp || '—') + '\n公司：' + (data.company || '—') + '\n行业：' + (data.industry || '—') + '\n产品类别：' + (data.category || '—') + '\n预计数量：' + (data.quantity || '—') + '\n需求描述：\n' + message + '\n';
  try {
    await smtpSend({ ...cfg, subject, text });
    return res.status(200).json({ ok: true, mode: 'email', inquiry_id: record[0] });
  } catch (e) {
    // 邮件失败但询盘已落库：不提示成功，明确告知（不向客户暴露 SMTP 内部细节）
    console.error('[site_quote] email failed for ' + record[0] + ': ' + e.message);
    return res.status(200).json({ ok: true, mode: 'stored_no_notify', inquiry_id: record[0] });
  }
}
