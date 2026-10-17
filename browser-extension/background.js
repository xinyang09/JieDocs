const MENU_ID = 'fast-note-sync-clip';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: '剪藏到 Fast Note Sync',
    contexts: ['page', 'selection', 'link']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, {
    type: 'clip-request',
    selectionText: info.selectionText || '',
    linkUrl: info.linkUrl || ''
  }).catch(() => {
    // Some browser pages (chrome://, store pages) do not allow content scripts.
  });
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'clip-page') return;
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'clip-request' }).catch(() => {});
  });
});
