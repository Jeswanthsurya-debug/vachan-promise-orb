"use client";
/**
 * HowToOverlay.tsx — one-screen "How to use" guide, shown on first visit
 * (remembered in localStorage) and re-openable with the "?" button.
 */
interface Props {
  onClose: () => void;
}

const STEPS = [
  { icon: "🎙️", title: "Tap and speak", text: "Press the big mic and say the agreement out loud. Hindi, Tamil, Hinglish — any is fine." },
  { icon: "▶️", title: "Or just watch the demo", text: "Tap “Play Demo” for a hands-free 45-second show. No microphone needed." },
  { icon: "🚦", title: "Check the colours", text: "Green is clear. Amber is unclear. Red is risky. Tap any crystal to see why." },
  { icon: "🖐️", title: "Or use your hands", text: "Turn on Gesture mode: palm to turn, pinch to zoom, swipe for next, fist to listen." },
];

export default function HowToOverlay({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#0A0612]/80 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="How to use Vachan"
    >
      <div className="glass card-in max-h-[92dvh] w-full max-w-lg overflow-y-auto p-5 sm:p-7">
        <h2 className="font-head bg-gradient-to-r from-[#FFC83D] via-[#FF3D9A] to-[#7C3AED] bg-clip-text text-center text-2xl font-extrabold text-transparent sm:text-3xl">
          Welcome to Vachan
        </h2>
        <p className="mt-1 text-center text-slate-300">Your word, made visible.</p>

        <ol className="mt-5 grid gap-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex items-start gap-3 rounded-2xl bg-white/[0.06] p-3 ring-1 ring-white/10">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#FF9F1C]/30 to-[#FF3D9A]/20 text-3xl" aria-hidden>
                {s.icon}
              </span>
              <div>
                <div className="font-head font-bold text-white">
                  {i + 1}. {s.title}
                </div>
                <div className="text-sm leading-snug text-slate-300">{s.text}</div>
              </div>
            </li>
          ))}
        </ol>

        <button onClick={onClose} className="btn-grad mt-5 w-full" autoFocus>
          Got it — let&apos;s start
        </button>
        <p className="mt-3 text-center text-xs text-slate-400">Not legal advice. Your key stays on our server, never in your browser.</p>
      </div>
    </div>
  );
}
