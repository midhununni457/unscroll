# 🛑 Scroll Stopper

**Stop doomscrolling YouTube Shorts.** Get a gentle (or firm) nudge after watching too many.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=flat-square&logo=google-chrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-34A853?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)

---

## ✨ Features

- **Smart Detection** — Automatically tracks and counts shorts as you scroll without slowing down playback
- **Configurable Limits** — Set your custom limit (1–999) directly in the popup
- **Minimal Stop Modal** — Blocks scrolling when you reach your limit, with a "Back to YouTube" button and optional "5 more" snooze
- **Live Progress & Badge** — Color-coded extension icon badge (green → orange → red) and real-time session counter
- **Strict Mode** — Optional lock-in mode that removes the snooze option entirely

---

## 📦 Installation

1. Download or clone this repository:
   ```bash
   git clone https://github.com/midhununni457/scroll-stopper.git
   ```

2. Open Chrome and navigate to `chrome://extensions`

3. Enable **Developer mode** (toggle in the top-right corner)

4. Click **Load unpacked** and select the `scroll-stopper` folder

5. The 🛑 icon will appear in your extensions toolbar. Pin it for easy access!

---

## 🚀 Usage

1. **Browse YouTube Shorts as usual** — the extension works silently in the background
2. **Watch the badge counter** — it shows how many shorts you've watched this session
3. **Hit your limit** — a minimal blocking overlay appears reminding you of your limit
4. **Go Home** — click "Back to YouTube" to leave Shorts
5. **Or snooze** — in Gentle mode, click "5 more" to extend your current session by 5 shorts

### Popup Controls

- **Master Toggle** — Enable/disable the extension entirely
- **Scroll Limit Input** — Type your preferred scroll limit (1–999)
- **Strict Mode** — Toggle between Gentle (dismissable) and Strict (forced redirect)
- **Session Counter** — See your current count with a color-coded progress bar and effective limit
- **Reset Button** — Manually reset your counter for the current tab

---

## 🏗️ Architecture

```
scroll-stopper/
├── manifest.json          # Extension manifest (MV3)
├── background.js          # Service worker — state management & messaging
├── icons/                 # Extension icons (16px, 48px, 128px)
├── content/
│   ├── content.js         # Content script — scroll detection & overlay
│   └── content.css        # Minimal page-level styles
├── popup/
│   ├── popup.html         # Popup UI structure
│   ├── popup.js           # Popup logic & settings management
│   └── popup.css          # Dark-themed popup styles
├── LICENSE                # MIT License
└── README.md
```

### How Detection Works

YouTube Shorts is a single-page app (SPA), so traditional page load detection doesn't work. Scroll Stopper uses a **triple detection** strategy:

1. **YouTube SPA Events** — Listens for `yt-navigate-finish` custom events
2. **History API Interception** — Intercepts navigation changes immediately
3. **URL Polling** — 150ms fast fallback poll and deferred scroll checks

Each unique `/shorts/VIDEO_ID` transition increments the counter.

---

## 🛡️ Permissions

| Permission | Why |
|------------|-----|
| `storage` | Save user settings (sync across devices) and session counters |

**No other permissions are needed.** The extension uses declarative content script injection matched to `youtube.com` — no `tabs`, `activeTab`, or host permissions required.

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.

---

<p align="center">
  Made with ❤️ to help you touch grass 🌿
</p>
