"use client";
/**
 * LogDrawer.tsx — slide-in drawer listing every saved session (newest first) with
 * search, a language filter, downloads and "Clear log" (with confirmation).
 * Everything shown here comes from localStorage["vachan_log"] — it never leaves this device.
 */
import { useMemo, useState } from "react";
import { RISK_EMOJI, RISK_HEX, RISK_LABEL, formatRupees } from "@/lib/analysis";
import { LANGS, langLabel, type Dict } from "@/lib/i18n";
import type { SessionEntry } from "@/lib/sessionLog";
import DownloadMenu, { type DownloadResult } from "./DownloadMenu";

interface Props {
  open: boolean;
  onClose: () => void;
  sessions: SessionEntry[];
  t: Dict;
  fontFamily: string;
  htmlLang: string;
  onClear: () => void;
  onDownloadDone: (r: DownloadResult) => void;
}

export default function LogDrawer({ open, onClose, sessions, t, fontFamily, htmlLang, onClear, onDownloadDone }: Props) {
  const [query, setQuery] = useState("");
  const [langFilter, setLangFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions
      .filter((s) => langFilter === "all" || s.language === langFilter)
      .filter((s) => {
        if (!q) return true;
        const hay = [
          s.transcript,
          s.summary,
          s.provider,
          langLabel(s.language),
          s.mode,
          s.input,
          ...s.promises.flatMap((p) => [p.who, p.to, p.what, p.due, p.reason, p.risk, RISK_LABEL[p.risk]]),
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => (a.ts < b.ts ? 1 : -1)); // newest first
  }, [sessions, query, langFilter]);

  if (!open) return null;

  const cardSession = shown.find((s) => s.id === selectedId) ?? shown[0] ?? null;

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={t.logTitle}>
      <div className="absolute inset-0 bg-[#0A0612]/60 backdrop-blur-[2px]" onClick={onClose} />
      <section
        className="glass drawer-in absolute inset-y-2 right-2 flex w-[min(calc(100vw-1rem),31rem)] flex-col"
        style={{ fontFamily }}
      >
        {/* header */}
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2 pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-head text-lg font-extrabold">📜 {t.logTitle}</h2>
            <p className="text-xs text-amber-100/70">
              {sessions.length} {t.sessions}
            </p>
          </div>
          <DownloadMenu t={t} sessions={shown} cardSession={cardSession} variant="big" fontFamily={fontFamily} onDone={onDownloadDone} />
          <button onClick={onClose} className="icon-btn" aria-label={t.closeLbl}>
            ✕
          </button>
        </div>

        <p className="mx-4 mb-2 flex items-center gap-1.5 rounded-xl bg-[#14F1D9]/10 px-3 py-1.5 text-xs font-semibold text-[#9bfff0] ring-1 ring-[#14F1D9]/30">
          🔒 {t.privacy}
        </p>

        {/* filters */}
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.search}
            lang={htmlLang}
            aria-label={t.search}
            className="select min-w-0 flex-1 !max-w-none !cursor-text !rounded-xl"
            style={{ fontFamily }}
          />
          <select value={langFilter} onChange={(e) => setLangFilter(e.target.value)} className="select" aria-label={t.allLangs}>
            <option value="all">{t.allLangs}</option>
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        {/* cards */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3">
          {shown.length === 0 && (
            <p className="px-3 py-10 text-center text-sm text-amber-100/70">{sessions.length === 0 ? t.noSessions : t.noMatch}</p>
          )}
          {shown.map((s) => {
            const on = s.id === cardSession?.id;
            return (
              <article
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`cursor-pointer rounded-[24px] bg-white/[0.06] p-3.5 ring-1 transition ${on ? "ring-[#FF9F1C]/80 shadow-[0_0_24px_rgba(255,159,28,0.25)]" : "ring-white/10"}`}
                lang={htmlLang}
              >
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                  <span className="text-slate-300">{new Date(s.ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
                  <span className="pill">{langLabel(s.language)}</span>
                  <span className={`pill ${s.mode === "demo" ? "!text-amber-300" : "!text-[#2DFF8F]"}`}>{s.mode === "demo" ? "Demo" : "Live"}</span>
                  <span className="pill">
                    {s.input === "voice" ? "🎙️" : "⌨️"} {s.input === "voice" ? t.voice : t.text}
                  </span>
                </div>

                <p className="mt-2 line-clamp-3 whitespace-pre-line text-[14px] leading-snug text-slate-100">“{s.transcript}”</p>
                <p className="mt-1.5 text-[13px] leading-snug text-amber-100/80">{s.summary}</p>

                <ul className="mt-2 grid gap-1">
                  {s.promises.map((p) => {
                    const c = RISK_HEX[p.risk];
                    return (
                      <li key={p.id} className="rounded-xl px-2.5 py-1.5 text-[12.5px] leading-snug" style={{ background: c + "1a", border: `1px solid ${c}66` }}>
                        <span className="font-bold text-white">
                          {RISK_EMOJI[p.risk]} {p.who} → {p.to}: {p.what}
                        </span>
                        <span className="text-slate-300">
                          {" "}
                          · {formatRupees(p.amount)} · {p.due}
                        </span>
                        {p.reason && <span className="block text-slate-400">{p.reason}</span>}
                      </li>
                    );
                  })}
                </ul>

                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
                  <span className="truncate text-[10px] text-slate-500" title={s.provider}>
                    {s.provider}
                  </span>
                  <DownloadMenu t={t} sessions={[s]} cardSession={s} variant="small" label={t.dlSession} fontFamily={fontFamily} onDone={onDownloadDone} />
                </div>
              </article>
            );
          })}
        </div>

        {/* clear log */}
        <div className="border-t border-white/10 px-4 py-3">
          {confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 text-sm font-semibold text-[#FF8FA5]">{t.clearAsk}</span>
              <button
                onClick={() => {
                  onClear();
                  setConfirming(false);
                  setSelectedId(null);
                }}
                className="btn-soft !border-[#FF3B5C] !bg-[#FF3B5C]/25"
              >
                {t.yesClear}
              </button>
              <button onClick={() => setConfirming(false)} className="btn-soft">
                {t.cancel}
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirming(true)} disabled={sessions.length === 0} className="btn-soft !text-[#FF8FA5] disabled:opacity-40">
              🗑️ {t.clearLog}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
