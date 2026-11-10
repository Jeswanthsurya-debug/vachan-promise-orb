# Vachan: Your word, made visible

Record a spoken agreement (Hindi / Tamil / Hinglish…). Vachan writes it down, pulls out the promises,
flags the risks, and shows everything as an interactive 3D **Promise Orb**. Then it reads a plain-language
summary back to you.

> **Runs with zero setup.** With no API key the app is in **Demo mode**: it uses a built-in sample
> conversation and analysis, so every animation and screen works immediately.

## Features

- 🎙️ **Speak** an agreement (Hindi, Tamil, Telugu, Kannada, Bengali, Marathi, Hinglish, English) — noisy phone audio is fine
- ⌨️ **Type or speak** — a chat bar next to the mic sends typed text straight to analysis (no transcription step); press **/** to focus it
- 💬 **Live chat panel** — your words appear live while you speak (browser speech recognition preview, replaced by the final Prisma transcript in Live mode), then Vachan's summary with colour chips for every promise; tap a chip to jump to that crystal in 3D. Side panel on desktop, bottom sheet on mobile
- 🔮 **3D Promise Orb** with gems, threads, Trust Meter and Promise Timeline
- 🔊 **Voice read-back** of the summary (Timbre, or the browser voice in demo mode)
- 🖐️ **Gesture mode** — palm = rotate, pinch = zoom, swipe = next promise, fist = read-back (mouse/touch always works)
- ▶ **Play Demo** — a hands-free ~45 s show with zero setup; **Demo / Live** switch
- 📜 **Session log** — every result is saved on your device (`localStorage["vachan_log"]`) and restored on reload; searchable, filterable by language, with "Clear log" (asks first). Stored only on this device; no API keys are ever written to it
- ⬇️ **Easy download** — `.txt` chat transcript, `.json` full data, `.csv` (one row per promise, Excel-ready), and a one-page **PDF** or **PNG** card of a session. Files are named `vachan-log-YYYY-MM-DD-HHmm.*`; text is UTF-8 so Indian scripts are never corrupted
- 🌐 Every new label is translated into each supported language, with the matching Noto font per script
- 📤 **Share** the orb as a PNG card

### Where the new code lives

| File | What it does |
| --- | --- |
| `src/components/ChatBar.tsx` | typing box (Enter = send, Shift+Enter = new line) |
| `src/components/ChatPanel.tsx` | conversation panel, status line, promise chips |
| `src/components/LogDrawer.tsx` | saved sessions: search, language filter, downloads, clear |
| `src/components/DownloadMenu.tsx` | the Download button + menu (txt / json / csv / PDF / PNG) |
| `src/lib/sessionLog.ts` | localStorage log + builders for .txt / .json / .csv |
| `src/lib/download.ts` | Blob downloads, one-page card, tiny PDF writer |
| `src/lib/liveSpeech.ts` | live speech preview (Web Speech API) |
| `src/lib/i18n.ts` | translated labels + Noto font per script |

The PDF is a picture of the page (drawn by the browser so Indian scripts shape correctly), so its text is not selectable — use `.txt` or `.csv` when you need copyable text.

## Quick start

```bash
npm install
cp .env.example .env     # optional — leave GNANI_API_KEY empty for demo mode
npm run dev              # open http://localhost:3000
```

Production: `npm run build && npm start`.

## A note on the stack

This project is a **Next.js** app (React + TypeScript) rather than Vite + Express. The three Express routes
became Next.js API routes with the same names and the same job — a tiny server-side proxy that keeps your key
secret:

| Route            | Calls (in `gnaniClient.ts`) | Gnani product |
| ---------------- | --------------------------- | ------------- |
| `POST /api/stt`     | `transcribe(audioBlob)`     | Prisma (speech → text) |
| `POST /api/analyze` | `analyze(transcript)`       | Evon (reasoning → JSON) |
| `POST /api/tts`     | `speak(text, lang)`         | Timbre (text → speech) |

Three.js draws the 3D scene; MediaPipe Hands is loaded from the jsDelivr CDN only when you switch Gesture mode on.

## Folder map (read in this order)

```
src/
├─ app/
│  ├─ layout.tsx, page.tsx, globals.css   page shell + all styling
│  └─ api/
│     ├─ stt/route.ts       mic audio  → transcript         (proxy)
│     ├─ analyze/route.ts   transcript → promises JSON      (proxy)
│     ├─ tts/route.ts       text       → audio              (proxy)
│     ├─ status/route.ts    "are we in demo mode?" (yes/no only)
│     └─ health/route.ts    health check
├─ components/
│  ├─ VachanApp.tsx         the main screen: connects mic, server, 3D and gestures
│  ├─ PromiseCard.tsx       glass card with who / to whom / what / amount / due / reason
│  ├─ GesturePanel.tsx      camera preview + hand-skeleton overlay + Gesture ON/OFF lifecycle
│  └─ HowToOverlay.tsx      one-screen "How to use" on first visit
└─ lib/
   ├─ gnaniClient.ts        ★ ALL Gnani calls: transcribe / analyze / speak (SERVER ONLY)
   ├─ demoData.ts           built-in sample transcript + analysis
   ├─ analysis.ts           JSON types + validator that cleans model output
   ├─ scene.ts              Three.js: orb, dust, rings, nodes, threads, camera
   ├─ gestures.ts           MediaPipe hand gestures → simple handler callbacks
   ├─ audio.ts              mic recording + WebAudio analyser (drives the rings)
   ├─ speech.ts             plays Timbre audio, or falls back to the browser voice
   └─ shareCard.ts          draws the shareable PNG card
```

## Going live with Gnani

1. Put your key in `.env`: `GNANI_API_KEY=...` (it stays on the server; the browser never sees it).
2. Put the three endpoint URLs in `.env`: `GNANI_STT_URL`, `GNANI_EVON_URL`, `GNANI_TTS_URL`.
3. Open `src/lib/gnaniClient.ts` and search for **`TODO`**. Fill in each block from the official docs:
   - **Prisma STT** – auth header, how to send the audio, language-code format, response field with the text.
   - **Evon** – request shape, where `EVON_SYSTEM_PROMPT` goes, response field with the model's text.
     (The strict-JSON prompt and the response cleaner are already written.)
   - **Timbre TTS** – auth header, voice / language fields, audio output format.

No endpoints or payloads were invented. Until the TODOs are filled, the routes automatically fall back to
the demo sample (and show a small notice), so the app never breaks.

### What `analyze()` returns

```json
{ "language": "hi-en",
  "parties": ["Ramesh","Suresh"],
  "promises": [ { "id":1, "who":"Suresh", "to":"Ramesh", "what":"Repay ₹20,000",
                  "amount":20000, "due":"15 Dec", "risk":"green|amber|red",
                  "reason":"short plain-language explanation" } ],
  "summary":"2-3 simple sentences" }
```

Evon is told to mark **red** for hidden interest, no deadline, one-sided terms or pressure, and **amber** for
vague words like "jaldi" or "baad mein".

## Controls

| Action | Mouse / touch (always works) | Gesture mode (webcam) |
| --- | --- | --- |
| Rotate camera | drag | ✋ move an open palm slowly |
| Zoom | scroll / pinch | 🤏 pinch, then pull toward you or lift up (zoom in) / push away or lower (zoom out) |
| Next / previous promise | tap a dot, ◀ ▶, arrow keys | 👋 swipe right / left (fast flick) |
| Hear the summary | 🔊 button | ✊ closed fist held for 0.5 s |

If the camera is denied, Gesture mode switches itself off and mouse/touch keeps working.

## Notes

- Microphone and camera need **HTTPS or localhost**.
- Browser audio is WebM/Opus (or MP4 on Safari). Check whether Prisma needs another format and convert on the server if so.
- Not legal advice.

*Powered by Gnani AI (Prisma, Evon, Timbre).*

---

## Visual design: "Aurora Saffron"

Palette: plum `#0A0612 → #1A0B2E`, magenta `#FF3D9A`, violet `#7C3AED`, teal `#14F1D9`, saffron `#FF9F1C`.
Risk colours: green `#2DFF8F`, amber `#FFC83D`, red `#FF3B5C`. Threads run cyan `#22E4FF` → white-gold.

- **`src/lib/scene.ts`** draws everything in 3D: the drifting aurora background, grid floor glow, gold star dust,
  the iridescent plasma orb, 3 tilted orbit rings, crystal gems with floating icons (💰 📅 🏠 🤝 ⚠️), light trails,
  flowing threads with travelling lights, red shockwave rings and camera shake. `UnrealBloomPass` adds the glow.
  The camera does a 5-second cinematic fly-in, then auto-orbits while you are idle.
- Listening makes the orb a live **waveform sphere**; processing spirals particles **into** the orb, then **bursts** them outward as gems.
- **`src/components/Timeline.tsx`** — the "Promise Timeline" ribbon at the bottom (tap a marker to focus a promise).
- **`src/components/TrustMeter.tsx`** — animated ring chart of % green / amber / red, top-right.

### ▶ Play Demo (for screen recordings)

The big **Play Demo** button next to the mic runs the whole show hands-free in about 45 seconds, with no microphone and
no network: fake listening waves with live subtitles → processing → gems fly out (red ones shake the camera) →
auto-focus on each promise → voice read-back with the browser's `speechSynthesis`. Tap **Stop demo** to cancel.
The sequence and its timings live in `runDemo` / the `DEMO` constants in `src/components/VachanApp.tsx`.

### Demo / Live switch

- **Demo** (default without a key): uses the built-in sample, even if a key exists.
- **Live**: calls Gnani through the server. It needs `GNANI_API_KEY` in `.env` (otherwise the app stays in Demo and says so).
