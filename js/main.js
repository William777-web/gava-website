/* 深圳市伽桦智能科技有限公司 GAVA TECH 官网 · 交互
   ------------------------------------------------------------
   本轮（2026-09-14 UI 审美优化）新增：
   1) 三条业务方向深链：?seg=filter|heat|parts —— 分类筛选落到正确内容，
      无产品的「工业配件寻源」走询源入口，不展示空白区
   2) 询价上下文：产品页 → 首页表单，显示「正在咨询的产品」并随 payload 传递
   3) WhatsApp 咨询：动态拼上准确产品名 + 当前页面链接（encodeURIComponent）
   4) 全部动态写入 DOM 的内容一律用 textContent（不插入未处理 HTML，防注入）
   ------------------------------------------------------------ */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* 文本净化：去掉控制字符、限长；永远用 textContent 写入 */
  function clean(v, max) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 120);
  }

  var isEn = (document.documentElement.lang || 'zh').toLowerCase().indexOf('en') === 0;

  /* ============================================================
     1 · 移动端导航
     ============================================================ */
  var toggle = $('#navToggle');
  var links = $('#navLinks');
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      toggle.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open
        ? (isEn ? 'Close menu' : '关闭菜单')
        : (isEn ? 'Open menu' : '打开菜单'));
    });
    links.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        links.classList.remove('open');
        toggle.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ============================================================
     2 · 导航滚动高亮
     ============================================================ */
  (function () {
    var anchors = $$('.nav-links a[href^="#"]').filter(function (a) { return a.hash !== '#'; });
    var pairs = [];
    anchors.forEach(function (a) {
      var el = document.getElementById(a.hash.slice(1));
      if (el) pairs.push({ a: a, el: el, id: a.hash.slice(1) });
    });
    if (!pairs.length) return;
    var current = null;
    function spy() {
      var y = window.scrollY + 100;
      var next = null;
      pairs.forEach(function (p) { if (p.el.offsetTop <= y) next = p; });
      if (next === current) return;
      current = next;
      pairs.forEach(function (p) { p.a.classList.remove('is-current'); p.a.removeAttribute('aria-current'); });
      if (next && !next.a.classList.contains('nav-cta')) {
        next.a.classList.add('is-current');
        next.a.setAttribute('aria-current', 'true');
      }
    }
    window.addEventListener('scroll', spy, { passive: true });
    spy();
  }());

  /* ============================================================
     3 · 三条业务方向 → 产品分类筛选 / 询源入口
     ============================================================ */
  var SEGS = ['filter', 'heat', 'parts'];
  var filterBar = $('#catFilter');
  var cards = $$('.cat-card');
  var sourcing = $('#catSourcing');
  var emptyBox = $('#catEmpty');
  var countEl = $('#prodCount');

  function setCount(n) { if (countEl) countEl.textContent = String(n); }

  function applySeg(seg) {
    if (SEGS.indexOf(seg) < 0) seg = 'all';
    if (filterBar) {
      $$('.cf-btn', filterBar).forEach(function (b) {
        var on = (b.getAttribute('data-seg') || 'all') === seg;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    var shown = 0;
    cards.forEach(function (c) {
      var match = (seg === 'all') || (c.getAttribute('data-seg') === seg);
      if (seg === 'parts') match = false;
      c.hidden = !match;
      if (match) shown++;
    });
    if (sourcing) sourcing.classList.toggle('on', seg === 'parts');
    if (emptyBox) emptyBox.classList.toggle('on', shown === 0 && seg !== 'parts');
    setCount(cards.length);           /* 文案数量始终 = 实际卡片总数，不写历史数字 */
  }

  function syncUrl(seg) {
    try {
      var base = location.pathname;
      var q = seg === 'all' ? '' : '?seg=' + seg;
      history.replaceState(null, '', base + q + '#products');
    } catch (e) { /* file:// 等环境忽略 */ }
  }

  if (filterBar) {
    filterBar.addEventListener('click', function (e) {
      var btn = e.target.closest('.cf-btn');
      if (!btn) return;
      var seg = btn.getAttribute('data-seg') || 'all';
      applySeg(seg);
      syncUrl(seg);
    });
  }

  /* 首屏 / 业务入口点击：同页时直接筛选，不整页刷新 */
  $$('a[data-seg-link]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var seg = a.getAttribute('data-seg-link');
      if (SEGS.indexOf(seg) < 0) return;
      if (!filterBar) return;                    /* 非首页：正常跳转 */
      e.preventDefault();
      applySeg(seg);
      syncUrl(seg);
      var target = a.getAttribute('data-seg-target') || '#products';
      var el = document.querySelector(target);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (seg === 'parts') showIntent(true);
    });
  });

  /* 深链：?seg=filter|heat|parts（也兼容 #products-filter 等写法） */
  (function () {
    if (!filterBar) return;
    var seg = (new URLSearchParams(location.search)).get('seg') || '';
    var h = (location.hash || '').replace('#', '');
    if (!seg && /^products-(filter|heat|parts)$/.test(h)) seg = h.replace('products-', '');
    if (seg) {
      applySeg(seg);
      if (seg === 'parts') showIntent(true);
    } else {
      applySeg('all');
    }
  }());

  /* 询源意图提示（工业配件寻源落点） */
  function showIntent(on) {
    var n = $('#intentNote');
    if (n) n.classList.toggle('on', !!on);
  }

  /* ============================================================
     4 · 询价上下文（产品页 → 表单）
     ============================================================ */
  var CTX = { name: '', model: '', cat: '' };
  (function () {
    var qs = new URLSearchParams(location.search);
    CTX.name = clean(qs.get('product'), 120);
    CTX.model = clean(qs.get('model'), 60);
    CTX.cat = clean(qs.get('cat'), 80);
    /* 产品页自身也带 data-*（表单不在该页，仅供 WhatsApp 动态拼接用） */
    var pd = $('main.pd-page');
    if (!CTX.name && pd) {
      CTX.name = clean(pd.getAttribute('data-product'), 120);
      CTX.model = clean(pd.getAttribute('data-model'), 60);
      CTX.cat = clean(pd.getAttribute('data-cat'), 80);
    }
  }());

  function renderContext() {
    var box = $('#formContext');
    var nEl = $('#ctxName'), mEl = $('#ctxMeta');
    var hN = $('#ctxProductName'), hM = $('#ctxProductModel'), hC = $('#ctxProductCat');
    if (hN) hN.value = CTX.name;
    if (hM) hM.value = CTX.model;
    if (hC) hC.value = CTX.cat;
    if (!box) return;
    if (!CTX.name) { box.classList.remove('on'); return; }   /* 无上下文不显示空壳 */
    if (nEl) nEl.textContent = CTX.name;
    if (mEl) {
      var meta = [];
      if (CTX.model) meta.push((isEn ? 'Model: ' : '型号：') + CTX.model);
      if (CTX.cat) meta.push((isEn ? 'Category: ' : '分类：') + CTX.cat);
      mEl.textContent = meta.join(' · ');
      mEl.hidden = meta.length === 0;
    }
    box.classList.add('on');
  }

  var clearCtx = $('#ctxClear');
  if (clearCtx) {
    clearCtx.addEventListener('click', function () {
      CTX = { name: '', model: '', cat: '' };
      renderContext();
      var f = $('#quoteForm');
      if (f && f.message) f.message.focus();
    });
  }
  renderContext();

  /* ============================================================
     5 · WhatsApp 咨询：动态拼上产品名 + 页面链接
     ============================================================ */
  (function () {
    var waLinks = $$('a[data-wa-context]');
    if (!waLinks.length || !CTX.name) return;
    var canonical = document.querySelector('link[rel="canonical"]');
    var pageUrl = canonical ? canonical.href : location.href;
    waLinks.forEach(function (a) {
      var text = isEn
        ? 'Hello GAVA TECH, I would like to inquire about: ' + CTX.name
          + (CTX.model ? ' (Model ' + CTX.model + ')' : '') + '. Product page: ' + pageUrl
        : '您好，我想咨询：' + CTX.name
          + (CTX.model ? '（型号 ' + CTX.model + '）' : '') + '。产品页：' + pageUrl;
      a.href = 'https://wa.me/8617796335657?text=' + encodeURIComponent(text);
    });
  }());

  /* ============================================================
     6 · 询价表单（前端校验 → 后端校验 → 落库 → 通知）
     ============================================================ */
  var form = $('#quoteForm');
  var note = $('#formNote');
  if (form && note) {
    var lang = (form.getAttribute('data-lang') || document.documentElement.lang || 'zh-CN').toLowerCase();
    var en = lang.indexOf('en') === 0;
    var I18N = {
      zh: {
        submitting: '提交中…', btnIdle: '提交需求',
        needName: '请填写您的称呼。', needEmail: '请填写联系邮箱。',
        badEmail: '邮箱格式不正确，请检查后重试。',
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
        submitting: 'Submitting…', btnIdle: 'Submit',
        needName: 'Please enter your name.', needEmail: 'Please enter your email address.',
        badEmail: 'Invalid email format. Please check and try again.',
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
    var T = I18N[en ? 'en' : 'zh'];
    var EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

    function showNote(text, ok) {
      note.textContent = text;
      note.style.color = ok ? 'var(--green)' : '#A3462A';
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = form.name ? form.name.value.trim() : '';
      var email = form.email ? form.email.value.trim() : '';
      var msg = form.message ? form.message.value.trim() : '';
      if (form.company_website && form.company_website.value.trim()) return;  /* 蜜罐 */
      if (!name) { showNote(T.needName, false); form.name.focus(); return; }
      if (!email) { showNote(T.needEmail, false); form.email.focus(); return; }
      if (email.length > 254 || !EMAIL_RE.test(email)) { showNote(T.badEmail, false); form.email.focus(); return; }
      if (!msg) { showNote(T.needMsg, false); form.message.focus(); return; }

      var payload = {
        name: name,
        email: email,
        whatsapp: form.whatsapp ? form.whatsapp.value.trim() : '',
        company: form.company ? form.company.value.trim() : '',
        industry: form.industry ? form.industry.value : '',
        category: form.category ? form.category.value : '',
        quantity: form.quantity ? form.quantity.value.trim() : '',
        message: msg,
        product_name: CTX.name,
        product_model: CTX.model,
        product_cat: CTX.cat,
        page: window.location.pathname,
        lang: en ? 'en' : 'zh'
      };
      var btn = form.querySelector('button[type=submit]');
      var origBtnText = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = T.submitting; }
      fetch('/api/site_quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (res) { return res.json().catch(function () { return {}; }); })
        .then(function (data) {
          if (data && data.ok && data.mode === 'email') {
            showNote(T.success + (data.inquiry_id || '') + T.successTail, true);
            form.reset(); renderContext();
          } else if (data && data.ok && data.mode === 'stored_no_notify') {
            showNote(T.storedNoNotify + (data.inquiry_id || '') + T.storedNoNotifyTail, false);
            form.reset(); renderContext();
          } else if (data && data.ok) {
            showNote(T.failed, false);
          } else {
            var code = data && data.code ? data.code : 'server';
            showNote((code === 'invalid' ? T.badEmail : T.failed), false);
          }
        })
        .catch(function () { showNote(T.network, false); })
        .finally(function () {
          if (btn) { btn.disabled = false; btn.textContent = origBtnText || T.btnIdle; }
        });
    });
  }

  /* ============================================================
     7 · 返回顶部
     ============================================================ */
  var toTop = $('#toTop');
  if (toTop) {
    var onScrollTop = function () {
      toTop.classList.toggle('show', window.scrollY > 480);
    };
    window.addEventListener('scroll', onScrollTop, { passive: true });
    onScrollTop();
    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ============================================================
     8 · FAQ：同时只展开一个（保留 details 语义，键盘天然可用）
     ============================================================ */
  var faqItems = $$('.faq-item');
  faqItems.forEach(function (item) {
    item.addEventListener('toggle', function () {
      if (item.open) faqItems.forEach(function (o) { if (o !== item) o.open = false; });
    });
  });
}());
