const $ = (id) => document.getElementById(id);
let page = null;

function setError(message = '') { $('error').textContent = message; }
function safePath(title, folder = 'Clips') {
  return `${folder.replace(/^\/+|\/+$/g, '') || 'Clips'}/${(title || '未命名页面').replace(/[\\/:*?"<>|]+/g, ' ').trim() || '未命名页面'}.md`;
}
function apiUrl(base, path) { return `${base.replace(/\/$/, '')}${path}`; }

async function load() {
  const settings = await chrome.storage.sync.get({ serverUrl: '', token: '', defaultVault: '', folder: 'Clips' });
  window.clipFolder = settings.folder || 'Clips';
  if (!settings.serverUrl || !settings.token) {
    $('status').textContent = '请先完成连接设置';
    $('options').focus();
  }
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { type: 'extract-page' }).then(fill).catch(() => {
      // The content script is also queried through scripting for restricted pages.
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).then(() => chrome.tabs.sendMessage(tab.id, { type: 'extract-page' })).then(fill).catch(() => {
        fill({ title: tab.title || '', url: tab.url || '', content: '' });
      });
    });
  });
  try {
    const response = await fetch(apiUrl(settings.serverUrl, '/api/vault'), { headers: { Authorization: settings.token } });
    const payload = await response.json();
    if (!response.ok || payload.status === false) throw new Error(payload.message || `Vault 加载失败（${response.status}）`);
    const vaults = Array.isArray(payload.data) ? payload.data : [];
    // Vault API returns the name in `vault` (not `name`). Keep the fallback for older servers.
    const names = vaults.map((v) => v.vault || v.name).filter(Boolean);
    $('vault').replaceChildren(...names.map((name) => new Option(name, name)));
    const preferred = settings.defaultVault && names.includes(settings.defaultVault) ? settings.defaultVault : names[0] || '';
    if (preferred) {
      $('vault').value = preferred;
      if (preferred !== settings.defaultVault) await chrome.storage.sync.set({ defaultVault: preferred });
    }
    if (!names.length) $('vault').replaceChildren(new Option('没有可用 Vault', ''));
  } catch (_) {
    $('vault').replaceChildren(new Option(settings.defaultVault || '无法加载 Vault', settings.defaultVault || ''));
  }
}
function fill(data) {
  page = data; $('title').value = data.title || ''; $('path').value = safePath(data.title, window.clipFolder || 'Clips'); $('content').value = data.content || '';
  $('status').textContent = data.selection ? '已读取选中文本' : '已读取网页正文';
}

$('title').addEventListener('input', () => { if (!$('path').dataset.edited) $('path').value = safePath($('title').value, window.clipFolder || 'Clips'); });
$('path').addEventListener('input', () => { $('path').dataset.edited = 'true'; });
$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('save').addEventListener('click', async () => {
  setError(''); const settings = await chrome.storage.sync.get({ serverUrl: '', token: '' });
  const vault = $('vault').value.trim(); const path = $('path').value.trim();
  if (!settings.serverUrl || !settings.token) return setError('请先在“设置”中填写服务地址和 Token。');
  if (!vault || !path) return setError('Vault 和保存路径不能为空。');
  $('save').disabled = true; $('status').textContent = '正在保存…';
  try {
    const content = `${$('content').value.trim()}\n\n---\n来源：${page?.url || ''}`;
    const response = await fetch(apiUrl(settings.serverUrl, '/api/note'), { method: 'POST', headers: { Authorization: settings.token, 'Content-Type': 'application/json', 'X-Client': 'browser-extension', 'X-Client-Name': 'Fast Note Sync 剪藏' }, body: JSON.stringify({ vault, path, content }) });
    const payload = await response.json();
    if (!response.ok || payload.status === false || (typeof payload.code === 'number' && payload.code === 0)) throw new Error(payload.message || `保存失败（${response.status}）`);
    $('status').textContent = '保存成功 ✓';
  } catch (error) { $('status').textContent = '保存失败'; setError(error.message || '网络请求失败，请检查设置。'); }
  finally { $('save').disabled = false; }
});
load();
