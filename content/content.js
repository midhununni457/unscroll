// Scroll Stopper — Content Script (content.js)
// Detects YouTube Shorts navigation, counts shorts viewed,
// and injects a blocking overlay when the limit is reached.

(function () {
  'use strict';

  // Only run in top window, avoid iframes
  if (window !== window.top) return;

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

    // Listen for messages from background/popup (e.g. RESET_COUNT)
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
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
  function extractShortId(pathname) {
    const match = pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  function checkIfOnShorts() {
    const pathname = window.location.pathname;
    const isShortsRoute = pathname.startsWith('/shorts');
    const shortId = extractShortId(pathname);
    const wasOnShorts = isOnShorts;

    if (!isShortsRoute) {
      if (wasOnShorts) {
        onLeaveShorts();
      }
      return;
    }

    // We ARE on Shorts route (/shorts, /shorts/, or /shorts/<id>)
    isOnShorts = true;

    if (!wasOnShorts) {
      // Just entered Shorts
      onEnterShorts(shortId);
    } else if (shortId && currentShortId === null) {
      // Initial short resolved its ID
      currentShortId = shortId;
    } else if (shortId && shortId !== currentShortId) {
      // Navigated to a different short
      onNewShort(shortId);
    }
  }

  function onYtNavigate() {
    checkIfOnShorts();
  }

  function onYtNavigateStart() {
    // Early detection — YouTube fires this before navigation completes
  }

  function onPopState() {
    // Browser back/forward button pressed
    checkIfOnShorts();
  }

  function onVisibilityChange() {
    // When user switches back to this tab, re-check state
    if (document.visibilityState === 'visible') {
      checkIfOnShorts();
    }
  }

  function interceptHistoryMethods() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      Promise.resolve().then(() => checkIfOnShorts());
    };

    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      Promise.resolve().then(() => checkIfOnShorts());
    };
  }

  function startUrlPolling() {
    let lastPath = window.location.pathname;
    urlCheckInterval = setInterval(() => {
      const currentPath = window.location.pathname;
      if (currentPath !== lastPath) {
        lastPath = currentPath;
        checkIfOnShorts();
      }
    }, 150);
  }

  // ─── Shorts Lifecycle ───────────────────────────────────────────────
  function onEnterShorts(shortId) {
    currentShortId = shortId;
    scrollCount = 1; // First short counts as 1
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
    if (scrollCount > effectiveLimit) {
      showOverlay();
    }
  }

  async function reportCount() {
    try {
      const effectiveLimit = settings.scrollLimit + temporaryBonus;
      const reportedCount = Math.min(scrollCount, effectiveLimit);
      await chrome.runtime.sendMessage({
        type: 'SCROLL_COUNT_UPDATE',
        count: reportedCount,
        bonus: temporaryBonus,
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

  let deferredCheckTimer = null;
  function triggerDeferredCheck() {
    clearTimeout(deferredCheckTimer);
    deferredCheckTimer = setTimeout(checkIfOnShorts, 100);
  }

  function onWheelEvent(e) {
    if (!settings.enabled || !isOnShorts) return;

    const effectiveLimit = settings.scrollLimit + temporaryBonus;
    if (scrollCount >= effectiveLimit && overlayInjected) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    triggerDeferredCheck();
  }

  function onTouchMoveEvent(e) {
    if (!settings.enabled || !isOnShorts) return;

    const effectiveLimit = settings.scrollLimit + temporaryBonus;
    if (scrollCount >= effectiveLimit && overlayInjected) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    triggerDeferredCheck();
  }

  function onKeyDownEvent(e) {
    if (!settings.enabled || !isOnShorts) return;

    const scrollKeys = ['ArrowDown', 'ArrowUp', 'j', 'k', ' '];
    if (!scrollKeys.includes(e.key)) return;

    const effectiveLimit = settings.scrollLimit + temporaryBonus;
    if (scrollCount >= effectiveLimit && overlayInjected) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    triggerDeferredCheck();
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

  // ─── Video Control ──────────────────────────────────────────────────
  function pauseVideos() {
    try {
      const videos = document.querySelectorAll('video');
      videos.forEach((video) => {
        try {
          if (!video.paused) {
            video.pause();
          }
        } catch (e) {}
      });
    } catch (err) {}
  }

  function resumeActiveVideo() {
    try {
      const activeVideo = document.querySelector('ytd-reel-video-renderer[is-active] video') || document.querySelector('video');
      if (activeVideo && activeVideo.paused) {
        activeVideo.play().catch(() => {});
      }
    } catch (err) {}
  }

  function onVideoPlay(e) {
    if (overlayInjected && e.target && typeof e.target.pause === 'function') {
      try {
        e.target.pause();
      } catch (err) {}
    }
  }

  // ─── Overlay UI (Shadow DOM) ────────────────────────────────────────

  function showOverlay() {
    if (overlayInjected) return;
    overlayInjected = true;

    // Pause all playing videos
    pauseVideos();
    document.addEventListener('play', onVideoPlay, true);

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

    const effectiveLimit = settings.scrollLimit + temporaryBonus;

    shadow.innerHTML = `
      <style>${getOverlayStyles()}</style>
      <div class="ss-overlay" id="ss-overlay">
        <div class="ss-backdrop"></div>
        <div class="ss-card">
          <p class="ss-count">${effectiveLimit} shorts watched</p>
          <h1 class="ss-title">You hit your limit.</h1>
          <p class="ss-subtitle">You said ${effectiveLimit}, and you meant it.</p>
          <div class="ss-actions">
            <button class="ss-btn ss-btn-primary" id="ss-go-home">Back to YouTube</button>
            ${!settings.strictMode ? `
              <button class="ss-btn ss-btn-secondary" id="ss-more">5 more</button>
            ` : ''}
          </div>
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
        reportCount();
        removeOverlay();
        resumeActiveVideo();
      });
    }

    // Trigger entrance animation
    requestAnimationFrame(() => {
      const overlay = shadow.getElementById('ss-overlay');
      if (overlay) overlay.classList.add('ss-visible');
    });
  }

  function removeOverlay() {
    document.removeEventListener('play', onVideoPlay, true);
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
        transition: opacity 0.3s ease;
        font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      }

      .ss-overlay.ss-visible {
        opacity: 1;
      }

      .ss-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.85);
      }

      .ss-card {
        position: relative;
        background: #212121;
        border: 1px solid #333;
        border-radius: 12px;
        padding: 36px 32px;
        max-width: 380px;
        width: 90%;
        text-align: center;
      }

      .ss-count {
        font-size: 13px;
        color: #999;
        margin-bottom: 12px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .ss-title {
        font-size: 22px;
        font-weight: 600;
        color: #fff;
        margin-bottom: 6px;
      }

      .ss-subtitle {
        font-size: 14px;
        color: #888;
        margin-bottom: 28px;
      }

      .ss-actions {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .ss-btn {
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        border: none;
        transition: background 0.15s ease;
      }

      .ss-btn-primary {
        background: #fff;
        color: #111;
      }

      .ss-btn-primary:hover {
        background: #e0e0e0;
      }

      .ss-btn-secondary {
        background: transparent;
        color: #777;
        border: 1px solid #444;
      }

      .ss-btn-secondary:hover {
        background: #2a2a2a;
        color: #aaa;
      }

      @media (max-width: 480px) {
        .ss-card {
          padding: 28px 20px;
        }

        .ss-title {
          font-size: 20px;
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
          if (scrollCount > effectiveLimit) {
            showOverlay();
          }
        }

        // Check if current count exceeds new limit
        if (settings.enabled && isOnShorts) {
          const effectiveLimit = settings.scrollLimit + temporaryBonus;
          if (scrollCount > effectiveLimit && !overlayInjected) {
            showOverlay();
          } else if (scrollCount <= effectiveLimit && overlayInjected) {
            removeOverlay();
          }
        }
      }
    }
  }

  // ─── Runtime Message Listener ──────────────────────────────────────
  function onRuntimeMessage(message, sender, sendResponse) {
    if (message.type === 'RESET_COUNT') {
      scrollCount = isOnShorts ? 1 : 0;
      temporaryBonus = 0;
      removeOverlay();
      reportCount();
      sendResponse({ success: true });
    } else if (message.type === 'GET_CONTENT_COUNT') {
      const effectiveLimit = settings.scrollLimit + temporaryBonus;
      sendResponse({ count: Math.min(scrollCount, effectiveLimit), bonus: temporaryBonus, isOnShorts });
    }
    return true;
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
    chrome.runtime.onMessage.removeListener(onRuntimeMessage);
  }

  // ─── Start ──────────────────────────────────────────────────────────
  init();
})();
