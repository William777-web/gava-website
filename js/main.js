/* 深圳市伽桦智能科技有限公司官网 · 交互 */
(function () {
  'use strict';

  /* ---------- 移动端导航 ---------- */
  var toggle = document.getElementById('navToggle');
  var links = document.getElementById('navLinks');
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      toggle.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
    });
    // 点击链接后关闭移动端菜单
    links.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        links.classList.remove('open');
        toggle.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---------- 导航滚动高亮 ---------- */
  var navAnchors = document.querySelectorAll('.nav-links a[href^="#"]');
  var sections = [];
  navAnchors.forEach(function (a) {
    var id = a.getAttribute('href').slice(1);
    var el = document.getElementById(id);
    if (el) sections.push({ id: id, el: el, a: a });
  });
  var spy = function () {
    var y = window.scrollY + 90;
    var cur = null;
    sections.forEach(function (s) {
      if (s.el.offsetTop <= y) cur = s;
    });
    navAnchors.forEach(function (a) { a.style.color = ''; });
    if (cur) {
      // CTA 按钮保持品牌绿
      var active = document.querySelector('.nav-links a[href="#' + cur.id + '"]');
      if (active && !active.classList.contains('nav-cta')) active.style.color = 'var(--teal)';
    }
  };
  window.addEventListener('scroll', spy, { passive: true });
  spy();

  /* ---------- 询价表单（真实提交：前端校验 → 后端校验 → 落库 → 通知） ---------- */
  var form = document.getElementById('quoteForm');
  var note = document.getElementById('formNote');
  if (form && note) {
    // 页面语言：优先取表单 data-lang，其次 html lang
    var lang = (form.getAttribute('data-lang') || document.documentElement.lang || 'zh-CN').toLowerCase();
    var isEn = lang.indexOf('en') === 0;
    var I18N = {
      zh: {
        submitting: '提交中…',
        btnIdle: '提交需求',
        needName: '请填写您的称呼。',
        needEmail: '请填写联系邮箱。',
        badEmail: '邮箱格式不正确，请检查后重试。',
        tooLong: '部分内容过长，请精简后重试。',
        needMsg: '请填写需求描述，我们才能更好地回复您。',
        success: '✓ 已收到您的需求，询盘编号：',
        successTail: '。我们会在工作日 24 小时内回复；如急请 WhatsApp +86 17796335657 或邮箱 info@gavatech.cn。',
        storedNoNotify: '已记录您的需求（编号：',
        storedNoNotifyTail: '），但内部通知暂未送达，我们恢复后会第一时间处理；急事请 WhatsApp +86 17796335657 或邮箱 info@gavatech.cn。',
        failed: '提交尚未成功，请稍后重试，或直接联系 WhatsApp +86 17796335657 / 邮箱 info@gavatech.cn。',
        network: '网络异常，提交尚未成功。请检查网络后重试，或直接联系 WhatsApp +86 17796335657 / 邮箱 info@gavatech.cn。',
        server: '服务暂时不可用，提交尚未成功。请稍后重试，或直接联系 WhatsApp +86 17796335657 / 邮箱 info@gavatech.cn。'
      },
      en: {
        submitting: 'Submitting…',
        btnIdle: 'Submit',
        needName: 'Please enter your name.',
        needEmail: 'Please enter your email address.',
        badEmail: 'Invalid email format. Please check and try again.',
        tooLong: 'Some fields are too long. Please shorten and retry.',
        needMsg: 'Please describe your requirement so we can help.',
        success: '✓ Received. Your inquiry ID: ',
        successTail: '. We reply within 24 hours on business days. Urgent? WhatsApp +86 17796335657 or info@gavatech.cn.',
        storedNoNotify: 'Your inquiry is recorded (ID: ',
        storedNoNotifyTail: '), but our internal notification is temporarily unavailable. We will follow up as soon as it recovers. Urgent? WhatsApp +86 17796335657 or info@gavatech.cn.',
        failed: 'Submission not completed. Please retry later, or contact WhatsApp +86 17796335657 / info@gavatech.cn.',
        network: 'Network error. Submission not completed. Please check your connection and retry, or contact WhatsApp +86 17796335657 / info@gavatech.cn.',
        server: 'Service temporarily unavailable. Submission not completed. Please retry later, or contact WhatsApp +86 17796335657 / info@gavatech.cn.'
      }
    };
    var T = I18N[isEn ? 'en' : 'zh'];
    var EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

    function showNote(text, ok) {
      note.textContent = text;
      note.style.color = ok ? 'var(--teal)' : '#A34A2A';
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = form.name ? form.name.value.trim() : '';
      var email = form.email ? form.email.value.trim() : '';
      var msg = form.message ? form.message.value.trim() : '';
      // 蜜罐：隐藏字段被填了就是机器人，直接静默拒绝
      if (form.company_website && form.company_website.value.trim()) return;
      // 前端校验（后端为最终判断）
      if (!name) { showNote(T.needName, false); return; }
      if (!email) { showNote(T.needEmail, false); return; }
      if (email.length > 254 || !EMAIL_RE.test(email)) { showNote(T.badEmail, false); return; }
      if (!msg) { showNote(T.needMsg, false); return; }
      var payload = {
        name: name,
        email: email,
        whatsapp: form.whatsapp ? form.whatsapp.value.trim() : '',
        company: form.company ? form.company.value.trim() : '',
        industry: form.industry ? form.industry.value : '',
        category: form.category ? form.category.value : '',
        quantity: form.quantity ? form.quantity.value.trim() : '',
        message: msg,
        page: window.location.pathname,
        lang: isEn ? 'en' : 'zh'
      };
      var btn = form.querySelector('button[type=submit]');
      if (btn) { btn.disabled = true; btn.textContent = T.submitting; }
      var origBtnText = btn ? btn.textContent : '';
      fetch('/api/site_quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (res) { return res.json().catch(function () { return {}; }); })
        .then(function (data) {
          if (data && data.ok && data.mode === 'email') {
            showNote(T.success + (data.inquiry_id || '') + T.successTail, true);
            form.reset();
          } else if (data && data.ok && data.mode === 'stored_no_notify') {
            // 已落库但通知失败：不显示纯成功，明确告知状态与备用联系
            showNote(T.storedNoNotify + (data.inquiry_id || '') + T.storedNoNotifyTail, false);
            form.reset();
          } else if (data && data.ok) {
            showNote(T.failed, false);
          } else {
            // 服务端明确失败：保留用户已填内容
            var code = data && data.code ? data.code : 'server';
            showNote((code === 'invalid' ? T.badEmail : T.failed), false);
          }
        })
        .catch(function () {
          showNote(T.network, false);
        })
        .finally(function () {
          if (btn) { btn.disabled = false; btn.textContent = origBtnText || T.btnIdle; }
        });
    });
  }
})();

  /* ---------- 返回顶部 ---------- */
  var toTop = document.getElementById('toTop');
  if (toTop) {
    var onScrollTop = function () {
      if (window.scrollY > 480) toTop.classList.add('show');
      else toTop.classList.remove('show');
    };
    window.addEventListener('scroll', onScrollTop, { passive: true });
    onScrollTop();
    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ---------- FAQ 手风琴：同时只展开一个 ---------- */
  var faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(function (item) {
    item.addEventListener('toggle', function () {
      if (item.open) {
        faqItems.forEach(function (other) {
          if (other !== item) other.open = false;
        });
      }
    });
  });


// 产品分类筛选
(function () {
  var catFilter = document.getElementById('catFilter');
  if (!catFilter) return;
  catFilter.addEventListener('click', function (e) {
    var btn = e.target.closest('.cf-btn');
    if (!btn) return;
    catFilter.querySelectorAll('.cf-btn').forEach(function (b) { b.classList.remove('active'); });
    btn.classList.add('active');
    var f = btn.getAttribute('data-f');
    document.querySelectorAll('.cat-card').forEach(function (card) {
      card.style.display = (f === 'all' || card.getAttribute('data-cat') === f) ? '' : 'none';
    });
  });
})();
