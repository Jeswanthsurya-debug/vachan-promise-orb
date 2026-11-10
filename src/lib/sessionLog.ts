/**
 * sessionLog.ts — the on-device session log.
 *
 *  • Every finished analysis is saved as one "session" in localStorage["vachan_log"].
 *  • Only the fields listed in SessionEntry are ever stored. API keys never reach the
 *    browser at all, and nothing from .env is read here.
 *  • Also builds the text of the .txt / .json / .csv exports.
 */
import { RISK_LABEL, type PromiseItem, type Risk } from "./analysis";
import { langLabel } from "./i18n";

export const LOG_KEY = "vachan_log";
export const MAX_SESSIONS = 200;

export type TranscriptSource = "typed" | "prisma" | "browser-preview" | "demo-sample";

export interface SessionEntry {
  id: string;
  ts: string; // ISO timestamp
  language: string; // e.g. "hi-IN"
  mode: "demo" | "live";
  input: "voice" | "text";
  transcript: string;
  transcriptSource: TranscriptSource;
  parties: string[];
  promises: PromiseItem[];
  summary: string;
  provider: string; // e.g. "Demo sample" or "Gnani Prisma (speech-to-text) + Evon (analysis)"
}

/* ───────── storage ───────── */

const isRisk = (v: unknown): v is Risk => v === "green" || v === "amber" || v === "red";

function cleanPromise(p: unknown, i: number): PromiseItem | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  const amount = typeof o.amount === "number" && Number.isFinite(o.amount) ? o.amount : null;
  return {
    id: typeof o.id === "number" ? o.id : i + 1,
    who: String(o.who ?? ""),
    to: String(o.to ?? ""),
    what: String(o.what ?? ""),
    amount,
    due: String(o.due ?? ""),
    risk: isRisk(o.risk) ? o.risk : "amber",
    reason: String(o.reason ?? ""),
  };
}

function cleanSession(s: unknown): SessionEntry | null {
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.ts !== "string") return null;
  const sources: TranscriptSource[] = ["typed", "prisma", "browser-preview", "demo-sample"];
  return {
    id: o.id,
    ts: o.ts,
    language: String(o.language ?? "hi-en"),
    mode: o.mode === "live" ? "live" : "demo",
    input: o.input === "text" ? "text" : "voice",
    transcript: String(o.transcript ?? ""),
    transcriptSource: sources.includes(o.transcriptSource as TranscriptSource)
      ? (o.transcriptSource as TranscriptSource)
      : "demo-sample",
    parties: Array.isArray(o.parties) ? o.parties.map(String) : [],
    promises: (Array.isArray(o.promises) ? o.promises : [])
      .map(cleanPromise)
      .filter((p): p is PromiseItem => p !== null),
    summary: String(o.summary ?? ""),
    provider: String(o.provider ?? ""),
  };
}

/** Reads the log. Never throws: a broken or blocked store just gives an empty log. */
export function loadSessions(): SessionEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : (parsed as { sessions?: unknown })?.sessions;
    if (!Array.isArray(list)) return [];
    return list.map(cleanSession).filter((s): s is SessionEntry => s !== null);
  } catch {
    return [];
  }
}

/** Returns false if the browser refused (storage full or blocked). */
export function saveSessions(sessions: SessionEntry[]): boolean {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify({ version: 1, sessions }));
    return true;
  } catch {
    return false;
  }
}

export function clearSessions() {
  try {
    localStorage.removeItem(LOG_KEY);
  } catch {
    /* ignore */
  }
}

export function makeSession(data: Omit<SessionEntry, "id" | "ts">): SessionEntry {
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);
  return { id: rnd, ts: new Date().toISOString(), ...data };
}

/* ───────── export helpers ───────── */

const pad = (n: number) => String(n).padStart(2, "0");

/** "2025-11-07-1531" — used in every file name. */
export function stamp(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
export function exportFileName(ext: string): string {
  return `vachan-log-${stamp()}.${ext}`;
}

function dateTime(ts: string): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function clock(ts: string): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const RISK_DOT: Record<Risk, string> = { green: "🟢", amber: "🟡", red: "🔴" };
const rupees = (n: number | null) => (n === null ? "-" : "₹" + n.toLocaleString("en-IN"));

/** Readable chat transcript with timestamps and promises. */
export function toTxt(sessions: SessionEntry[]): string {
  const out: string[] = [];
  out.push("VACHAN — Your word, made visible");
  out.push(`Exported: ${dateTime(new Date().toISOString())}`);
  out.push("Stored only on your device. Not legal advice.");
  sessions.forEach((s, i) => {
    out.push("", "=".repeat(64));
    out.push(`Session ${i + 1} — ${dateTime(s.ts)}`);
    out.push(`Language: ${langLabel(s.language)} | Mode: ${s.mode === "demo" ? "Demo" : "Live"} | Input: ${s.input === "voice" ? "Voice" : "Text"}`);
    out.push(`Provider: ${s.provider || "-"}`);
    out.push("=".repeat(64), "");
    out.push(`[${clock(s.ts)}] You:`);
    out.push(s.transcript || "-", "");
    out.push(`[${clock(s.ts)}] Vachan:`);
    out.push(s.summary || "-", "");
    out.push(`Promises (${s.promises.length}):`);
    s.promises.forEach((p, k) => {
      out.push(`  ${k + 1}. ${RISK_DOT[p.risk]} ${RISK_LABEL[p.risk].toUpperCase()} — ${p.who} → ${p.to}: ${p.what}`);
      out.push(`     Amount: ${rupees(p.amount)} | Due: ${p.due || "-"}`);
      if (p.reason) out.push(`     Why: ${p.reason}`);
    });
  });
  return out.join("\r\n") + "\r\n";
}

export function toJson(sessions: SessionEntry[]): string {
  return JSON.stringify({ app: "Vachan", exportedAt: new Date().toISOString(), sessions }, null, 2);
}

/** One row per promise. Quotes are doubled; cells that look like formulas are neutralised. */
export function toCsv(sessions: SessionEntry[]): string {
  const cell = (v: string | number | null): string => {
    let s = v === null ? "" : String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // stops Excel running it as a formula
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows: string[] = ["date,language,who,to,what,amount,due,risk,reason"];
  for (const s of sessions) {
    for (const p of s.promises) {
      rows.push(
        [dateTime(s.ts), s.language, p.who, p.to, p.what, p.amount, p.due, p.risk, p.reason].map(cell).join(","),
      );
    }
  }
  return rows.join("\r\n") + "\r\n";
}
