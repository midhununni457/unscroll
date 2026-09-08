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
          if (tabId == null) {
            sendResponse({ error: 'No tab id' });
            break;
          }

          const count = message.count ?? 0;
          const bonus = message.bonus ?? 0;
          const countKey = `tab_${tabId}_count`;
          const bonusKey = `tab_${tabId}_bonus`;
          await chrome.storage.session.set({
            [countKey]: count,
            [bonusKey]: bonus,
          });

          // Update badge with current count
          const { settings = DEFAULT_SETTINGS } = await chrome.storage.sync.get('settings');
          const effectiveLimit = settings.scrollLimit + bonus;
          const badgeText = count > 0 ? String(count) : '';

          await chrome.action.setBadgeText({ text: badgeText, tabId });
          await chrome.action.setBadgeTextColor({ color: '#FFFFFF', tabId });

          // Color the badge based on proximity to the effective limit
          const ratio = count / effectiveLimit;
          let color;
          if (ratio < 0.5) color = '#4CAF50';       // Green — plenty left
          else if (ratio < 0.8) color = '#FF9800';   // Orange — getting close
          else color = '#F44336';                     // Red — at or near limit

          await chrome.action.setBadgeBackgroundColor({ color, tabId });

          // Also keep default badge in sync if this tab is active
          try {
            const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            if (activeTab && activeTab.id === tabId) {
              await chrome.action.setBadgeText({ text: badgeText });
              await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
              await chrome.action.setBadgeBackgroundColor({ color });
            }
          } catch (e) { /* ignore */ }

          sendResponse({ success: true });
          break;
        }

        case 'LIMIT_REACHED': {
          const tabId = sender.tab?.id;
          if (tabId == null) {
            sendResponse({ error: 'No tab id' });
            break;
          }

          await chrome.action.setBadgeText({ text: '!', tabId });
          await chrome.action.setBadgeTextColor({ color: '#FFFFFF', tabId });
          await chrome.action.setBadgeBackgroundColor({ color: '#F44336', tabId });

          try {
            const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            if (activeTab && activeTab.id === tabId) {
              await chrome.action.setBadgeText({ text: '!' });
              await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
              await chrome.action.setBadgeBackgroundColor({ color: '#F44336' });
            }
          } catch (e) { /* ignore */ }

          sendResponse({ success: true });
          break;
        }

        case 'GET_TAB_COUNT': {
          let tabId = sender.tab?.id ?? message.tabId;
          if (tabId == null) {
            try {
              const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
              tabId = activeTab?.id;
            } catch (e) {}
          }
          if (tabId == null) { sendResponse({ count: 0, bonus: 0 }); break; }

          const countKey = `tab_${tabId}_count`;
          const bonusKey = `tab_${tabId}_bonus`;
          const data = await chrome.storage.session.get([countKey, bonusKey]);
          sendResponse({
            count: data[countKey] ?? 0,
            bonus: data[bonusKey] ?? 0,
          });
          break;
        }

        case 'RESET_COUNT': {
          const tabId = sender.tab?.id ?? message.tabId;
          if (tabId == null) break;

          const countKey = `tab_${tabId}_count`;
          const bonusKey = `tab_${tabId}_bonus`;
          await chrome.storage.session.set({ [countKey]: 0, [bonusKey]: 0 });
          await chrome.action.setBadgeText({ text: '', tabId });

          try {
            await chrome.action.setBadgeText({ text: '' });
          } catch (e) {}

          // Forward reset to content script if active on this tab
          try {
            chrome.tabs.sendMessage(tabId, { type: 'RESET_COUNT' }).catch(() => {});
          } catch (err) { /* tab may not have content script */ }

          sendResponse({ success: true });
          break;
        }

        case 'LEFT_SHORTS': {
          // User navigated away from Shorts — clear badge and reset count/bonus
          const tabId = sender.tab?.id;
          if (tabId == null) {
            sendResponse({ success: true });
            break;
          }

          const countKey = `tab_${tabId}_count`;
          const bonusKey = `tab_${tabId}_bonus`;
          await chrome.storage.session.set({ [countKey]: 0, [bonusKey]: 0 });
          await chrome.action.setBadgeText({ text: '', tabId });

          try {
            const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            if (activeTab && activeTab.id === tabId) {
              await chrome.action.setBadgeText({ text: '' });
            }
          } catch (e) {}

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
  const countKey = `tab_${tabId}_count`;
  const bonusKey = `tab_${tabId}_bonus`;
  await chrome.storage.session.remove([countKey, bonusKey]);
});

// ─── Restore badge when user switches tabs ───────────────────────────
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tabId = activeInfo.tabId;
  const countKey = `tab_${tabId}_count`;
  const bonusKey = `tab_${tabId}_bonus`;
  const data = await chrome.storage.session.get([countKey, bonusKey]);
  const count = data[countKey];
  const bonus = data[bonusKey] ?? 0;

  if (count != null && count > 0) {
    const { settings = DEFAULT_SETTINGS } = await chrome.storage.sync.get('settings');
    const effectiveLimit = settings.scrollLimit + bonus;
    const ratio = count / effectiveLimit;
    let color;
    if (ratio < 0.5) color = '#4CAF50';
    else if (ratio < 0.8) color = '#FF9800';
    else color = '#F44336';

    const text = String(count);
    await chrome.action.setBadgeText({ text, tabId });
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeTextColor({ color: '#FFFFFF', tabId });
    await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
    await chrome.action.setBadgeBackgroundColor({ color, tabId });
    await chrome.action.setBadgeBackgroundColor({ color });
  } else {
    await chrome.action.setBadgeText({ text: '', tabId });
    await chrome.action.setBadgeText({ text: '' });
  }
});
