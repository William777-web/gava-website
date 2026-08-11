/* 伽桦环保官网 · 交互 */
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

  /* ---------- 询价表单（前端演示，接入后端/邮箱后替换） ---------- */
  var form = document.getElementById('quoteForm');
  var note = document.getElementById('formNote');
  if (form && note) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = form.name.value.trim();
      var msg = form.message.value.trim();
      if (!name || !msg) {
        note.textContent = '请填写称呼与需求描述，我们才能更好地回复您。';
        note.style.color = '#A34A2A';
        return;
      }
      // 真实提交：POST /api/site_quote（SMTP 发到公司邮箱；未配置邮箱时自动演示模式）
      var payload = {
        name: name,
        email: form.email ? form.email.value.trim() : "",
        company: form.company.value.trim(),
        industry: form.industry.value,
        category: form.category ? form.category.value : "",
        quantity: form.quantity ? form.quantity.value.trim() : "",
        message: msg
      };
      var btn = form.querySelector('button[type=submit]');
      if (btn) { btn.disabled = true; btn.textContent = '提交中…'; }
      fetch('/api/site_quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (res) { return res.json().catch(function () { return {}; }); })
        .then(function (data) {
          if (data && data.ok && data.mode === 'email') {
            note.textContent = '✓ 已收到您的需求，我们会尽快与您联系。';
            note.style.color = 'var(--teal)';
            form.reset();
          } else if (data && data.ok) {
            note.textContent = '✓ 已收到您的需求（当前为演示提交，邮箱接入后自动生效）。';
            note.style.color = 'var(--teal)';
            form.reset();
          } else {
            note.textContent = (data && data.error) ? data.error : '提交失败，请稍后再试或直接联系我们。';
            note.style.color = '#A34A2A';
          }
        })
        .catch(function () {
          note.textContent = '提交失败，请稍后再试或直接联系我们。';
          note.style.color = '#A34A2A';
        })
        .finally(function () {
          if (btn) { btn.disabled = false; btn.textContent = '提交需求'; }
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
