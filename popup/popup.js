// Scroll Stopper — Popup Script (popup.js)
// Manages the settings UI and syncs with chrome.storage.

document.addEventListener('DOMContentLoaded', async () => {
  // ─── DOM References ─────────────────────────────────────────────────
  const masterToggle = document.getElementById('master-toggle');
  const scrollLimitInput = document.getElementById('scroll-limit');
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
  let currentBonus = 0;

  async function loadSettings() {
    const data = await chrome.storage.sync.get('settings');
    settings = data.settings ?? DEFAULT_SETTINGS;
    applySettingsToUI();
  }

  function applySettingsToUI() {
    masterToggle.checked = settings.enabled;
    scrollLimitInput.value = settings.scrollLimit;
    strictToggle.checked = settings.strictMode;
    sessionLimit.textContent = settings.scrollLimit + currentBonus;

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
      currentBonus = response?.bonus ?? 0;
      updateSessionDisplay(count, currentBonus);
    } catch (err) {
      console.warn('[Scroll Stopper] Failed to load session count:', err);
      updateSessionDisplay(0, 0);
    }
  }

  function updateSessionDisplay(count, bonus = currentBonus) {
    currentBonus = bonus;
    const effectiveLimit = settings.scrollLimit + currentBonus;
    sessionCount.textContent = count;
    sessionLimit.textContent = effectiveLimit;

    const ratio = count / effectiveLimit;
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

  scrollLimitInput.addEventListener('input', () => {
    // Live-update the session display as the user types
    const raw = parseInt(scrollLimitInput.value, 10);
    if (!isNaN(raw) && raw >= 1) {
      sessionLimit.textContent = raw + currentBonus;
    }
  });

  scrollLimitInput.addEventListener('change', async () => {
    let value = parseInt(scrollLimitInput.value, 10);
    if (isNaN(value) || value < 1) value = 1;
    if (value > 999) value = 999;
    scrollLimitInput.value = value;
    settings.scrollLimit = value;
    sessionLimit.textContent = value + currentBonus;
    await saveSettings();
    loadSessionCount();
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

      currentBonus = 0;
      updateSessionDisplay(0, 0);
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
