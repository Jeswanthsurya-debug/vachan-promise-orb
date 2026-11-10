/**
 * gnaniClient.ts — EVERY call to Gnani AI lives in this one file.
 *
 *   transcribe(audioBlob, lang) → Prisma  (speech-to-text)
 *   analyze(transcript, lang)   → Evon    (reasoning → strict JSON)
 *   speak(text, lang)           → Timbre  (text-to-speech)
 *
 * SERVER ONLY. It is imported by the /api/* route handlers and never by browser
 * code, so GNANI_API_KEY never reaches the browser.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  HOW TO GO LIVE (checklist)
 *   1. Put GNANI_API_KEY in .env (see .env.example).
 *   2. Put the three endpoint URLs in .env: GNANI_STT_URL, GNANI_EVON_URL, GNANI_TTS_URL.
 *   3. Search this file for "TODO" and fill each block from the official Gnani docs.
 *      I deliberately did NOT invent any endpoint, header or payload.
 *   Until then, the app safely falls back to DEMO MODE (built-in sample).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { DEMO_ANALYSIS, DEMO_TRANSCRIPT } from "./demoData";
import { normalizeAnalysis, parseJsonLoose, type Analysis } from "./analysis";

/** Thrown when a TODO below has not been filled in yet. Routes catch it and use demo data. */
export class GnaniNotConfiguredError extends Error {
  constructor(what: string) {
    super(`Gnani ${what} is not configured yet (see TODO in src/lib/gnaniClient.ts)`);
    this.name = "GnaniNotConfiguredError";
  }
}

/** Demo mode = no API key, or DEMO_MODE=true. */
export function isDemoMode(force = false): boolean {
  if (force) return true; // the user picked "Demo" in the app
  return process.env.DEMO_MODE === "true" || !process.env.GNANI_API_KEY;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ════════════════════════════════════════════════════════════════════════════
 * 1) PRISMA — speech to text
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface TranscribeResult {
  transcript: string;
  demo: boolean;
}

export async function transcribe(audioBlob: Blob | null, lang = "hi-en", forceDemo = false): Promise<TranscribeResult> {
  if (isDemoMode(forceDemo)) {
    await sleep(1400); // pretend to work so the "processing" animation is visible
    return { transcript: DEMO_TRANSCRIPT, demo: true };
  }
  if (!audioBlob) throw new Error("No audio received");

  // TODO(Prisma STT): set the exact endpoint from the official docs.
  const url = process.env.GNANI_STT_URL;
  if (!url) throw new GnaniNotConfiguredError("Prisma STT endpoint");

  // TODO(Prisma STT): build the exact request (auth header name, multipart vs JSON/base64,
  //   language-code format for `lang`, audio format/sample-rate requirements).
  //   Browser audio is usually WebM/Opus or MP4/AAC — check whether Prisma needs conversion.
  //
  //   const res = await fetch(url, {
  //     method: "POST",
  //     headers: { /* TODO: auth header using process.env.GNANI_API_KEY */ },
  //     body: /* TODO: FormData or JSON with audioBlob and lang */,
  //   });
  //   if (!res.ok) throw new Error(`Prisma STT failed: ${res.status}`);
  //   const json = await res.json();
  //   // TODO(Prisma STT): read the transcript text from the real response shape
  //   return { transcript: json./* TODO */, demo: false };
  void lang;
  throw new GnaniNotConfiguredError("Prisma STT request/response mapping");
}

/* ════════════════════════════════════════════════════════════════════════════
 * 2) EVON — reasoning (transcript → strict JSON analysis)
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The instruction we give Evon. It is ready to use — only the transport
 * (URL / headers / payload shape) below is a TODO.
 */
