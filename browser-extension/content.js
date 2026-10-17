(function () {
  const clean = (value) => (value || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  function textToMarkdown(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll('script, style, noscript, template, svg, canvas, nav, footer, aside, form').forEach((node) => node.remove());
    clone.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
    clone.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((node) => {
      const level = Number(node.tagName.substring(1));
      node.prepend(`${'#'.repeat(level)} `);
      node.append('\n');
    });
    clone.querySelectorAll('li').forEach((node) => node.prepend('- '));
    clone.querySelectorAll('p,div,section,article,blockquote,pre,li').forEach((node) => node.append('\n'));
    return clean(clone.textContent);
  }

  function extract(selectionText = '', linkUrl = '') {
    const selected = clean(selectionText);
    const container = document.querySelector('article, main, [role="main"]') || document.body;
    const content = selected || textToMarkdown(container);
    return {
      title: clean(document.title) || location.hostname,
      url: location.href,
      content,
      selection: selected,
      linkUrl: linkUrl || ''
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'clip-request' && message?.type !== 'extract-page') return;
    sendResponse(extract(message.selectionText, message.linkUrl));
    return true;
  });
})();
