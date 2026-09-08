// Scroll Stopper — Service Worker (background.js)
// Manages persistent settings in chrome.storage.sync and
// ephemeral session state in chrome.storage.session.
// All state is read on-demand — no global variables.

const DEFAULT_SETTINGS = {
  scrollLimit: 20,
  strictMode: false,
  enabled: true,
};

// ─── One-time initialization on install ───────────────────────────────
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
  }
});

// ─── Message handler (content script ↔ service worker) ───────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case 'GET_SETTINGS': {
          const { settings = DEFAULT_SETTINGS } = await chrome.storage.sync.get('settings');
          sendResponse({ settings });
          break;
        }

        case 'SCROLL_COUNT_UPDATE': {
          const tabId = sender.tab?.id;
          if (tabId == null) break;

          // Store per-tab scroll count in session storage
          const key = `tab_${tabId}_count`;
          await chrome.storage.session.set({ [key]: message.count });

          // Update badge with current count
          const { settings = DEFAULT_SETTINGS } = await chrome.storage.sync.get('settings');
          const remaining = settings.scrollLimit - message.count;

          await chrome.action.setBadgeText({
            text: String(message.count),
            tabId,
          });

          // Color the badge based on proximity to the limit
          const ratio = message.count / settings.scrollLimit;
          let color;
          if (ratio < 0.5) color = '#4CAF50';       // Green — plenty left
          else if (ratio < 0.8) color = '#FF9800';   // Orange — getting close
          else color = '#F44336';                     // Red — at or near limit

          await chrome.action.setBadgeBackgroundColor({ color, tabId });
          sendResponse({ success: true });
          break;
        }

        case 'LIMIT_REACHED': {
          const tabId = sender.tab?.id;
          if (tabId == null) break;

          await chrome.action.setBadgeText({ text: '!', tabId });
          await chrome.action.setBadgeBackgroundColor({ color: '#F44336', tabId });
          sendResponse({ success: true });
          break;
        }

        case 'GET_TAB_COUNT': {
          const tabId = sender.tab?.id ?? message.tabId;
          if (tabId == null) { sendResponse({ count: 0 }); break; }

          const key = `tab_${tabId}_count`;
          const data = await chrome.storage.session.get(key);
          sendResponse({ count: data[key] ?? 0 });
          break;
        }

        case 'RESET_COUNT': {
          const tabId = sender.tab?.id ?? message.tabId;
          if (tabId == null) break;

          const key = `tab_${tabId}_count`;
          await chrome.storage.session.set({ [key]: 0 });
          await chrome.action.setBadgeText({ text: '', tabId });
          sendResponse({ success: true });
          break;
        }

        case 'LEFT_SHORTS': {
          // User navigated away from Shorts — clear badge and reset count
          const tabId = sender.tab?.id;
          if (tabId == null) break;

          const key = `tab_${tabId}_count`;
          await chrome.storage.session.set({ [key]: 0 });
          await chrome.action.setBadgeText({ text: '', tabId });
          sendResponse({ success: true });
          break;
        }

        default:
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (err) {
      console.error('[Scroll Stopper] Service worker error:', err);
      sendResponse({ error: err.message });
    }
  })();
  return true; // Keep the message channel open for async sendResponse
});

// ─── Tab cleanup — remove session data when a tab is closed ──────────
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const key = `tab_${tabId}_count`;
  await chrome.storage.session.remove(key);
});

// ─── Clear badge when user switches away from a Shorts tab ───────────
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // We don't clear the badge here — the content script will handle
  // updating state when the tab becomes visible. The badge persists
  // per-tab automatically via Chrome's tabId-scoped badge API.
});
