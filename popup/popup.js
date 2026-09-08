// Scroll Stopper — Popup Script (popup.js)
// Manages the settings UI and syncs with chrome.storage.

document.addEventListener('DOMContentLoaded', async () => {
  // ─── DOM References ─────────────────────────────────────────────────
  const masterToggle = document.getElementById('master-toggle');
  const scrollLimitSlider = document.getElementById('scroll-limit');
  const scrollLimitValue = document.getElementById('scroll-limit-value');
  const strictToggle = document.getElementById('strict-toggle');
  const sessionCount = document.getElementById('session-count');
  const sessionLimit = document.getElementById('session-limit');
  const sessionBar = document.getElementById('session-bar');
  const resetBtn = document.getElementById('reset-btn');

  // ─── Load Current Settings ──────────────────────────────────────────
  const DEFAULT_SETTINGS = {
    scrollLimit: 20,
    strictMode: false,
    enabled: true,
  };

  let settings = DEFAULT_SETTINGS;

  async function loadSettings() {
    const data = await chrome.storage.sync.get('settings');
    settings = data.settings ?? DEFAULT_SETTINGS;
    applySettingsToUI();
  }

  function applySettingsToUI() {
    masterToggle.checked = settings.enabled;
    scrollLimitSlider.value = settings.scrollLimit;
    scrollLimitValue.textContent = settings.scrollLimit;
    strictToggle.checked = settings.strictMode;
    sessionLimit.textContent = settings.scrollLimit;

    if (!settings.enabled) {
      document.body.classList.add('disabled');
    } else {
      document.body.classList.remove('disabled');
    }
  }

  async function saveSettings() {
    await chrome.storage.sync.set({ settings });
  }

  // ─── Load Session Count ─────────────────────────────────────────────
  async function loadSessionCount() {
    try {
      // Get the active tab to query its count
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;

      const response = await chrome.runtime.sendMessage({
        type: 'GET_TAB_COUNT',
        tabId: tab.id,
      });

      const count = response?.count ?? 0;
      updateSessionDisplay(count);
    } catch (err) {
      console.warn('[Scroll Stopper] Failed to load session count:', err);
      updateSessionDisplay(0);
    }
  }

  function updateSessionDisplay(count) {
    sessionCount.textContent = count;
    sessionLimit.textContent = settings.scrollLimit;

    const ratio = count / settings.scrollLimit;
    const percentage = Math.min(ratio * 100, 100);

    // Update progress bar
    sessionBar.style.width = `${percentage}%`;
    sessionBar.classList.remove('warning', 'danger');
    sessionCount.classList.remove('warning', 'danger');

    if (ratio >= 1) {
      sessionBar.classList.add('danger');
      sessionCount.classList.add('danger');
    } else if (ratio >= 0.7) {
      sessionBar.classList.add('warning');
      sessionCount.classList.add('warning');
    }
  }

  // ─── Event Listeners ───────────────────────────────────────────────
  masterToggle.addEventListener('change', async () => {
    settings.enabled = masterToggle.checked;
    await saveSettings();
    applySettingsToUI();
  });

  scrollLimitSlider.addEventListener('input', () => {
    const value = parseInt(scrollLimitSlider.value, 10);
    scrollLimitValue.textContent = value;
    sessionLimit.textContent = value;
    settings.scrollLimit = value;

    // Live-update the progress bar
    loadSessionCount();
  });

  scrollLimitSlider.addEventListener('change', async () => {
    settings.scrollLimit = parseInt(scrollLimitSlider.value, 10);
    await saveSettings();
  });

  strictToggle.addEventListener('change', async () => {
    settings.strictMode = strictToggle.checked;
    await saveSettings();
  });

  resetBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;

      await chrome.runtime.sendMessage({
        type: 'RESET_COUNT',
        tabId: tab.id,
      });

      updateSessionDisplay(0);
    } catch (err) {
      console.warn('[Scroll Stopper] Failed to reset count:', err);
    }
  });

  // ─── Live Sync (settings changed from another source) ──────────────
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes.settings) {
      const newSettings = changes.settings.newValue;
      if (newSettings) {
        settings = newSettings;
        applySettingsToUI();
      }
    }

    if (areaName === 'session') {
      // Session count might have changed — refresh
      loadSessionCount();
    }
  });

  // ─── Initialize ────────────────────────────────────────────────────
  await loadSettings();
  await loadSessionCount();
});