export const EVON_SYSTEM_PROMPT = `You are Vachan, an assistant that helps ordinary people understand spoken verbal agreements.
The transcript may be Hindi, Tamil, Telugu, Kannada, Bengali, Marathi, English or a mix (like Hinglish),
and may contain speech-to-text mistakes from noisy phone audio. Read it carefully and extract every promise.

Return STRICT JSON ONLY. No markdown, no code fences, no commentary. Use exactly this shape:
{
  "language": "hi-en",
  "parties": ["Name1","Name2"],
  "promises": [
    { "id": 1, "who": "person who must do it", "to": "person who receives it",
      "what": "short plain description", "amount": 20000, "due": "15 Dec",
      "risk": "green|amber|red", "reason": "one short plain-language sentence" }
  ],
  "summary": "2-3 simple sentences anyone can understand"
}

Rules for "risk":
- "red"   = hidden interest or extra charges, NO deadline, one-sided terms, or pressure / secrecy.
- "amber" = vague words such as "jaldi", "baad mein", "dekhte hain", "kal-parso", unclear amount or unclear date.
- "green" = clear amount (if money) AND clear deadline AND both sides agreed.
"amount" is a number in rupees, or null if no money is involved.
Write "what", "reason" and "summary" in very simple words, in the language requested by the user.
Never give legal advice. Output the JSON object and nothing else.`;

export async function analyze(transcript: string, lang = "hi-en", forceDemo = false): Promise<Analysis> {
  if (isDemoMode(forceDemo)) {
    await sleep(1800);
    return DEMO_ANALYSIS;
  }

  // TODO(Evon): set the exact endpoint from the official docs.
  const url = process.env.GNANI_EVON_URL;
  if (!url) throw new GnaniNotConfiguredError("Evon endpoint");

  // TODO(Evon): build the exact request. Put EVON_SYSTEM_PROMPT in whichever field Evon
  //   uses for instructions, and the transcript (+ requested output language `lang`) in the user input.
  //   If Evon has a "JSON mode" / response-format option, turn it on.
  //
  //   const res = await fetch(url, {
  //     method: "POST",
  //     headers: { /* TODO: auth header using process.env.GNANI_API_KEY, content-type */ },
  //     body: JSON.stringify(/* TODO: payload containing EVON_SYSTEM_PROMPT, transcript, lang */),
  //   });
  //   if (!res.ok) throw new Error(`Evon failed: ${res.status}`);
  //   const json = await res.json();
  //   const rawText: string = /* TODO: read the model's text out of the real response shape */ "";
  //
  //   // Cleans code fences, validates fields, fixes bad risk values:
  //   return normalizeAnalysis(parseJsonLoose(rawText), lang);
  void transcript;
  void normalizeAnalysis;
  void parseJsonLoose;
  throw new GnaniNotConfiguredError("Evon request/response mapping");
}

/* ════════════════════════════════════════════════════════════════════════════
 * 3) TIMBRE — text to speech
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface SpeakResult {
  data: ArrayBuffer;
  contentType: string; // e.g. "audio/mpeg" or "audio/wav"
}

/**
 * Returns audio bytes, or `null` in demo mode — the browser then reads the
 * summary aloud with its own built-in voice (speechSynthesis).
 */
export async function speak(text: string, lang = "hi-en", forceDemo = false): Promise<SpeakResult | null> {
  if (isDemoMode(forceDemo)) return null;

  // TODO(Timbre TTS): set the exact endpoint from the official docs.
  const url = process.env.GNANI_TTS_URL;
  if (!url) throw new GnaniNotConfiguredError("Timbre TTS endpoint");

  // TODO(Timbre TTS): build the exact request (auth header, voice name, language code for `lang`,
  //   output audio format).
  //
  //   const res = await fetch(url, {
  //     method: "POST",
  //     headers: { /* TODO: auth header using process.env.GNANI_API_KEY */ },
  //     body: JSON.stringify(/* TODO: { text, language, voice, format } in the real shape */),
  //   });
  //   if (!res.ok) throw new Error(`Timbre failed: ${res.status}`);
  //   // TODO(Timbre TTS): if the API returns base64 JSON instead of raw audio, decode it here.
  //   return { data: await res.arrayBuffer(), contentType: res.headers.get("content-type") ?? "audio/mpeg" };
  void text;
  void lang;
  throw new GnaniNotConfiguredError("Timbre TTS request/response mapping");
}
