"use client";
/**
 * VachanApp.tsx — the main screen. It connects:
 *
 *   1. The 3D scene          (src/lib/scene.ts)
 *   2. The microphone        (src/lib/audio.ts) + live words preview (src/lib/liveSpeech.ts)
 *   3. The server routes     (/api/stt → /api/analyze → /api/tts)
 *   4. Hand gestures         (src/components/GesturePanel.tsx)
 *   5. The hands-free demo   (runDemo below — ~45 seconds, no mic, no network needed)
 *   6. Chat: type box, conversation panel, on-device session log, downloads
 *
 * Three ways in, one pipeline out:
 *   voice  → record → /api/stt → /api/analyze → results
 *   text   →                     /api/analyze → results      (typing skips transcription)
 *   demo   → built-in sample, plays by itself
 * "results" = gems fly out, summary + chips appear in chat, the session is saved to the log,
 * and the summary is read aloud.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VachanScene } from "@/lib/scene";
import { Recorder, SimulatedVoice } from "@/lib/audio";
import { normalizeAnalysis, type Analysis } from "@/lib/analysis";
import { DEMO_ANALYSIS, DEMO_TRANSCRIPT } from "@/lib/demoData";
import { primeSpeech, speakText, stopSpeaking } from "@/lib/speech";
import { createShareCard, shareOrDownload } from "@/lib/shareCard";
import { LivePreview } from "@/lib/liveSpeech";
import { LANGS, dict, fontStack, htmlLang, recognitionLocale } from "@/lib/i18n";
import {
  MAX_SESSIONS,
  clearSessions,
  loadSessions,
  makeSession,
  saveSessions,
  type SessionEntry,
  type TranscriptSource,
} from "@/lib/sessionLog";
import type { GestureHandlers } from "@/lib/gestures";
import GesturePanel from "./GesturePanel";
import PromiseCard from "./PromiseCard";
import HowToOverlay from "./HowToOverlay";
import TrustMeter from "./TrustMeter";
import Timeline from "./Timeline";
import ChatBar from "./ChatBar";
import ChatPanel, { type ChatMsg, type ChatStatus } from "./ChatPanel";
import LogDrawer from "./LogDrawer";
import DownloadMenu, { type DownloadResult } from "./DownloadMenu";

type Phase = "idle" | "recording" | "processing" | "results";

const STEPS = [
  { icon: "🎙️", label: "Listen" },
  { icon: "🧠", label: "Understand" },
  { icon: "✅", label: "Confirm" },
];

const MAX_RECORD_MS = 45000;
const MAX_MESSAGES = 120;

/** Demo timeline (milliseconds). Adds up to roughly 45 seconds with the voice read-back. */
const DEMO = {
  lineMs: 1400, // one transcript line appears every 1.4s while "listening" (5 lines ≈ 7s)
  sttMs: 2600,
  analyzeMs: 3400,
  revealMs: 5200, // gems fly out, red gems shake the camera
  focusMs: 2600, // per promise
  voiceMaxMs: 18000,
};

class DemoCancelled extends Error {}

/** Calls /api/analyze (the same call for typed and spoken text). */
async function requestAnalysis(text: string, lang: string, forceDemo: boolean) {
  const r = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript: text, lang, demo: forceDemo }),
  });
  const j = (await r.json()) as { analysis?: unknown; demo?: boolean; notice?: string; error?: string };
  if (!r.ok || !j.analysis) throw new Error(j.error ?? "Could not understand that. Please try again.");
  return { analysis: normalizeAnalysis(j.analysis, lang), demo: !!j.demo, notice: j.notice };
}

/** Human-readable "who did the work" line stored in the log. */
function providerLabel(o: { demo: boolean; notice?: string; input: "voice" | "text"; playDemo?: boolean }): string {
  if (o.playDemo) return "Demo sample (Play Demo)";
  if (o.notice) return "Demo sample (Gnani endpoints not configured yet)";
  if (o.demo) return "Demo sample";
  return o.input === "voice" ? "Gnani Prisma (speech-to-text) + Evon (analysis)" : "Gnani Evon (analysis)";
}

