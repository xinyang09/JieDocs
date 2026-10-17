(function () {
  'use strict';

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function escapeHtml(s) {
    return s.replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }

  /* ---------- 1. Scroll reveal ---------- */
  var revealSel = '.section-head, .bento-card, .step, .faq-item, .cta-panel, .terminal, .code-browser, .sync-stage, .deploy-copy, .trust-row';
  $$(revealSel).forEach(function (el, i) {
    el.classList.add('reveal');
    el.dataset.delay = String(i % 4);
  });
  if ('IntersectionObserver' in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    $$('.reveal').forEach(function (el) { io.observe(el); });
  } else {
    $$('.reveal').forEach(function (el) { el.classList.add('is-visible'); });
  }

  /* ---------- 2. Typewriter ---------- */
  // tokens: [{ t: 'text', cls: 'k' }]
  function typeInto(el, tokens, cps, onDone) {
    var ti = 0, ci = 0, curSpan = null;
    el.textContent = '';
    if (reduceMotion) {
      tokens.forEach(function (tk) {
        var s = document.createElement('span');
        if (tk.cls) s.className = tk.cls;
        s.textContent = tk.t;
        el.appendChild(s);
      });
      if (onDone) onDone();
      return;
    }
    (function tick() {
      if (ti >= tokens.length) { if (onDone) onDone(); return; }
      var tk = tokens[ti];
      var ch = tk.t[ci];
      var cls = tk.cls || '';
      if (!curSpan || curSpan.getAttribute('data-cls') !== cls) {
        curSpan = document.createElement('span');
        if (cls) { curSpan.className = cls; curSpan.setAttribute('data-cls', cls); }
        el.appendChild(curSpan);
      }
      curSpan.textContent += ch;
      ci++;
      if (ci >= tk.t.length) { ti++; ci = 0; curSpan = null; }
      setTimeout(tick, 1000 / cps);
    })();
  }

  /* ---------- 3. Hero typing ---------- */
  var heroTokens = [
    { t: '# ', cls: 'c' }, { t: '每日笔记', cls: 'f' }, { t: '\n\n', cls: '' },
    { t: '## ', cls: 'c' }, { t: '今日待办', cls: 'f' }, { t: '\n', cls: '' },
    { t: '- ', cls: '' }, { t: '[x]', cls: 's' }, { t: ' Mac 上写完这一段', cls: '' }, { t: '\n', cls: '' },
    { t: '- ', cls: '' }, { t: '[ ]', cls: 's' }, { t: ' 手机端接着改', cls: '' }, { t: '\n\n', cls: '' },
    { t: '> ', cls: 'c' }, { t: '改完即达，无需保存。', cls: 's' }
  ];
  var heroTarget = $('#typing-target');
  if (heroTarget) {
    typeInto(heroTarget, heroTokens, 34);
  }

  /* ---------- 4. Terminal typing ---------- */
  var termTokens = [
    { t: '$ ', cls: 'p' }, { t: 'bash <(curl -fsSL https://raw.githubusercontent.com/haierkeys/fast-note-sync-service/master/scripts/quest_install.sh)', cls: 'cmd' }, { t: '\n', cls: '' },
    { t: '✓ ', cls: 'p' }, { t: '检测到 macOS (arm64)', cls: 'out' }, { t: '\n', cls: '' },
    { t: '✓ ', cls: 'p' }, { t: '下载 Release 二进制', cls: 'out' }, { t: '\n', cls: '' },
    { t: '✓ ', cls: 'p' }, { t: '安装到 /opt/fast-note', cls: 'out' }, { t: '\n', cls: '' },
    { t: '✓ ', cls: 'p' }, { t: '注册 Launchd 服务', cls: 'out' }, { t: '\n', cls: '' },
    { t: '$ ', cls: 'p' }, { t: 'fns', cls: 'cmd' }, { t: '\n', cls: '' },
    { t: '→ 进入交互式管理菜单', cls: 'out' }
  ];
  var termTarget = $('#term-target');
  var termStarted = false;
  function startTerm() {
    if (termStarted || !termTarget) return;
    termStarted = true;
    typeInto(termTarget, termTokens, 60);
  }
  if ('IntersectionObserver' in window) {
    var termWatch = termTarget ? termTarget.closest('.terminal') : null;
    var tio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { startTerm(); tio.disconnect(); }
      });
    }, { threshold: 0.2 });
    if (termWatch) tio.observe(termWatch);
    else startTerm();
  } else { startTerm(); }

  /* ---------- 5. Code syntax highlight ---------- */
  function highlight(el) {
    var raw = el.textContent;
    var out = '';
    var i = 0;
    while (i < raw.length) {
      var c = raw[i];
      // comment
      if (c === '#' || (c === '/' && raw[i + 1] === '/')) {
        var j = i;
        while (j < raw.length && raw[j] !== '\n') j++;
        out += '<span class="c">' + escapeHtml(raw.slice(i, j)) + '</span>';
        i = j; continue;
      }
      // string
      if (c === '"' || c === "'") {
        var q = c, k = i + 1;
        while (k < raw.length && raw[k] !== q) k++;
        k++;
        var after = raw.slice(k);
        var isKey = /^\s*:/.test(after);
        out += '<span class="' + (isKey ? 'k' : 's') + '">' + escapeHtml(raw.slice(i, k)) + '</span>';
        i = k; continue;
      }
      // number
      if (/[0-9]/.test(c)) {
        var m = i;
        while (m < raw.length && /[0-9.]/.test(raw[m])) m++;
        out += '<span class="n">' + escapeHtml(raw.slice(i, m)) + '</span>';
        i = m; continue;
      }
      // word / keyword
      if (/[A-Za-z_]/.test(c)) {
        var w = i;
        while (w < raw.length && /[\w-]/.test(raw[w])) w++;
        var word = raw.slice(i, w);
        var isKw = ['const', 'let', 'new', 'return', 'true', 'false', 'null', 'POST', 'GET', 'PUT', 'DELETE', 'Bearer', 'curl'].indexOf(word) !== -1;
        out += isKw ? ('<span class="k">' + escapeHtml(word) + '</span>') : escapeHtml(word);
        i = w; continue;
      }
      out += escapeHtml(c); i++;
    }
    el.innerHTML = out;
  }
  $$('.code-snippet').forEach(highlight);

  /* ---------- 6. Code tabs ---------- */
  var tabs = $$('.code-tab');
  var snippets = $$('.code-snippet');
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      var name = tab.getAttribute('data-tab');
      tabs.forEach(function (t) {
        var on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      snippets.forEach(function (sn) {
        sn.hidden = sn.getAttribute('data-code') !== name;
      });
    });
  });

  /* ---------- 7. Realtime sync demo ---------- */
  var input = $('#sync-input');
  var output = $('#sync-output');
  var demoAuto = true;
  var demoText = '在这里写点什么，右侧会实时同步。\n\n毫秒级推送，没有保存按钮。';
  var demoIdx = 0;
  var demoTimer = null;

  function mirror() {
    var txt = input.textContent;
    var esc = escapeHtml(txt);
    // highlight last 3 chars
    var head = esc.slice(0, Math.max(0, esc.length - 3));
    var tail = esc.slice(Math.max(0, esc.length - 3));
    output.innerHTML = head + (tail ? '<span class="hl">' + tail + '</span>' : '');
  }

  if (input && output) {
    input.addEventListener('input', function () {
      demoAuto = false;
      if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
      mirror();
    });
    input.addEventListener('focus', function () {
      demoAuto = false;
      if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
    });

    if (!reduceMotion) {
      input.textContent = '';
      demoTimer = setInterval(function () {
        if (!demoAuto) { clearInterval(demoTimer); return; }
        if (demoIdx <= demoText.length) {
          input.textContent = demoText.slice(0, demoIdx);
          demoIdx++;
          mirror();
        } else {
          clearInterval(demoTimer);
          setTimeout(function () {
            if (!demoAuto) return;
            demoIdx = 0;
            input.textContent = '';
            demoTimer = setInterval(arguments.callee, 70);
          }, 2600);
        }
      }, 70);
    } else {
      input.textContent = demoText;
      mirror();
    }
  }

  /* ---------- 8. Copy install command ---------- */
  var copyBtn = $('#copy-install');
  if (copyBtn) {
    var installCmd = "bash <(curl -fsSL https://raw.githubusercontent.com/haierkeys/fast-note-sync-service/master/scripts/quest_install.sh)";
    copyBtn.addEventListener('click', function (e) {
      e.preventDefault();
      var done = function () {
        var code = copyBtn.querySelector('code');
        var prev = code.textContent;
        code.textContent = '已复制 ✓';
        setTimeout(function () { code.textContent = prev; }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(installCmd).then(done).catch(done);
      } else {
        var ta = document.createElement('textarea');
        ta.value = installCmd;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (err) {}
        document.body.removeChild(ta);
        done();
      }
    });
  }

  /* ---------- 9. Mobile menu ---------- */
  var burger = $('.nav-burger');
  var navLinks = $('.nav-links');
  if (burger && navLinks) {
    burger.addEventListener('click', function () {
      var open = navLinks.classList.toggle('open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.classList.toggle('is-open', open);
    });
    $$('.nav-links a').forEach(function (a) {
      a.addEventListener('click', function () {
        navLinks.classList.remove('open');
        burger.classList.remove('is-open');
        burger.setAttribute('aria-expanded', 'false');
      });
    });
  }
})();
