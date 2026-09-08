# 🛑 Scroll Stopper

**Stop doomscrolling YouTube Shorts.** Get a gentle (or firm) nudge after watching too many.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=flat-square&logo=google-chrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-34A853?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)

---

## ✨ Features

- **Smart Detection** — Detects when you're watching YouTube Shorts and counts each short you scroll through
- **Configurable Limit** — Set your own scroll limit (1–100, default: 20)
- **Blocking Overlay** — Beautiful full-screen overlay that blocks further scrolling when you hit your limit
- **Gentle Mode** — Dismissable overlay with a "5 more shorts" snooze button
- **Strict Mode** — No dismiss option — you _must_ go back to YouTube Home
- **Session Tracking** — Live counter in the popup showing your current session progress
- **Color-Coded Badge** — Extension icon badge turns green → orange → red as you approach your limit
- **Motivational Messages** — Random rotating messages to nudge you away from the screen
- **Per-Tab Tracking** — Each tab tracks its own session independently
- **Real-Time Settings** — Changes take effect immediately, no reload needed

---

## 📦 Installation

1. Download or clone this repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/scroll-stopper.git
   ```

2. Open Chrome and navigate to `chrome://extensions`

3. Enable **Developer mode** (toggle in the top-right corner)

4. Click **Load unpacked** and select the `scroll-stopper` folder

5. The 🛑 icon will appear in your extensions toolbar. Pin it for easy access!

---

## 🚀 Usage

1. **Browse YouTube Shorts as usual** — the extension works silently in the background
2. **Watch the badge counter** — it shows how many shorts you've watched this session
3. **Hit your limit** — a blocking overlay appears with a motivational message
4. **Go Home** — click "Go to YouTube Home" to leave Shorts
5. **Or snooze** — in Gentle mode, click "5 more shorts" to continue (but the overlay will return!)

### Popup Controls

- **Master Toggle** — Enable/disable the extension entirely
- **Scroll Limit Slider** — Set how many shorts before the warning (1–100)
- **Strict Mode** — Toggle between Gentle (dismissable) and Strict (forced redirect)
- **Session Counter** — See your current count with a color-coded progress bar
- **Reset Button** — Manually reset your counter for the current tab

---

## 🏗️ Architecture

```
scroll-stopper/
├── manifest.json          # Extension manifest (MV3)
├── background.js          # Service worker — state management & messaging
├── content/
│   ├── content.js         # Content script — scroll detection & overlay
│   └── content.css        # Minimal page-level styles
├── popup/
│   ├── popup.html         # Popup UI structure
│   ├── popup.js           # Popup logic & settings management
│   └── popup.css          # Dark-themed popup styles
└── README.md
```

### How Detection Works

YouTube Shorts is a single-page app (SPA), so traditional page load detection doesn't work. Scroll Stopper uses a **triple detection** strategy:

1. **YouTube SPA Events** — Listens for `yt-navigate-finish` custom events
2. **History API Interception** — Monkey-patches `pushState`/`replaceState` to catch URL changes immediately
3. **URL Polling** — 500ms fallback poll as a safety net

Each unique `/shorts/VIDEO_ID` transition increments the counter.

---

## 🛡️ Permissions

| Permission | Why |
|------------|-----|
| `storage` | Save user settings (sync across devices) and session counters |

**No other permissions are needed.** The extension uses declarative content script injection matched to `youtube.com` — no `tabs`, `activeTab`, or host permissions required.

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'feat: add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.

---

<p align="center">
  Made with ❤️ to help you touch grass 🌿
</p>
