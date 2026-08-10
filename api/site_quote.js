// 官网询盘表单 · Vercel Serverless Function（零依赖 SMTP）
// 环境变量：GAVA_SMTP_HOST / GAVA_SMTP_PORT(465) / GAVA_SMTP_USER / GAVA_SMTP_PASS / GAVA_MAIL_TO
import tls from 'node:tls';

function smtpSend({ host, port, user, pass, to, subject, text }) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, servername: host, rejectUnauthorized: false });
    let buf = '';
    let step = 0; // 0问候 1EHLO 2AUTH user 3AUTH pass 4MAIL 5RCPT 6DATA 7正文 8结束
    const timer = setTimeout(() => { try { sock.destroy(); } catch (e) {} reject(new Error('SMTP 超时')); }, 20000);
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

export default async function handler(req, res) {
  let body = '';
  for await (const chunk of req) body += chunk;
  let data = {};
  try { data = JSON.parse(body || '{}'); } catch (e) { data = {}; }
  const name = (data.name || '').trim();
  const message = (data.message || '').trim();
  if (!name || !message) {
    return res.status(400).json({ ok: false, error: '请填写称呼与需求描述' });
  }
  const cfg = {
    host: process.env.GAVA_SMTP_HOST || '',
    port: Number(process.env.GAVA_SMTP_PORT || 465),
    user: process.env.GAVA_SMTP_USER || '',
    pass: process.env.GAVA_SMTP_PASS || '',
    to: process.env.GAVA_MAIL_TO || ''
  };
  if (!(cfg.host && cfg.user && cfg.pass && cfg.to)) {
    return res.status(200).json({ ok: true, mode: 'demo', msg: '邮箱未配置，当前为演示提交' });
  }
  const subject = '[官网询盘] ' + name + ' · ' + (data.company || '未填公司') + ' · ' + (data.industry || '未填行业');
  const text = '来自伽桦环保官网「获取报价/样品」表单：\n\n称呼：' + name + '\n公司：' + (data.company || '—') + '\n行业：' + (data.industry || '—') + '\n需求描述：\n' + message + '\n';
  try {
    await smtpSend({ ...cfg, subject, text });
    return res.status(200).json({ ok: true, mode: 'email' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: '邮件发送失败：' + e.message });
  }
}
