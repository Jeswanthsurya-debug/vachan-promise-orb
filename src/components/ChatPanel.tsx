"use client";
/**
 * ChatPanel.tsx — the glass conversation panel.
 *   • desktop (≥1024px): slides in from the right, open by default
 *   • smaller screens:   a bottom sheet
 * Shows live speech as a user bubble, the assistant summary with colour chips, and a
 * "listening / understanding / confirming" status line. Tapping a chip focuses that
 * promise in the 3D scene.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { RISK_EMOJI, RISK_HEX, formatRupees, type Analysis } from "@/lib/analysis";
import type { Dict } from "@/lib/i18n";

export type ChatMsg =
  | { id: number; role: "user"; text: string; ts: number; live?: boolean; source: "voice" | "text" }
  | { id: number; role: "assistant"; text: string; ts: number; analysis: Analysis };

export type ChatStatus = "ready" | "listening" | "understanding" | "confirming";

interface Props {
  open: boolean;
  onClose: () => void;
  messages: ChatMsg[];
  status: ChatStatus;
  t: Dict;
  fontFamily: string;
  htmlLang: string;
  onChip: (analysis: Analysis, index: number) => void;
  /** the big Download button */
  headerExtra: ReactNode;
  /** the chat bar, shown here only when the panel is a bottom sheet */
  footer?: ReactNode;
}

const STATUS_STYLE: Record<ChatStatus, { color: string; pulse: boolean }> = {
  ready: { color: "#9A87B8", pulse: false },
  listening: { color: "#14F1D9", pulse: true },
  understanding: { color: "#A78BFA", pulse: true },
  confirming: { color: "#2DFF8F", pulse: false },
};

const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function ChatPanel({ open, onClose, messages, status, t, fontFamily, htmlLang, onChip, headerExtra, footer }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  // keep the newest bubble in view
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, open]);

  const statusText: Record<ChatStatus, string> = {
    ready: t.sReady,
    listening: t.sListening,
    understanding: t.sUnderstanding,
    confirming: t.sConfirming,
  };
  const st = STATUS_STYLE[status];

  return (
    <aside
      aria-label={t.chat}
      aria-hidden={!open}
      inert={!open}
      className={`glass fixed inset-x-2 bottom-2 z-30 flex h-[62dvh] flex-col max-lg:!bg-[#12081f]/95 transition-transform duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] lg:inset-x-auto lg:bottom-5 lg:right-5 lg:top-[7.25rem] lg:h-auto lg:w-[22rem] ${
        open ? "translate-x-0 translate-y-0" : "translate-y-[115%] lg:translate-x-[115%] lg:translate-y-0"
      }`}
      style={{ fontFamily }}
    >
      {/* header: title + close on the first row, status + big Download button on the second */}
      <div className="border-b border-white/10 px-4 pb-2.5 pt-3">
        <div className="flex items-center gap-2">
          <h2 className="font-head min-w-0 flex-1 truncate text-base font-extrabold">💬 {t.chat}</h2>
          <button onClick={onClose} className="icon-btn !h-9 !w-9" aria-label={t.closeLbl}>
            ✕
          </button>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-semibold" style={{ color: st.color }} aria-live="polite">
            <span className={`h-2 w-2 shrink-0 rounded-full ${st.pulse ? "animate-pulse" : ""}`} style={{ background: st.color, boxShadow: `0 0 10px ${st.color}` }} />
            <span className="truncate">{statusText[status]}</span>
          </div>
          <div className="shrink-0">{headerExtra}</div>
        </div>
      </div>

      {/* messages */}
      <div role="log" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3 pt-1">
        {messages.length === 0 && <p className="px-2 py-6 text-center text-sm leading-relaxed text-amber-100/70">{t.emptyChat}</p>}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="chat-bubble chat-user" lang={htmlLang}>
                <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-bold opacity-75">
                  <span aria-hidden>{m.source === "voice" ? "🎙️" : "⌨️"}</span>
                  {t.you}
                </div>
                {m.text ? (
                  <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">
                    {m.text}
                    {m.live && <span className="chat-caret" aria-hidden />}
                  </p>
                ) : (
                  <span className="typing-dots" aria-label={t.sListening}>
                    <i /><i /><i />
                  </span>
                )}
                <div className="mt-1 text-right text-[10px] opacity-60">{time(m.ts)}</div>
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex justify-start">
              <div className="chat-bubble chat-bot" lang={htmlLang}>
                <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-bold text-amber-200/80">
                  <span aria-hidden>🔮</span>
                  {t.vachan}
                </div>
                <p className="whitespace-pre-wrap break-words text-[15px] leading-snug text-slate-50">{m.text}</p>

                <ul className="mt-2.5 grid gap-1.5">
                  {m.analysis.promises.map((p, i) => {
                    const c = RISK_HEX[p.risk];
                    return (
                      <li key={p.id}>
                        <button
                          onClick={() => onChip(m.analysis, i)}
                          className="chip-promise"
                          style={{ borderColor: c + "aa", background: `linear-gradient(135deg, ${c}26, ${c}0a)` }}
                          title={t.chipHint}
                        >
                          <span className="flex items-center gap-1.5 text-[13px] font-bold text-white">
                            <span aria-hidden>{RISK_EMOJI[p.risk]}</span>
                            <span className="min-w-0 flex-1 truncate">{p.what}</span>
                            {p.amount !== null && <span className="shrink-0 text-xs" style={{ color: c }}>{formatRupees(p.amount)}</span>}
                          </span>
                          <span className="mt-0.5 block text-[12px] leading-snug text-slate-300">{p.reason}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-[11px] text-amber-100/60">{t.chipHint}</p>
                <div className="mt-1 text-[10px] text-slate-400">{time(m.ts)}</div>
              </div>
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      {footer && <div className="px-2 pb-2">{footer}</div>}
    </aside>
  );
}
