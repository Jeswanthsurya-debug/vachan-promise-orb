"use client";
/**
 * PromiseCard.tsx — the glass card shown when a gem is clicked / focused.
 * Big friendly icons: who, to whom, what, amount, due date, and the reason in plain words.
 */
import { RISK_EMOJI, RISK_HEX, RISK_LABEL, formatRupees, iconFor, type PromiseItem } from "@/lib/analysis";

interface Props {
  promise: PromiseItem;
  index: number;
  total: number;
  speaking: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onHear: () => void;
}

function Row({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/[0.06] px-3 py-2 ring-1 ring-white/10">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-white/15 to-white/5 text-2xl" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/70">{label}</div>
        <div className="truncate text-[15px] font-semibold text-white" title={value}>
          {value}
        </div>
      </div>
    </div>
  );
}

export default function PromiseCard({ promise: p, index, total, speaking, onPrev, onNext, onClose, onHear }: Props) {
  const color = RISK_HEX[p.risk];
  return (
    <section
      className="glass card-in max-h-[calc(100dvh-25.5rem)] w-full overflow-y-auto p-4 sm:max-h-full"
      style={{ boxShadow: `0 12px 44px rgba(4,0,12,0.6), 0 0 46px ${color}38, inset 0 0 30px ${color}14` }}
      aria-label={`Promise ${index + 1} of ${total}`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-3xl ${p.risk === "red" ? "animate-pulse" : ""}`}
          style={{ background: `linear-gradient(135deg, ${color}40, ${color}12)`, border: `2px solid ${color}`, boxShadow: `0 0 20px ${color}77` }}
          aria-hidden
        >
          {iconFor(p)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-slate-300">
            Promise {index + 1} of {total}
          </div>
          <div className="font-head text-xl font-extrabold" style={{ color, textShadow: `0 0 16px ${color}88` }}>
            {RISK_EMOJI[p.risk]} {RISK_LABEL[p.risk]}
          </div>
        </div>
        <button onClick={onClose} className="icon-btn" aria-label="Close card">
          ✕
        </button>
      </div>

      <div className="mt-3 grid gap-2">
        <Row icon="🙋" label="Who promises" value={p.who} />
        <Row icon="🤝" label="To whom" value={p.to} />
        <Row icon="📝" label="What" value={p.what} />
        <div className="grid grid-cols-2 gap-2">
          <Row icon="💰" label="Amount" value={formatRupees(p.amount)} />
          <Row icon="📅" label="When" value={p.due} />
        </div>
      </div>

      <div className="mt-3 rounded-2xl p-3 ring-1" style={{ background: `linear-gradient(135deg, ${color}26, ${color}0d)`, ["--tw-ring-color" as string]: color + "55" }}>
        <div className="mb-1 flex items-center gap-2 text-sm font-bold text-white">
          <span className="text-xl" aria-hidden>
            💡
          </span>
          Why this colour
        </div>
        <p className="text-[15px] leading-snug text-slate-100">{p.reason}</p>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button onClick={onPrev} className="icon-btn" aria-label="Previous promise">
          ◀
        </button>
        <button onClick={onHear} className="btn-grad flex-1 !min-h-[2.6rem] !text-[0.95rem]">
          {speaking ? "⏹ Stop" : "🔊 Hear this"}
        </button>
        <button onClick={onNext} className="icon-btn" aria-label="Next promise">
          ▶
        </button>
      </div>
    </section>
  );
}
