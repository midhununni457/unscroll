// Scroll Stopper — Content Script (content.js)
// Detects YouTube Shorts navigation, counts shorts viewed,
// and injects a blocking overlay when the limit is reached.

(function () {
  'use strict';

  // ─── State ───────────────────────────────────────────────────────────
  let currentShortId = null;
  let scrollCount = 0;
  let settings = { scrollLimit: 20, strictMode: false, enabled: true };
  let isOnShorts = false;
  let overlayInjected = false;
  let urlCheckInterval = null;
  let temporaryBonus = 0; // Extra shorts allowed from "5 more" button

  // ─── Initialization ─────────────────────────────────────────────────
  async function init() {
    await loadSettings();
    checkIfOnShorts();

    // Listen for YouTube SPA navigation events
    document.addEventListener('yt-navigate-finish', onYtNavigate);
    document.addEventListener('yt-navigate-start', onYtNavigateStart);

    // Handle browser back/forward navigation
    window.addEventListener('popstate', onPopState);

    // Intercept history.pushState/replaceState (YouTube uses these for SPA nav)
    interceptHistoryMethods();

    // Handle tab visibility changes (user switching tabs)
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Fallback: poll URL for changes (some YT navigations don't fire events)
    startUrlPolling();

    // Listen for settings changes in real-time
    chrome.storage.onChanged.addListener(onStorageChanged);
  }

  async function loadSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (response?.settings) {
        settings = response.settings;
      }
    } catch (err) {
      console.warn('[Scroll Stopper] Failed to load settings:', err);
    }
  }

  // ─── URL / Navigation Detection ─────────────────────────────────────
  function extractShortId(url) {
    const match = url.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  function checkIfOnShorts() {
    const shortId = extractShortId(window.location.pathname);
    const wasOnShorts = isOnShorts;
    isOnShorts = shortId !== null;

    if (isOnShorts && !wasOnShorts) {
      // Just entered Shorts
      onEnterShorts(shortId);
    } else if (!isOnShorts && wasOnShorts) {
      // Just left Shorts
      onLeaveShorts();
    } else if (isOnShorts && shortId !== currentShortId) {
      // Navigated to a different short
      onNewShort(shortId);
    }
  }

  function onYtNavigate() {
    checkIfOnShorts();
  }

  function onYtNavigateStart() {
    // Early detection — YouTube fires this before navigation completes
    // We use it alongside yt-navigate-finish for speed
  }

  function onPopState() {
    // Browser back/forward button pressed
    checkIfOnShorts();
  }

  function onVisibilityChange() {
    // When user switches back to this tab, re-check state
    if (document.visibilityState === 'visible' && isOnShorts) {
      // Re-verify we're still on shorts (URL may have changed)
      checkIfOnShorts();
    }
  }

  function interceptHistoryMethods() {
    // YouTube uses pushState/replaceState for SPA navigation.
    // We monkey-patch these to detect URL changes immediately.
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      // Defer check to next microtask so the URL has updated
      Promise.resolve().then(() => checkIfOnShorts());
    };

    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      Promise.resolve().then(() => checkIfOnShorts());
    };
  }

  function startUrlPolling() {
    let lastUrl = window.location.href;
    urlCheckInterval = setInterval(() => {
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        checkIfOnShorts();
      }
    }, 500);
  }

  // ─── Shorts Lifecycle ───────────────────────────────────────────────
  function onEnterShorts(shortId) {
    currentShortId = shortId;
    scrollCount = 0;
    temporaryBonus = 0;
    attachScrollListeners();
    reportCount();
  }

  function onLeaveShorts() {
    currentShortId = null;
    scrollCount = 0;
    temporaryBonus = 0;
    isOnShorts = false;
    detachScrollListeners();
    removeOverlay();

    try {
      chrome.runtime.sendMessage({ type: 'LEFT_SHORTS' });
    } catch (err) {
      // Extension context may be invalidated
    }
  }

  function onNewShort(shortId) {
    if (!settings.enabled) return;

    currentShortId = shortId;
    scrollCount++;
    reportCount();

    const effectiveLimit = settings.scrollLimit + temporaryBonus;
    if (scrollCount >= effectiveLimit) {
      showOverlay();
    }
  }

  async function reportCount() {
    try {
      await chrome.runtime.sendMessage({
        type: 'SCROLL_COUNT_UPDATE',
        count: scrollCount,
      });
    } catch (err) {
      // Extension context may be invalidated on update/reload
    }
  }

  // ─── Scroll Detection ───────────────────────────────────────────────
  // YouTube Shorts uses a vertical scroll-snap container. We detect
  // navigation to a new short primarily via URL changes. But we also
  // listen for scroll/touch/key events to catch cases where the URL
  // hasn't updated yet (e.g., rapid swiping).

  let scrollDebounceTimer = null;
  let lastScrollTime = 0;

  function onWheelEvent(e) {
    if (!settings.enabled || !isOnShorts) return;

    const effectiveLimit = settings.scrollLimit + temporaryBonus;
    if (scrollCount >= effectiveLimit && overlayInjected) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function onTouchMoveEvent(e) {
    if (!settings.enabled || !isOnShorts) return;

    const effectiveLimit = settings.scrollLimit + temporaryBonus;
    if (scrollCount >= effectiveLimit && overlayInjected) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function onKeyDownEvent(e) {
    if (!settings.enabled || !isOnShorts) return;

    const scrollKeys = ['ArrowDown', 'ArrowUp', 'j', 'k', ' '];
    if (!scrollKeys.includes(e.key)) return;

    const effectiveLimit = settings.scrollLimit + temporaryBonus;
    if (scrollCount >= effectiveLimit && overlayInjected) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function attachScrollListeners() {
    document.addEventListener('wheel', onWheelEvent, { capture: true, passive: false });
    document.addEventListener('touchmove', onTouchMoveEvent, { capture: true, passive: false });
    document.addEventListener('keydown', onKeyDownEvent, { capture: true });
  }

  function detachScrollListeners() {
    document.removeEventListener('wheel', onWheelEvent, { capture: true });
    document.removeEventListener('touchmove', onTouchMoveEvent, { capture: true });
    document.removeEventListener('keydown', onKeyDownEvent, { capture: true });
  }

  // ─── Overlay UI (Shadow DOM) ────────────────────────────────────────
  const MOTIVATIONAL_MESSAGES = [
    { emoji: '🌿', text: 'Go touch some grass' },
    { emoji: '🧠', text: 'Your brain will thank you' },
    { emoji: '🌍', text: 'The real world misses you' },
    { emoji: '☀️', text: 'There\'s a whole world outside' },
    { emoji: '📖', text: 'Maybe read a book instead?' },
    { emoji: '🏃', text: 'Time to stretch those legs' },
    { emoji: '💤', text: 'Your eyes need a break' },
    { emoji: '🎯', text: 'Stay focused on what matters' },
    { emoji: '⏰', text: 'Time flies when you\'re scrolling' },
    { emoji: '✨', text: 'You have better things to do' },
  ];

  function getRandomMessage() {
    return MOTIVATIONAL_MESSAGES[Math.floor(Math.random() * MOTIVATIONAL_MESSAGES.length)];
  }

  function showOverlay() {
    if (overlayInjected) return;
    overlayInjected = true;

    // Block page-level scrolling
    document.documentElement.classList.add('scroll-stopper-blocked');

    // Report limit reached to service worker
    try {
      chrome.runtime.sendMessage({ type: 'LIMIT_REACHED' });
    } catch (err) { /* ignore */ }

    const host = document.createElement('div');
    host.id = 'scroll-stopper-overlay-host';
    host.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:auto;';

    const shadow = host.attachShadow({ mode: 'closed' });
    const message = getRandomMessage();

    shadow.innerHTML = `
      <style>${getOverlayStyles()}</style>
      <div class="ss-overlay" id="ss-overlay">
        <div class="ss-backdrop"></div>
        <div class="ss-card">
          <div class="ss-icon">${message.emoji}</div>
          <h1 class="ss-title">Time to take a break!</h1>
          <p class="ss-subtitle">${message.text}</p>
          <p class="ss-count">You've watched <strong>${scrollCount}</strong> shorts this session.</p>
          <div class="ss-actions">
            <button class="ss-btn ss-btn-primary" id="ss-go-home">
              <span class="ss-btn-icon">🏠</span>
              Go to YouTube Home
            </button>
            ${!settings.strictMode ? `
              <button class="ss-btn ss-btn-secondary" id="ss-more">
                <span class="ss-btn-icon">⏩</span>
                5 more shorts
              </button>
            ` : ''}
          </div>
          <p class="ss-footer">Scroll Stopper is keeping you in check ✌️</p>
        </div>
      </div>
    `;

    document.documentElement.appendChild(host);

    // Wire up buttons
    const goHomeBtn = shadow.getElementById('ss-go-home');
    goHomeBtn.addEventListener('click', () => {
      removeOverlay();
      window.location.href = 'https://www.youtube.com';
    });

    if (!settings.strictMode) {
      const moreBtn = shadow.getElementById('ss-more');
      moreBtn.addEventListener('click', () => {
        temporaryBonus += 5;
        removeOverlay();
      });
    }

    // Trigger entrance animation
    requestAnimationFrame(() => {
      const overlay = shadow.getElementById('ss-overlay');
      if (overlay) overlay.classList.add('ss-visible');
    });
  }

  function removeOverlay() {
    const host = document.getElementById('scroll-stopper-overlay-host');
    if (host) {
      host.remove();
    }
    overlayInjected = false;
    document.documentElement.classList.remove('scroll-stopper-blocked');
  }

  function getOverlayStyles() {
    return `
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      .ss-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.4s ease;
        font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      }

      .ss-overlay.ss-visible {
        opacity: 1;
      }

      .ss-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
      }

      .ss-card {
        position: relative;
        background: linear-gradient(145deg, #1a1a2e, #16213e);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 24px;
        padding: 48px 40px;
        max-width: 440px;
        width: 90%;
        text-align: center;
        box-shadow:
          0 32px 64px rgba(0, 0, 0, 0.5),
          0 0 0 1px rgba(255, 255, 255, 0.05),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
        transform: translateY(30px) scale(0.95);
        animation: ss-card-enter 0.5s ease 0.1s forwards;
      }

      @keyframes ss-card-enter {
        to {
          transform: translateY(0) scale(1);
        }
      }

      .ss-icon {
        font-size: 64px;
        margin-bottom: 16px;
        animation: ss-pulse 2s ease-in-out infinite;
      }

      @keyframes ss-pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.1); }
      }

      .ss-title {
        font-size: 28px;
        font-weight: 700;
        color: #ffffff;
        margin-bottom: 8px;
        letter-spacing: -0.5px;
      }

      .ss-subtitle {
        font-size: 18px;
        color: #a0aec0;
        margin-bottom: 24px;
        font-weight: 400;
      }

      .ss-count {
        font-size: 14px;
        color: #718096;
        margin-bottom: 32px;
        padding: 12px 20px;
        background: rgba(255, 255, 255, 0.04);
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.06);
      }

      .ss-count strong {
        color: #fc8181;
        font-size: 18px;
        font-weight: 700;
      }

      .ss-actions {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-bottom: 24px;
      }

      .ss-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 16px 24px;
        border-radius: 14px;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        border: none;
        transition: all 0.2s ease;
        letter-spacing: 0.2px;
      }

      .ss-btn:active {
        transform: scale(0.97);
      }

      .ss-btn-icon {
        font-size: 18px;
      }

      .ss-btn-primary {
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: #ffffff;
        box-shadow: 0 4px 16px rgba(102, 126, 234, 0.4);
      }

      .ss-btn-primary:hover {
        background: linear-gradient(135deg, #5a72d4, #6a4291);
        box-shadow: 0 6px 24px rgba(102, 126, 234, 0.5);
        transform: translateY(-1px);
      }

      .ss-btn-secondary {
        background: rgba(255, 255, 255, 0.06);
        color: #a0aec0;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }

      .ss-btn-secondary:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #e2e8f0;
        transform: translateY(-1px);
      }

      .ss-footer {
        font-size: 12px;
        color: #4a5568;
        font-style: italic;
      }

      @media (max-width: 480px) {
        .ss-card {
          padding: 32px 24px;
          border-radius: 20px;
        }

        .ss-title {
          font-size: 24px;
        }

        .ss-icon {
          font-size: 48px;
        }
      }
    `;
  }

  // ─── Settings Change Listener ───────────────────────────────────────
  function onStorageChanged(changes, areaName) {
    if (areaName === 'sync' && changes.settings) {
      const newSettings = changes.settings.newValue;
      if (newSettings) {
        const wasEnabled = settings.enabled;
        settings = newSettings;

        if (!settings.enabled && wasEnabled) {
          // Extension was just disabled
          removeOverlay();
          detachScrollListeners();
        } else if (settings.enabled && !wasEnabled && isOnShorts) {
          // Extension was just enabled while on Shorts
          attachScrollListeners();
          const effectiveLimit = settings.scrollLimit + temporaryBonus;
          if (scrollCount >= effectiveLimit) {
            showOverlay();
          }
        }

        // Check if current count exceeds new limit
        if (settings.enabled && isOnShorts) {
          const effectiveLimit = settings.scrollLimit + temporaryBonus;
          if (scrollCount >= effectiveLimit && !overlayInjected) {
            showOverlay();
          } else if (scrollCount < effectiveLimit && overlayInjected) {
            removeOverlay();
          }
        }
      }
    }
  }

  // ─── Cleanup ────────────────────────────────────────────────────────
  function cleanup() {
    if (urlCheckInterval) clearInterval(urlCheckInterval);
    document.removeEventListener('yt-navigate-finish', onYtNavigate);
    document.removeEventListener('yt-navigate-start', onYtNavigateStart);
    window.removeEventListener('popstate', onPopState);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    detachScrollListeners();
    removeOverlay();
    chrome.storage.onChanged.removeListener(onStorageChanged);
  }

  // ─── Start ──────────────────────────────────────────────────────────
  init();
})();
