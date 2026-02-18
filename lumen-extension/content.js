console.log('Lumen content script loaded');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === 'extractText') {
    const result = extractFromPage();
    sendResponse(result);
  }
  return true;
});

function extractFromPage() {
  const url = location.href;

  try {
    const clone = document.cloneNode(true);
    const article = new Readability(clone).parse();
    if (article && article.textContent && article.textContent.trim().length > 200) {
      return {
        title: article.title || document.title,
        text: cleanText(article.textContent.trim()),
        url: url
      };
    }
  } catch (e) {
    console.warn('Lumen: Readability failed', e);
  }

  const selectors = ['article', '[role="article"]', '.post-content', '.article-content', '.entry-content', 'main'];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText && el.innerText.trim().length > 200) {
      return {
        title: document.title,
        text: cleanText(el.innerText.trim()),
        url: url
      };
    }
  }

  return {
    title: document.title,
    text: cleanText(document.body.innerText.trim()),
    url: url
  };
}

function cleanText(text) {
  let cleaned = text.replace(/\n{3,}/g, '\n\n');
  if (cleaned.length > 50000) {
    cleaned = cleaned.slice(0, 50000) + '\n\n[文本已截断]';
  }
  return cleaned;
}
