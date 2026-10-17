const ids = ['serverUrl', 'token', 'defaultVault', 'folder'];
const get = (id) => document.getElementById(id);
(async () => { const values = await chrome.storage.sync.get({ serverUrl: '', token: '', defaultVault: '', folder: 'Clips' }); ids.forEach((id) => { get(id).value = values[id]; }); })();
get('save').addEventListener('click', async () => { const values = Object.fromEntries(ids.map((id) => [id, get(id).value.trim()])); values.serverUrl = values.serverUrl.replace(/\/$/, ''); await chrome.storage.sync.set(values); get('status').textContent = '已保存'; setTimeout(() => { get('status').textContent = ''; }, 1800); });
