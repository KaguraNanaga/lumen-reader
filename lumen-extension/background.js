console.log('Lumen background loaded');

let pendingTabId = null;

async function extractAndAnalyze(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'extractText' });

    if (!response || !response.text) {
      chrome.runtime.sendMessage({ action: 'error', message: 'Cannot extract content from this page.' });
      return;
    }

    chrome.runtime.sendMessage({
      action: 'analyze',
      title: response.title,
      text: response.text,
      url: response.url
    });
  } catch (err) {
    console.error('Lumen extractAndAnalyze error:', err);
    chrome.runtime.sendMessage({ action: 'error', message: 'Extraction failed: ' + err.message });
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (!tab || !tab.id) {
      chrome.runtime.sendMessage({ action: 'error', message: 'Cannot access current tab.' });
      return;
    }

    pendingTabId = tab.id;
    await chrome.sidePanel.open({ tabId: tab.id });

    // Fallback: if sidepanel was already open it won't re-fire ready
    setTimeout(() => {
      if (pendingTabId === tab.id) {
        console.log('Lumen: fallback trigger after 1200ms');
        pendingTabId = null;
        extractAndAnalyze(tab.id);
      }
    }, 1200);
  } catch (err) {
    console.error('Lumen background error:', err);
    chrome.runtime.sendMessage({ action: 'error', message: 'Error: ' + err.message });
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || !msg.action) return;

  if (msg.action === 'sidepanelReady') {
    console.log('Lumen: sidepanel ready signal received');
    if (pendingTabId) {
      const tabId = pendingTabId;
      pendingTabId = null;
      extractAndAnalyze(tabId);
    }
    return;
  }

  if (msg.action === 'reanalyze') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) extractAndAnalyze(tabs[0].id);
    });
  }
});
