"use client";
/**
 * DownloadMenu.tsx — a "Download" button with a small menu:
 *   .txt · .json · .csv   → export `sessions`
 *   PDF · PNG card        → one-page summary of `cardSession`
 *
 * The menu is drawn in a portal on <body> with fixed coordinates, so it is never
 * clipped by a scrolling panel or moved by a glass (backdrop-filter) parent.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { downloadCard, downloadData } from "@/lib/download";
import type { Dict } from "@/lib/i18n";
import type { SessionEntry } from "@/lib/sessionLog";

export type DownloadResult = "ok" | "empty" | "error";

interface Props {
  t: Dict;
  sessions: SessionEntry[];
  cardSession: SessionEntry | null;
  variant: "big" | "small";
  /** Text on the button. Defaults to "Download". */
  label?: string;
  fontFamily?: string;
  onDone: (result: DownloadResult) => void;
}

const MENU_W = 272;

export default function DownloadMenu({ t, sessions, cardSession, variant, label, fontFamily, onDone }: Props) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => setPos(null);

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (menuRef.current?.contains(n) || btnRef.current?.contains(n)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [pos]);

  const toggle = () => {
    if (pos) return close();
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(window.innerWidth - MENU_W - 8, r.right - MENU_W));
    const roomBelow = window.innerHeight - r.bottom;
    setPos(roomBelow > 290 ? { left, top: r.bottom + 8 } : { left, bottom: window.innerHeight - r.top + 8 });
  };

  const run = async (kind: "txt" | "json" | "csv" | "pdf" | "png") => {
    close();
    setBusy(true);
    try {
      if (kind === "pdf" || kind === "png") {
        if (!cardSession) return onDone("empty");
        await downloadCard(cardSession, kind, t);
      } else {
        if (sessions.length === 0) return onDone("empty");
        downloadData(sessions, kind);
      }
      onDone("ok");
    } catch {
      onDone("error");
    } finally {
      setBusy(false);
    }
  };

  const items: { kind: "txt" | "json" | "csv" | "pdf" | "png"; icon: string; text: string }[] = [
    { kind: "txt", icon: "📄", text: t.dlTxt },
    { kind: "json", icon: "🧩", text: t.dlJson },
    { kind: "csv", icon: "📊", text: t.dlCsv },
    { kind: "pdf", icon: "📕", text: t.dlPdf },
    { kind: "png", icon: "🖼️", text: t.dlPng },
  ];

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        className={variant === "big" ? "btn-grad !min-h-[2.5rem] !rounded-full !px-4 !text-sm disabled:opacity-60" : "btn-soft !min-h-[2.2rem] !text-xs"}
      >
        <span aria-hidden>{busy ? "⏳" : "⬇️"}</span>
        {label ?? t.download}
        <span aria-hidden className="text-[10px] opacity-70">▾</span>
      </button>

      {pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="menu-pop"
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: MENU_W, fontFamily }}
          >
            {items.map((it) => (
              <button key={it.kind} role="menuitem" onClick={() => void run(it.kind)} className="menu-item">
                <span aria-hidden className="text-lg">{it.icon}</span>
                <span className="flex-1 text-left">{it.text}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
