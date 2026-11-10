/**
 * speech.ts — plays the read-back.
 *
 *  1. Ask our server (/api/tts) for Timbre audio and play it.
 *  2. If the server says "demo" (no Timbre configured), or anything fails,
 *     fall back to the browser's built-in voice (speechSynthesis).
 *
 * `browserOnly` skips the server completely — Play Demo uses it so the
 * demo needs no network at all.
 */

/** Our language codes → BCP-47 codes that browser voices understand. */
export function browserLang(lang: string, demo: boolean): string {
  if (demo) return "en-IN"; // the demo summary is written in English
  if (lang === "hi-en") return "hi-IN";
  return lang;
}

let currentAudio: HTMLAudioElement | null = null;
let token = 0;

export function stopSpeaking() {
  token++;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

/**
 * Some phones only allow speech after a tap. Calling this inside a button
 * handler "unlocks" it, so the voice can start later without a new tap.
 */
export function primeSpeech() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  window.speechSynthesis.speak(u);
}

export interface SpeakOptions {
  /** Don't call the server; use the browser voice directly. */
  browserOnly?: boolean;
  /** Speaking speed for the browser voice (1 = normal). */
  rate?: number;
}

/** Resolves when speech finishes (or is stopped). Rejects only if nothing could play. */
export async function speakText(text: string, lang: string, demo: boolean, opts: SpeakOptions = {}): Promise<void> {
  stopSpeaking();
  const my = token;

  if (!opts.browserOnly) {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, lang, demo }),
      });
      if (my !== token) return;
      const type = res.headers.get("content-type") ?? "";
      if (res.ok && type.startsWith("audio/")) {
        const url = URL.createObjectURL(await res.blob());
        if (my !== token) return;
        await new Promise<void>((resolve, reject) => {
          const audio = new Audio(url);
          currentAudio = audio;
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error("audio error"));
          audio.play().catch(reject);
        });
        URL.revokeObjectURL(url);
        return;
      }
    } catch {
      if (my !== token) return;
    }
  }

  // fallback: the browser's own voice
  if (!("speechSynthesis" in window)) throw new Error("No voice available");
  await new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = browserLang(lang, demo);
    u.rate = opts.rate ?? 0.95;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}
