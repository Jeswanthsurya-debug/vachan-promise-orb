"use client";
/**
 * ChatBar.tsx — the "Type your agreement here..." box next to the mic.
 *   Enter = send · Shift+Enter = new line · "/" anywhere focuses it (handled in VachanApp).
 * It works with any script. While an IME is composing (Hindi/Tamil/… keyboards), Enter
 * confirms the word instead of sending.
 */
import { useEffect, type RefObject } from "react";
import type { Dict } from "@/lib/i18n";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  /** true while recording / processing / a demo is running */
  busy: boolean;
  t: Dict;
  fontFamily: string;
  htmlLang: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

export default function ChatBar({ value, onChange, onSend, busy, t, fontFamily, htmlLang, inputRef }: Props) {
  // grow with the text (up to ~4 lines), shrink back after sending
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 112) + "px";
  }, [value, inputRef]);

  const canSend = value.trim().length > 0 && !busy;

  return (
    <form
      className="glass !rounded-[22px] flex w-full items-end gap-2 p-1.5 pl-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
    >
      <label className="sr-only" htmlFor="vachan-chat-input">
        {t.placeholder}
      </label>
      <textarea
        id="vachan-chat-input"
        ref={inputRef}
        rows={1}
        value={value}
        lang={htmlLang}
        dir="auto"
        spellCheck={false}
        enterKeyHint="send"
        placeholder={t.placeholder}
        title={t.hint}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSend) onSend();
          }
        }}
        className="max-h-28 min-h-[2.4rem] flex-1 resize-none bg-transparent py-2 text-[15px] leading-snug text-white outline-none placeholder:text-amber-100/50"
        style={{ fontFamily }}
      />
      <button
        type="submit"
        disabled={!canSend}
        aria-label={t.send}
        className="btn-grad !min-h-[2.4rem] !rounded-[16px] !px-3.5 !text-sm disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="hidden sm:inline">{t.send}</span>
        <span aria-hidden className="sm:ml-1">➤</span>
      </button>
    </form>
  );
}
