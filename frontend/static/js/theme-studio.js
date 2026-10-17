(function () {
  'use strict';

  var STORAGE_KEY = 'fns-custom-themes:v1';
  var ACTIVE_KEY = 'fns-custom-theme';
  var STYLE_ID = 'fns-custom-theme-style';
  var MAX_SIZE = 256 * 1024;
  var themes = readThemes();
  var activeId = readActiveId();
  var panel;

  injectStyles();
  restoreActiveTheme();
  window.setTimeout(addTrigger, 0);

  function readThemes() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (theme) {
        return theme && typeof theme.id === 'string' && typeof theme.name === 'string' && typeof theme.source === 'string';
      });
    } catch (_) {
      return [];
    }
  }

  function readActiveId() {
    try {
      return window.localStorage.getItem(ACTIVE_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function persist() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(themes));
      if (activeId) window.localStorage.setItem(ACTIVE_KEY, activeId);
      else window.localStorage.removeItem(ACTIVE_KEY);
    } catch (_) {
      notify('无法保存主题：浏览器存储空间不可用。', true);
    }
  }

  function restoreActiveTheme() {
    if (!activeId) return;
    var theme = findTheme(activeId);
    if (!theme) {
      activeId = '';
      persist();
      return;
    }
    applyTheme(theme);
  }

  function findTheme(id) {
    return themes.find(function (theme) { return theme.id === id; });
  }

  function applyTheme(theme) {
    var style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    var source = theme.source.replace(/^html,html\.light,html\.dark\{/i, 'html[data-color-scheme],html.light[data-color-scheme],html.dark[data-color-scheme]{');
    style.textContent = source;
    document.documentElement.setAttribute('data-custom-theme', theme.id);
  }

  function clearTheme() {
    var style = document.getElementById(STYLE_ID);
    if (style) style.remove();
    document.documentElement.removeAttribute('data-custom-theme');
  }

  function addTrigger() {
    if (!document.body || document.getElementById('fns-theme-studio-trigger')) return;
    var trigger = document.createElement('button');
    trigger.id = 'fns-theme-studio-trigger';
    trigger.type = 'button';
    trigger.setAttribute('aria-label', '打开主题工作室');
    trigger.title = '主题工作室';
    trigger.innerHTML = '<span aria-hidden="true">✦</span><span>主题</span>';
    trigger.addEventListener('click', function () {
      if (panel) closePanel();
      else openPanel();
    });
    document.body.appendChild(trigger);
  }

  function openPanel() {
    panel = document.createElement('div');
    panel.id = 'fns-theme-studio-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'fns-theme-studio-title');
    panel.innerHTML = '<div class="fns-theme-studio-backdrop"></div>' +
      '<section class="fns-theme-studio-card">' +
      '<header><div><p class="fns-theme-studio-eyebrow">CUSTOMIZATION</p><h2 id="fns-theme-studio-title">主题工作室</h2><p class="fns-theme-studio-subtitle">导入 CSS 或 JSON 主题，立即预览并切换。</p></div>' +
      '<button type="button" class="fns-theme-studio-close" aria-label="关闭">×</button></header>' +
      '<div class="fns-theme-studio-upload"><label class="fns-theme-studio-upload-button" for="fns-theme-studio-file">上传主题文件</label><input id="fns-theme-studio-file" type="file" accept=".css,.json,text/css,application/json"><span>支持 CSS / JSON，单文件不超过 256 KB</span></div>' +
      '<div class="fns-theme-studio-list" id="fns-theme-studio-list"></div>' +
      '<details class="fns-theme-studio-help"><summary>主题开发格式</summary><p>CSS 文件可以直接覆盖界面样式。JSON 文件用于定义颜色变量：</p><pre>{\n  "name": "我的主题",\n  "variables": {\n    "--background": "#101827",\n    "--foreground": "#e5edf8",\n    "--primary": "#7dd3fc"\n  }\n}</pre><button type="button" class="fns-theme-studio-export-template">下载 JSON 模板</button></details>' +
      '</section>';
    document.body.appendChild(panel);
    panel.querySelector('.fns-theme-studio-backdrop').addEventListener('click', closePanel);
    panel.querySelector('.fns-theme-studio-close').addEventListener('click', closePanel);
    panel.querySelector('#fns-theme-studio-file').addEventListener('change', importFile);
    panel.querySelector('.fns-theme-studio-export-template').addEventListener('click', exportTemplate);
    renderList();
    window.setTimeout(function () { panel.querySelector('.fns-theme-studio-close').focus(); }, 0);
    document.addEventListener('keydown', onKeyDown);
  }

  function closePanel() {
    if (!panel) return;
    panel.remove();
    panel = null;
    document.removeEventListener('keydown', onKeyDown);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') closePanel();
  }

  function renderList() {
    var list = panel.querySelector('#fns-theme-studio-list');
    var builtin = '<div class="fns-theme-studio-item ' + (!activeId ? 'is-active' : '') + '">' +
      '<button type="button" class="fns-theme-studio-select" data-theme-id=""><span class="fns-theme-studio-swatch builtin"></span><span><strong>系统主题</strong><small>使用顶部主题菜单的设置</small></span></button>' +
      (!activeId ? '<span class="fns-theme-studio-check">当前</span>' : '') + '</div>';
    list.innerHTML = builtin + themes.map(function (theme) {
      var active = theme.id === activeId;
      return '<div class="fns-theme-studio-item ' + (active ? 'is-active' : '') + '">' +
        '<button type="button" class="fns-theme-studio-select" data-theme-id="' + escapeHtml(theme.id) + '"><span class="fns-theme-studio-swatch" style="' + escapeHtml(swatchStyle(theme)) + '"></span><span><strong>' + escapeHtml(theme.name) + '</strong><small>' + (theme.type === 'json' ? 'JSON 变量主题' : 'CSS 样式主题') + '</small></span></button>' +
        '<span class="fns-theme-studio-actions">' + (active ? '<span class="fns-theme-studio-check">当前</span>' : '') + '<button type="button" class="fns-theme-studio-export" data-export-id="' + escapeHtml(theme.id) + '" title="导出主题">导出</button><button type="button" class="fns-theme-studio-delete" data-delete-id="' + escapeHtml(theme.id) + '" title="删除主题">删除</button></span>' +
        '</div>';
    }).join('');
    list.querySelectorAll('[data-theme-id]').forEach(function (button) {
      button.addEventListener('click', function () { selectTheme(button.getAttribute('data-theme-id') || ''); });
    });
    list.querySelectorAll('[data-export-id]').forEach(function (button) {
      button.addEventListener('click', function () { exportTheme(button.getAttribute('data-export-id')); });
    });
    list.querySelectorAll('[data-delete-id]').forEach(function (button) {
      button.addEventListener('click', function () { deleteTheme(button.getAttribute('data-delete-id')); });
    });
  }

  function selectTheme(id) {
    activeId = id;
    var theme = findTheme(id);
    if (theme) applyTheme(theme); else clearTheme();
    persist();
    renderList();
    notify(theme ? '已切换到「' + theme.name + '」' : '已恢复系统主题');
  }

  function importFile(event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_SIZE) {
      notify('主题文件不能超过 256 KB。', true);
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var imported = parseTheme(file, String(reader.result || ''));
        var existingIndex = themes.findIndex(function (theme) { return theme.id === imported.id; });
        if (existingIndex >= 0) themes.splice(existingIndex, 1);
        themes.push(imported);
        activeId = imported.id;
        applyTheme(imported);
        persist();
        renderList();
        notify('主题「' + imported.name + '」已导入并启用');
      } catch (error) {
        notify(error.message || '主题文件格式无效。', true);
      }
    };
    reader.readAsText(file);
  }

  function parseTheme(file, content) {
    var type = file.name.toLowerCase().endsWith('.json') ? 'json' : 'css';
    if (type === 'css') {
      if (!content.trim() || (!content.includes('{') && !content.includes('@'))) throw new Error('CSS 主题内容为空或格式无效。');
      return { id: makeId(file.name), name: cleanName(file.name), type: type, source: content, originalName: file.name };
    }
    var parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || !parsed.variables || typeof parsed.variables !== 'object') throw new Error('JSON 主题必须包含 variables 对象。');
    var variables = Object.keys(parsed.variables).filter(function (key) {
      return /^--[a-zA-Z0-9_-]+$/.test(key) && typeof parsed.variables[key] === 'string' && parsed.variables[key].trim();
    });
    if (!variables.length) throw new Error('JSON 主题至少需要一个 CSS 变量。');
    var declarations = variables.map(function (key) { return key + ':' + parsed.variables[key].trim() + ';'; }).join('');
    var source = 'html[data-color-scheme],html.light[data-color-scheme],html.dark[data-color-scheme]{' + declarations + '}';
    return { id: makeId(parsed.id || file.name), name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : cleanName(file.name), type: type, source: source, originalName: file.name, downloadContent: content };
  }

  function deleteTheme(id) {
    var theme = findTheme(id);
    if (!theme || !window.confirm('删除主题「' + theme.name + '」？')) return;
    themes = themes.filter(function (item) { return item.id !== id; });
    if (activeId === id) {
      activeId = '';
      clearTheme();
    }
    persist();
    renderList();
    notify('主题已删除');
  }

  function exportTheme(id) {
    var theme = findTheme(id);
    if (!theme) return;
    var content = theme.downloadContent || theme.source;
    var extension = theme.type === 'json' ? 'json' : 'css';
    download(content, cleanName(theme.name) + '.' + extension, theme.type === 'json' ? 'application/json' : 'text/css');
  }

  function exportTemplate() {
    download(JSON.stringify({ name: '我的主题', variables: { '--background': '#101827', '--foreground': '#e5edf8', '--primary': '#7dd3fc' } }, null, 2), 'fns-theme-template.json', 'application/json');
  }

  function download(content, filename, type) {
    var link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([content], { type: type }));
    link.download = filename;
    link.click();
    window.setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }

  function notify(message, isError) {
    var toast = document.createElement('div');
    toast.className = 'fns-theme-studio-toast' + (isError ? ' is-error' : '');
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(function () { toast.classList.add('is-visible'); }, 10);
    window.setTimeout(function () { toast.classList.remove('is-visible'); window.setTimeout(function () { toast.remove(); }, 220); }, 2600);
  }

  function makeId(value) {
    var base = String(value).toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'custom-theme';
    var id = base;
    var suffix = 2;
    while (findTheme(id) && id !== activeId) id = base + '-' + suffix++;
    return id;
  }

  function cleanName(value) {
    return String(value).replace(/\.[^.]+$/, '').replace(/[<>]/g, '').trim().slice(0, 64) || '未命名主题';
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, function (character) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]; });
  }

  function swatchStyle(theme) {
    var background = theme.source.match(/--background\s*:\s*([^;}]*)/i);
    var primary = theme.source.match(/--primary\s*:\s*([^;}]*)/i);
    return 'background:' + (background ? background[1].trim() : 'linear-gradient(135deg,#1f2937,#7dd3fc)') + ';border-color:' + (primary ? primary[1].trim() : '#7dd3fc');
  }

  function injectStyles() {
    var style = document.createElement('style');
    style.textContent = '#fns-theme-studio-trigger{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;align-items:center;gap:7px;padding:9px 13px;border:1px solid color-mix(in srgb,var(--border,#d1d5db) 80%,transparent);border-radius:999px;background:color-mix(in srgb,var(--background,#fff) 90%,transparent);color:var(--foreground,#111827);box-shadow:0 8px 28px #0002;backdrop-filter:blur(14px);font:600 12px/1 system-ui,sans-serif;cursor:pointer;transition:transform .2s,box-shadow .2s}#fns-theme-studio-trigger:hover{transform:translateY(-2px);box-shadow:0 12px 32px #0003}#fns-theme-studio-trigger span:first-child{font-size:16px;color:var(--primary,#2563eb)}#fns-theme-studio-panel{position:fixed;inset:0;z-index:2147483001;display:grid;place-items:center;padding:20px;font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e5edf8}.fns-theme-studio-backdrop{position:absolute;inset:0;background:#02061799;backdrop-filter:blur(4px)}.fns-theme-studio-card{position:relative;width:min(520px,100%);max-height:min(720px,calc(100vh - 40px));overflow:auto;padding:24px;border:1px solid #ffffff1f;border-radius:20px;background:#111827f5;box-shadow:0 24px 80px #0008}#fns-theme-studio-panel header{display:flex;justify-content:space-between;gap:18px;margin-bottom:22px}.fns-theme-studio-eyebrow{margin:0 0 5px;color:#7dd3fc;font-size:10px;font-weight:700;letter-spacing:.16em}.fns-theme-studio-card h2{margin:0;color:#f8fafc;font-size:23px;letter-spacing:-.03em}.fns-theme-studio-subtitle{margin:5px 0 0;color:#94a3b8;font-size:12px}.fns-theme-studio-close{width:32px;height:32px;border:0;border-radius:10px;background:#ffffff0d;color:#cbd5e1;font-size:22px;cursor:pointer}.fns-theme-studio-upload{display:flex;align-items:center;gap:12px;margin-bottom:18px;padding:13px;border:1px dashed #ffffff2e;border-radius:14px;background:#ffffff08}.fns-theme-studio-upload-button{padding:8px 12px;border-radius:9px;background:#7dd3fc;color:#082f49;font-weight:700;cursor:pointer;white-space:nowrap}.fns-theme-studio-upload input{display:none}.fns-theme-studio-upload span{color:#94a3b8;font-size:11px}.fns-theme-studio-list{display:grid;gap:8px}.fns-theme-studio-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px;border:1px solid #ffffff0d;border-radius:13px;background:#ffffff08}.fns-theme-studio-item.is-active{border-color:#7dd3fc88;background:#7dd3fc12}.fns-theme-studio-select{display:flex;align-items:center;gap:11px;min-width:0;border:0;background:transparent;color:#f8fafc;text-align:left;cursor:pointer}.fns-theme-studio-select span:last-child{display:grid;gap:2px}.fns-theme-studio-select strong{font-size:13px}.fns-theme-studio-select small{color:#94a3b8;font-size:11px}.fns-theme-studio-swatch{width:28px;height:28px;flex:none;border:2px solid #7dd3fc;border-radius:9px;background:linear-gradient(135deg,#1f2937,#7dd3fc)}.fns-theme-studio-swatch.builtin{background:linear-gradient(135deg,#f8fafc 0 50%,#1f2937 50%);border-color:#94a3b8}.fns-theme-studio-actions{display:flex;align-items:center;gap:7px}.fns-theme-studio-check{color:#7dd3fc;font-size:11px;font-weight:700}.fns-theme-studio-export,.fns-theme-studio-delete{padding:4px 6px;border:0;border-radius:6px;background:transparent;color:#94a3b8;font-size:11px;cursor:pointer}.fns-theme-studio-export:hover{color:#7dd3fc;background:#7dd3fc12}.fns-theme-studio-delete:hover{color:#fda4af;background:#fb718512}.fns-theme-studio-help{margin-top:18px;padding-top:14px;border-top:1px solid #ffffff12;color:#94a3b8;font-size:12px}.fns-theme-studio-help summary{color:#cbd5e1;cursor:pointer}.fns-theme-studio-help p{margin:12px 0 8px}.fns-theme-studio-help pre{overflow:auto;margin:0 0 12px;padding:12px;border-radius:10px;background:#020617;color:#bae6fd;font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}.fns-theme-studio-export-template{padding:7px 10px;border:1px solid #ffffff1f;border-radius:8px;background:transparent;color:#cbd5e1;font-size:11px;cursor:pointer}.fns-theme-studio-toast{position:fixed;left:50%;bottom:28px;z-index:2147483002;max-width:calc(100vw - 40px);padding:10px 14px;border:1px solid #ffffff20;border-radius:10px;background:#0f172aee;color:#e2e8f0;box-shadow:0 8px 30px #0005;font:12px/1.4 system-ui,sans-serif;opacity:0;transform:translate(-50%,10px);transition:opacity .2s,transform .2s}.fns-theme-studio-toast.is-visible{opacity:1;transform:translate(-50%,0)}.fns-theme-studio-toast.is-error{border-color:#fb718566;color:#fecdd3}@media(max-width:560px){#fns-theme-studio-trigger{right:12px;bottom:12px}.fns-theme-studio-card{padding:18px;border-radius:16px}.fns-theme-studio-upload{align-items:flex-start;flex-direction:column;gap:8px}.fns-theme-studio-actions{gap:3px}.fns-theme-studio-check{display:none}}';
    document.head.appendChild(style);
  }
}());