export default function VachanApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<VachanScene | null>(null);
  const recRef = useRef<Recorder | null>(null);
  const previewRef = useRef<LivePreview | null>(null);
  const liveMsgId = useRef<number | null>(null);
  const msgSeq = useRef(0);
  const sessionsRef = useRef<SessionEntry[]>([]);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speakId = useRef(0);
  const pinchD0 = useRef(9);
  const demoRun = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [stage, setStage] = useState<"stt" | "analyze">("stt");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [lang, setLang] = useState("hi-en");
  const [gestureOn, setGestureOn] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [mode, setMode] = useState<"demo" | "live">("demo"); // the Demo / Live switch
  const [serverDemo, setServerDemo] = useState(true); // true when the server has no GNANI_API_KEY
  const [fellBack, setFellBack] = useState(false); // key set, but Gnani TODOs not filled yet
  const [toast, setToast] = useState<string | null>(null); // top toast (errors / hints)
  const [note, setNote] = useState<string | null>(null); // bottom-centre toast ("Saved to log")
  const [showHelp, setShowHelp] = useState(false);
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoCaption, setDemoCaption] = useState<string | null>(null);
  const [liveText, setLiveText] = useState("");

  // chat + log
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [visitIds, setVisitIds] = useState<string[]>([]); // sessions made since the page opened

  const t = dict(lang);
  const fam = fontStack(lang);
  const hl = htmlLang(lang);

  const isDemo = mode === "demo" || serverDemo || fellBack;

  /* Keep the latest values in refs so long-lived callbacks (gestures, timers) never go stale. */
  const live = useRef({ analysis, lang, isDemo, forceDemo: mode === "demo", speaking, phase });
  useEffect(() => {
    live.current = { analysis, lang, isDemo, forceDemo: mode === "demo", speaking, phase };
  });

  const showToast = useCallback((msg: string, ms = 5000) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);

  /** Small bottom-centre confirmation that hides itself after 3 seconds. */
  const notify = useCallback((msg: string) => {
    setNote(msg);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 3000);
  }, []);

  /* ───────── chat message helpers ───────── */
  const pushMsg = (m: { role: "user"; text: string; live?: boolean; source: "voice" | "text" } | { role: "assistant"; text: string; analysis: Analysis }) => {
    const id = ++msgSeq.current;
    setMessages((prev) => [...prev, { ...m, id, ts: Date.now() } as ChatMsg].slice(-MAX_MESSAGES));
    return id;
  };
  const patchMsg = (id: number, patch: { text?: string; live?: boolean }) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? ({ ...m, ...patch } as ChatMsg) : m)));
  const dropMsg = (id: number) => setMessages((prev) => prev.filter((m) => m.id !== id));

  /* ───────── session log ───────── */
  const saveSession = (data: Omit<SessionEntry, "id" | "ts">) => {
    const entry = makeSession(data);
    const next = [entry, ...sessionsRef.current].slice(0, MAX_SESSIONS);
    sessionsRef.current = next;
    setSessions(next);
    setVisitIds((v) => [...v, entry.id]);
    notify(saveSessions(next) ? dict(live.current.lang).saved : dict(live.current.lang).saveFailed);
  };

  const clearLog = () => {
    clearSessions();
    sessionsRef.current = [];
    setSessions([]);
    setVisitIds([]);
    notify(dict(live.current.lang).logCleared);
  };

  const onDownloadDone = (r: DownloadResult) => {
    if (r === "ok") notify(dict(live.current.lang).downloaded);
    else if (r === "empty") notify(dict(live.current.lang).nothing);
    else notify(dict(live.current.lang).dlFailed);
  };

  /* ───────── set-up: 3D scene, demo-mode check, saved log, first-visit help ───────── */
  useEffect(() => {
    if (!containerRef.current) return;
    try {
      sceneRef.current = new VachanScene(containerRef.current, { onSelect: setSelected });
    } catch {
      showToast("3D graphics are not available on this device.", 8000);
    }
    return () => {
      demoRun.current++;
      sceneRef.current?.dispose();
      sceneRef.current = null;
      stopSpeaking();
    };
  }, [showToast]);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((j: { demo: boolean }) => {
        setServerDemo(j.demo);
        if (!j.demo) setMode("live"); // a key exists → default to Live
      })
      .catch(() => undefined);
    try {
      if (!localStorage.getItem("vachan_seen")) setShowHelp(true);
    } catch {
      /* storage blocked — ignore */
    }
    // restore the saved log
    const saved = loadSessions();
    sessionsRef.current = saved;
    setSessions(saved);
  }, []);

  /* chat panel: a side panel (open by default) on desktop, a bottom sheet below 1024px */
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => {
      setIsDesktop(mq.matches);
      setChatOpen(mq.matches);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // keep the orb centred in the space that is NOT covered by the chat panel
  useEffect(() => {
    sceneRef.current?.setLayoutShift(isDesktop && chatOpen ? 184 : 0);
  }, [isDesktop, chatOpen]);

  const closeHelp = () => {
    setShowHelp(false);
    try {
      localStorage.setItem("vachan_seen", "1");
    } catch {
      /* ignore */
    }
  };

  const chooseMode = (m: "demo" | "live") => {
    if (m === "live" && serverDemo) {
      showToast("Live needs a GNANI_API_KEY in .env. Staying in Demo mode.", 5500);
      return;
    }
    setMode(m);
    setFellBack(false);
  };

  /* ───────── voice read-back ───────── */
  const stopVoice = useCallback(() => {
    speakId.current++;
    stopSpeaking();
    setSpeaking(false);
    sceneRef.current?.setSpeaking(false);
  }, []);

  const playVoice = useCallback(
    async (text: string, opts?: { browserOnly?: boolean; rate?: number; lang?: string }) => {
      const my = ++speakId.current;
      setSpeaking(true);
      sceneRef.current?.setSpeaking(true);
      try {
        await speakText(text, opts?.lang ?? live.current.lang, live.current.isDemo, opts);
      } catch {
        showToast("Could not play the voice on this device.");
      } finally {
        if (my === speakId.current) {
          setSpeaking(false);
          sceneRef.current?.setSpeaking(false);
        }
      }
    },
    [showToast],
  );

  const toggleVoice = useCallback(
    (text: string) => {
      if (live.current.speaking) stopVoice();
      else void playVoice(text);
    },
    [playVoice, stopVoice],
  );

  /* ───────── shared: show results, chat bubble, save to log ───────── */
  const presentResults = (
    a: Analysis,
    o: { transcript: string; input: "voice" | "text"; source: TranscriptSource; demo: boolean; provider: string },
  ) => {
    const scene = sceneRef.current;
    setAnalysis(a);
    setPhase("results");
    scene?.setMode("results");
    scene?.setAnalysis(a);
    live.current = { ...live.current, analysis: a };
    pushMsg({ role: "assistant", text: a.summary, analysis: a });
    saveSession({
      language: live.current.lang,
      mode: o.demo ? "demo" : "live",
      input: o.input,
      transcript: o.transcript,
      transcriptSource: o.source,
      parties: a.parties,
      promises: a.promises,
      summary: a.summary,
      provider: o.provider,
    });
  };

  /** Clicking a chip focuses that promise. If the chip belongs to an older answer, bring that orb back first. */
  const focusChip = (a: Analysis, index: number) => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (live.current.analysis === a) {
      scene.focus(index);
      return;
    }
    stopVoice();
    setAnalysis(a);
    setPhase("results");
    scene.setMode("results");
    scene.setAnalysis(a);
    live.current = { ...live.current, analysis: a };
    setTimeout(() => sceneRef.current?.focus(index), 2600);
  };

  /* ───────── Play Demo: the full show, hands-free, ~45 seconds ───────── */
  const resetScene = () => {
    sceneRef.current?.setAnalysis(null);
    setAnalysis(null);
    setSelected(null);
    setLiveText("");
  };

  const stopDemo = useCallback(() => {
    demoRun.current++; // makes every pending wait() in runDemo throw DemoCancelled
    stopVoice();
    setDemoRunning(false);
    setDemoCaption(null);
    setLiveText("");
    setPhase("idle");
    // finish (or drop) a half-typed demo bubble
    setMessages((prev) => prev.filter((m) => !(m.role === "user" && m.live && !m.text)).map((m) => (m.role === "user" && m.live ? { ...m, live: false } : m)));
    const scene = sceneRef.current;
    scene?.setMode("idle");
    scene?.setAudioSource(null);
    scene?.focus(null);
  }, [stopVoice]);

  const runDemo = async () => {
    if (live.current.phase === "recording" || live.current.phase === "processing") return;
    stopVoice();
    primeSpeech(); // lets the browser voice start later without another tap (phones)
    const scene = sceneRef.current;
    if (!scene) return showToast("3D graphics are not available on this device.");
    const id = ++demoRun.current;
    const wait = (ms: number) =>
      new Promise<void>((resolve, reject) =>
        setTimeout(() => (demoRun.current === id ? resolve() : reject(new DemoCancelled())), ms),
      );

    setDemoRunning(true);
    resetScene();
    live.current = { ...live.current, analysis: null };

    // the chat bubble that "types" the sample conversation in sync with the animation
    const bubble = pushMsg({ role: "user", text: "", live: true, source: "voice" });
    const typeInto = (prefix: string, line: string, ms: number) =>
      new Promise<void>((resolve) => {
        const start = performance.now();
        const iv = setInterval(() => {
          if (demoRun.current !== id) {
            clearInterval(iv);
            return resolve();
          }
          const k = Math.min(1, (performance.now() - start) / ms);
          patchMsg(bubble, { text: prefix + line.slice(0, Math.ceil(line.length * k)) });
          if (k >= 1) {
            clearInterval(iv);
            resolve();
          }
        }, 40);
      });

    try {
      /* 1) LISTEN — fake voice waves + live subtitles + chat typing */
      setPhase("recording");
      scene.setAudioSource(new SimulatedVoice());
      scene.setMode("recording");
      setDemoCaption("Listening to Ramesh and Suresh…");
      const lines = DEMO_TRANSCRIPT.split("\n");
      for (let i = 0; i < lines.length; i++) {
        setLiveText(lines.slice(Math.max(0, i - 1), i + 1).join("\n"));
        const prefix = lines.slice(0, i).join("\n") + (i > 0 ? "\n" : "");
        await Promise.all([typeInto(prefix, lines[i], DEMO.lineMs * 0.85), wait(DEMO.lineMs)]);
      }
      patchMsg(bubble, { text: DEMO_TRANSCRIPT, live: false });

      /* 2) UNDERSTAND — particles spiral into the orb */
      setLiveText("");
      setPhase("processing");
      setStage("stt");
      scene.setAudioSource(null);
      scene.setMode("processing");
      setDemoCaption("Writing down what was said…");
      await wait(DEMO.sttMs);
      setStage("analyze");
      setDemoCaption("Finding the promises and checking for risks…");
      await wait(DEMO.analyzeMs);

      /* 3) CONFIRM — burst outward into gems; red gems pulse and shake the camera */
      const a = DEMO_ANALYSIS;
      presentResults(a, {
        transcript: DEMO_TRANSCRIPT,
        input: "voice",
        source: "demo-sample",
        demo: true,
        provider: providerLabel({ demo: true, input: "voice", playDemo: true }),
      });
      setDemoCaption("Promises are flying out of the orb…");
      await wait(DEMO.revealMs * 0.6);
      setDemoCaption("🚨 Red crystals need a careful look");
      await wait(DEMO.revealMs * 0.4);

      /* auto-focus every promise in turn */
      for (let i = 0; i < a.promises.length; i++) {
        scene.focus(i);
        setDemoCaption(`Promise ${i + 1} of ${a.promises.length}`);
        await wait(DEMO.focusMs);
      }
      scene.focus(null);

      /* voice read-back (browser voice — no network) */
      setDemoCaption("🔊 Reading it back in plain words…");
      await Promise.race([
        playVoice(a.summary, { browserOnly: true, rate: 1.08, lang: "en-IN" }),
        wait(DEMO.voiceMaxMs),
      ]);
      if (demoRun.current !== id) throw new DemoCancelled();
      await wait(1200);
      setDemoCaption("That’s Vachan. Now tap the mic and try your own agreement.");
      setDemoRunning(false);
      await wait(6000);
      setDemoCaption(null);
    } catch (e) {
      if (!(e instanceof DemoCancelled)) {
        showToast("The demo stopped unexpectedly.");
        stopDemo();
      }
    }
  };

  /* ───────── real recording → understanding → results ───────── */
  const startRecording = async () => {
    demoRun.current++; // cancels a running demo
    setDemoRunning(false);
    setDemoCaption(null);
    stopVoice();
    const scene = sceneRef.current;
    resetScene();

    const rec = new Recorder();
    await rec.start();
    if (rec.simulated && !live.current.isDemo) {
      showToast("Microphone is blocked. Please allow it in your browser and try again.");
      return;
    }
    if (rec.simulated) showToast("No microphone found, so the demo will use a sample voice.");
    recRef.current = rec;
    scene?.setAudioSource(rec);
    scene?.setMode("recording");
    setPhase("recording");

    // live words: a user bubble that fills in while you speak (browser speech recognition)
    liveMsgId.current = pushMsg({ role: "user", text: "", live: true, source: "voice" });
    if (!rec.simulated) {
      const lp = new LivePreview(recognitionLocale(live.current.lang), (text) => {
        if (liveMsgId.current !== null) patchMsg(liveMsgId.current, { text });
      });
      previewRef.current = lp;
      lp.start();
    }
    autoStopRef.current = setTimeout(() => void finishRecording(), MAX_RECORD_MS);
  };

  const finishRecording = async () => {
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    const scene = sceneRef.current;
    const preview = (previewRef.current?.stop() ?? "").trim();
    previewRef.current = null;
    const bubble = liveMsgId.current;
    liveMsgId.current = null;
    setPhase("processing");
    setStage("stt");
    scene?.setMode("processing");
    scene?.setAudioSource(null);

    try {
      const blob = await rec.stop();
      const forceDemo = live.current.forceDemo;

      // 1) speech → text (the real recording, sent to Prisma through our server)
      const form = new FormData();
      if (blob) form.append("audio", blob, "speech.webm");
      form.append("lang", live.current.lang);
      form.append("demo", forceDemo ? "1" : "0");
      const r1 = await fetch("/api/stt", { method: "POST", body: form });
      const j1 = (await r1.json()) as { transcript?: string; demo?: boolean; notice?: string; error?: string };
      if (!r1.ok || !j1.transcript) throw new Error(j1.error ?? "Could not hear that. Please try again.");

      // Live mode: the final Prisma transcript REPLACES the browser preview.
      // Demo mode: keep what the user really said (if the browser heard anything), else use the sample.
      const fromServer = !j1.demo;
      const finalText = fromServer ? j1.transcript : preview || j1.transcript;
      const source: TranscriptSource = fromServer ? "prisma" : preview ? "browser-preview" : "demo-sample";
      if (bubble !== null) patchMsg(bubble, { text: finalText, live: false });
      else pushMsg({ role: "user", text: finalText, source: "voice" });

      // 2) text → promises + risks
      setStage("analyze");
      const res = await requestAnalysis(finalText, live.current.lang, forceDemo);
      const notice = j1.notice ?? res.notice;
      if (notice) {
        setFellBack(true);
        showToast("Gnani is not fully connected yet, so this is the built-in sample.", 7000);
      }

      // 3) show it
      presentResults(res.analysis, {
        transcript: finalText,
        input: "voice",
        source,
        demo: res.demo || !!j1.demo,
        provider: providerLabel({ demo: res.demo || !!j1.demo, notice, input: "voice" }),
      });
      setTimeout(() => {
        if (live.current.analysis === res.analysis) void playVoice(res.analysis.summary);
      }, 1800);
    } catch (e) {
      // keep whatever words were heard; drop a bubble that stayed empty
      if (bubble !== null) {
        if (preview) patchMsg(bubble, { text: preview, live: false });
        else dropMsg(bubble);
      }
      showToast(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setPhase("idle");
      scene?.setMode("idle");
    }
  };

  const onMic = () => {
    if (phase === "processing" || demoRunning) return;
    if (phase === "recording") void finishRecording();
    else void startRecording();
  };

  /* ───────── typed agreement: same pipeline, minus transcription ───────── */
  const sendText = async () => {
    const text = draft.trim();
    if (!text || phase === "recording" || phase === "processing" || demoRunning) return;
    stopVoice();
    const scene = sceneRef.current;
    resetScene();
    setDraft("");
    pushMsg({ role: "user", text, source: "text" });
    setPhase("processing");
    setStage("analyze"); // no "writing down" step: we already have the words
    scene?.setAudioSource(null);
    scene?.setMode("processing");

    try {
      const forceDemo = live.current.forceDemo;
      const res = await requestAnalysis(text, live.current.lang, forceDemo);
      if (res.notice) {
        setFellBack(true);
        showToast("Gnani is not fully connected yet, so this is the built-in sample.", 7000);
      }
      presentResults(res.analysis, {
        transcript: text,
        input: "text",
        source: "typed",
        demo: res.demo,
        provider: providerLabel({ demo: res.demo, notice: res.notice, input: "text" }),
      });
      setTimeout(() => {
        if (live.current.analysis === res.analysis) void playVoice(res.analysis.summary);
      }, 1800);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setPhase("idle");
      scene?.setMode("idle");
    }
  };

  /* ───────── share (PNG of the orb, unchanged) ───────── */
  const share = async () => {
    const scene = sceneRef.current;
    if (!analysis || !scene) return;
    try {
      const blob = await createShareCard(analysis, scene.snapshot());
      await shareOrDownload(blob);
      showToast("Your Promise Orb card is ready ✨", 3500);
    } catch {
      showToast("Could not make the image. Please try again.");
    }
  };

  /* ───────── gestures ───────── */
  const getHandlers = useCallback(
    (): GestureHandlers => ({
      onRotate: (dx, dy) => sceneRef.current?.rotateBy(dx * Math.PI * 2.4, dy * Math.PI * 1.6),
      onPinchStart: () => {
        pinchD0.current = sceneRef.current?.getDistance() ?? 9;
      },
      onPinchScale: (s) => sceneRef.current?.setDistanceTarget(pinchD0.current / s),
      onPinchEnd: () => undefined,
      onSwipe: (dir) => {
        if (!live.current.analysis) return;
        if (dir > 0) sceneRef.current?.next();
        else sceneRef.current?.prev();
      },
      onFist: () => {
        const a = live.current.analysis;
        if (!a) return showToast("Record an agreement first, then make a fist to hear it.");
        toggleVoice(a.summary);
      },
    }),
    [showToast, toggleVoice],
  );

  /* ───────── keyboard: "/" focuses the chat box, arrows move between promises ───────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || !!el?.isContentEditable;
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (typing) return;
      if (e.key === "ArrowRight") sceneRef.current?.next();
      else if (e.key === "ArrowLeft") sceneRef.current?.prev();
      else if (e.key === "Escape") sceneRef.current?.focus(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ───────── derived UI values ───────── */
  const step = phase === "results" ? 2 : phase === "processing" ? 1 : 0;
  const redCount = analysis?.promises.filter((p) => p.risk === "red").length ?? 0;
  const selectedPromise = analysis && selected !== null ? analysis.promises[selected] : null;
  const busy = phase === "recording" || phase === "processing";
  const inSheet = chatOpen && !isDesktop; // below 1024px the chat box moves into the bottom sheet
  const status: ChatStatus = phase === "recording" ? "listening" : phase === "processing" ? "understanding" : phase === "results" ? "confirming" : "ready";

  // what the chat-panel Download button exports: the conversation since the page opened
  const chatSessions = useMemo(() => sessions.filter((s) => visitIds.includes(s.id)), [sessions, visitIds]);

  let caption = "Say your agreement out loud — or type it. I will make it visible.";
  if (phase === "recording") caption = "Listening… speak naturally. Tap again when you are done.";
  if (phase === "processing")
    caption = stage === "stt" ? "Writing down what you said…" : "Finding the promises and checking for risks…";
  if (phase === "results" && analysis) {
    caption =
      redCount > 0
        ? `Found ${analysis.promises.length} promises. ${redCount} ${redCount === 1 ? "looks" : "look"} risky 🚨`
        : `Found ${analysis.promises.length} promises. Tap a glowing crystal to see details.`;
  }
  const shownCaption = demoCaption ?? caption;

  const chatBar = (
    <ChatBar
      value={draft}
      onChange={setDraft}
      onSend={() => void sendText()}
      busy={busy || demoRunning}
      t={t}
      fontFamily={fam}
      htmlLang={hl}
      inputRef={inputRef}
    />
  );

  return (
    <main className="space-bg fixed inset-0 overflow-hidden font-body text-white">
      {/* 3D canvas (aurora background is drawn inside it) */}
      <div ref={containerRef} className="absolute inset-0" aria-label="3D Promise Orb" />
      <div className="vignette pointer-events-none absolute inset-0" />

      {/* ───── top: header, progress, legend ───── */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2 p-3 sm:gap-3 sm:p-5">
        <header className="pointer-events-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="logo-orb" aria-hidden />
            <div className="leading-tight">
              <h1 className="font-head text-xl font-extrabold tracking-tight sm:text-2xl">Vachan</h1>
              <p className="text-[11px] text-amber-200/80 sm:text-xs">Your word, made visible</p>
            </div>
            {isDemo && (
              <span className="ml-1 rounded-full border border-amber-300/60 bg-amber-300/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-widest text-amber-300 shadow-[0_0_14px_rgba(255,200,61,0.35)]">
                Demo
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="seg" role="group" aria-label="Demo or Live">
              <button className={isDemo ? "seg-on" : ""} aria-pressed={isDemo} disabled={busy || demoRunning} onClick={() => chooseMode("demo")}>
                Demo
              </button>
              <button className={!isDemo ? "seg-on" : ""} aria-pressed={!isDemo} disabled={busy || demoRunning} onClick={() => chooseMode("live")}>
                Live
              </button>
            </div>

            <label className="sr-only" htmlFor="lang">
              Language
            </label>
            <select id="lang" value={lang} onChange={(e) => setLang(e.target.value)} className="select" disabled={busy || demoRunning}>
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>

            <button
              role="switch"
              aria-checked={gestureOn}
              onClick={() => setGestureOn((v) => !v)}
              className={`btn-soft ${gestureOn ? "!border-[#22E4FF] !bg-[#22E4FF]/15" : ""}`}
            >
              🖐️ <span className="hidden sm:inline">Gesture mode</span>{" "}
              <b className={gestureOn ? "text-[#22E4FF]" : "text-slate-400"}>{gestureOn ? "ON" : "OFF"}</b>
            </button>

            <button
              onClick={() => setChatOpen((v) => !v)}
              aria-pressed={chatOpen}
              aria-label={t.chat}
              className={`btn-soft ${chatOpen ? "!border-[#FF9F1C] !bg-[#FF9F1C]/15" : ""}`}
            >
              💬 <span className="hidden sm:inline">{t.chat}</span>
            </button>
            <button onClick={() => setLogOpen(true)} aria-label={t.log} className="btn-soft">
              📜 <span className="hidden sm:inline">{t.log}</span>
              {sessions.length > 0 && <span className="rounded-full bg-white/15 px-1.5 text-[10px] font-bold">{sessions.length}</span>}
            </button>

            <button onClick={share} disabled={!analysis} className="btn-soft disabled:opacity-40" aria-label="Share as picture">
              📤 <span className="hidden sm:inline">Share</span>
            </button>
            <button onClick={() => setShowHelp(true)} className="icon-btn" aria-label="How to use">
              ?
            </button>
          </div>
        </header>

        <div className="pointer-events-auto flex flex-wrap items-center gap-2 sm:gap-3">
          {/* 3-step progress strip */}
          <ol className="glass flex items-center gap-1 !rounded-full px-2 py-1.5" aria-label="Progress">
            {STEPS.map((s, i) => {
              const state = i < step ? "done" : i === step ? "active" : "todo";
              return (
                <li key={s.label} className="flex items-center gap-1">
                  <span
                    className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold sm:text-sm ${
                      state === "active"
                        ? "bg-gradient-to-r from-[#FF9F1C]/30 to-[#FF3D9A]/30 text-white ring-1 ring-[#FF9F1C]"
                        : state === "done"
                          ? "text-[#2DFF8F]"
                          : "text-slate-400"
                    }`}
                    aria-current={state === "active" ? "step" : undefined}
                  >
                    <span aria-hidden>{state === "done" ? "✓" : s.icon}</span>
                    {s.label}
                  </span>
                  {i < STEPS.length - 1 && <span className="text-slate-500" aria-hidden>›</span>}
                </li>
              );
            })}
          </ol>

          {/* colour legend — always visible */}
          <ul className="glass flex items-center gap-3 !rounded-full px-3 py-1.5 text-xs font-semibold sm:text-sm" aria-label="Colour guide">
            <li className="flex items-center gap-1.5"><span className="dot" style={{ background: "#2DFF8F", boxShadow: "0 0 10px #2DFF8F" }} />Clear</li>
            <li className="flex items-center gap-1.5"><span className="dot" style={{ background: "#FFC83D", boxShadow: "0 0 10px #FFC83D" }} />Unclear</li>
            <li className="flex items-center gap-1.5"><span className="dot" style={{ background: "#FF3B5C", boxShadow: "0 0 10px #FF3B5C" }} />Risky</li>
          </ul>
        </div>
      </div>

      {/* ───── trust meter (top-right; steps left of the chat panel when it is open on desktop) ───── */}
      {analysis && phase === "results" && (
        <div
          className={`fixed right-3 top-[13.5rem] z-10 sm:right-5 sm:top-[7.25rem] ${chatOpen ? "lg:right-[24rem] lg:top-[11rem]" : ""} ${selectedPromise ? "hidden sm:block" : ""}`}
        >
          <TrustMeter key={analysis.summary} promises={analysis.promises} />
        </div>
      )}

      {/* ───── promise card ───── */}
      {selectedPromise && analysis && selected !== null && (
        <div className="fixed inset-x-3 bottom-[15rem] z-20 sm:inset-x-auto sm:bottom-[19.5rem] sm:left-5 sm:top-[8.5rem] sm:flex sm:w-[380px] sm:items-center">
          <PromiseCard
            key={selectedPromise.id}
            promise={selectedPromise}
            index={selected}
            total={analysis.promises.length}
            speaking={speaking}
            onPrev={() => sceneRef.current?.prev()}
            onNext={() => sceneRef.current?.next()}
            onClose={() => sceneRef.current?.focus(null)}
            onHear={() =>
              toggleVoice(`${selectedPromise.who} to ${selectedPromise.to}: ${selectedPromise.what}. ${selectedPromise.reason}`)
            }
          />
        </div>
      )}

      {/* ───── camera preview (gesture mode) ───── */}
      {gestureOn && (
        <GesturePanel
          getHandlers={getHandlers}
          onFailed={(msg) => {
            setGestureOn(false);
            showToast(msg, 7000);
          }}
        />
      )}

      {/* ───── chat panel: right side on desktop, bottom sheet on small screens ───── */}
      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        messages={messages}
        status={status}
        t={t}
        fontFamily={fam}
        htmlLang={hl}
        onChip={focusChip}
        headerExtra={
          <DownloadMenu
            t={t}
            sessions={chatSessions}
            cardSession={chatSessions[0] ?? null}
            variant="big"
            fontFamily={fam}
            onDone={onDownloadDone}
          />
        }
        footer={inSheet ? chatBar : null}
      />

      {/* ───── bottom: subtitles, timeline, caption, chat bar + mic + demo, footer ───── */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center px-3 pb-2 transition-[padding] duration-500 ${chatOpen ? "lg:pr-[24rem]" : ""}`}
      >
        {liveText && !chatOpen && (
          <div key={liveText} className="glass pointer-events-none mb-3 w-full max-w-lg whitespace-pre-line px-4 py-2.5 text-center text-sm font-medium leading-snug text-amber-50 [animation:subtitleIn_0.4s_ease_both] sm:text-base">
            “{liveText}”
          </div>
        )}

        {phase === "results" && analysis && (
          <div className={`pointer-events-auto mb-2 w-full max-w-3xl ${selectedPromise ? "hidden sm:block" : ""}`}>
            <Timeline promises={analysis.promises} selected={selected} onSelect={(i) => sceneRef.current?.focus(i)} />
          </div>
        )}

        <p
          className={`pointer-events-auto mb-2 max-w-md text-center text-sm font-semibold text-amber-50 drop-shadow-[0_2px_10px_rgba(10,6,18,0.9)] sm:text-base ${selectedPromise ? "hidden sm:block" : ""}`}
          aria-live="polite"
        >
          {shownCaption}
        </p>

        {/* chat bar on the left, mic in the centre, Play Demo on the right (chat bar sits above on phones) */}
        <div className="grid w-full max-w-3xl grid-cols-[auto_auto] items-center justify-center gap-x-3 gap-y-2 sm:grid-cols-[1fr_auto_1fr]">
          {!inSheet && <div className="pointer-events-auto order-first col-span-2 w-full sm:order-none sm:col-span-1 sm:max-w-[19rem] sm:justify-self-end">{chatBar}</div>}
          {inSheet && <div className="hidden sm:block" />}
          <button
            onClick={onMic}
            disabled={phase === "processing" || demoRunning}
            className={`mic mic-${phase} pointer-events-auto`}
            aria-label={phase === "recording" ? "Stop recording" : "Tap and speak"}
          >
            {phase === "recording" ? (
              <svg viewBox="0 0 24 24" className="h-9 w-9 sm:h-11 sm:w-11" fill="currentColor" aria-hidden><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>
            ) : phase === "processing" ? (
              <span className="spinner" aria-hidden />
            ) : (
              <svg viewBox="0 0 24 24" className="h-10 w-10 sm:h-12 sm:w-12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="9" y="2.5" width="6" height="12" rx="3" fill="currentColor" />
                <path d="M5 11.5a7 7 0 0 0 14 0M12 18.5V22M8.5 22h7" />
              </svg>
            )}
          </button>
          <div className="flex justify-start">
            {demoRunning ? (
              <button onClick={stopDemo} className="btn-demo btn-demo-stop pointer-events-auto" aria-label="Stop the demo">
                <span className="play" aria-hidden>■</span>
                Stop demo
              </button>
            ) : (
              <button onClick={() => void runDemo()} disabled={busy} className="btn-demo pointer-events-auto" aria-label="Play the demo">
                <span className="play" aria-hidden>▶</span>
                Play Demo
              </button>
            )}
          </div>
        </div>

        <div className="mt-1.5 font-head text-base font-extrabold tracking-wide sm:text-lg">
          {phase === "recording" ? "Tap to finish" : phase === "processing" ? "Please wait…" : "Tap and speak"}
        </div>
        {phase === "idle" && isDemo && !demoRunning && (
          <div className="text-[11px] text-amber-200/80">No setup needed — tap Play Demo to watch a sample conversation</div>
        )}

        <footer className="mt-1 text-center text-[10px] text-slate-400 sm:text-xs">
          Powered by Gnani AI (Prisma, Evon, Timbre). Not legal advice.
        </footer>
      </div>

      {/* ───── session log drawer ───── */}
      <LogDrawer
        open={logOpen}
        onClose={() => setLogOpen(false)}
        sessions={sessions}
        t={t}
        fontFamily={fam}
        htmlLang={hl}
        onClear={clearLog}
        onDownloadDone={onDownloadDone}
      />

      {/* ───── toasts: errors/hints at the top, confirmations at the bottom ───── */}
      {toast && (
        <div className="glass card-in fixed left-1/2 top-24 z-[60] w-[min(92vw,420px)] -translate-x-1/2 px-4 py-3 text-center text-sm font-medium sm:top-28" role="status">
          {toast}
        </div>
      )}
      {note && (
        <div
          key={note}
          className="glass card-in fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 !rounded-full px-5 py-2.5 text-center text-sm font-bold text-white"
          style={{ fontFamily: fam }}
          role="status"
        >
          ✅ {note}
        </div>
      )}

      {showHelp && <HowToOverlay onClose={closeHelp} />}
    </main>
  );
}
