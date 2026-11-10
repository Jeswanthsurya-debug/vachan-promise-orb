"use client";
/**
 * TrustMeter.tsx — ring chart (top-right) showing what share of the promises
 * are green (clear), amber (unclear) and red (risky). It animates from empty
 * to the final numbers every time new results arrive.
 */
import { useEffect, useState } from "react";
import { RISK_HEX, type PromiseItem, type Risk } from "@/lib/analysis";

const R = 38;
const C = 2 * Math.PI * R;
const ORDER: { risk: Risk; label: string }[] = [
  { risk: "green", label: "Clear" },
  { risk: "amber", label: "Unclear" },
  { risk: "red", label: "Risky" },
];

export default function TrustMeter({ promises }: { promises: PromiseItem[] }) {
  const total = Math.max(1, promises.length);
  const count = (r: Risk) => promises.filter((p) => p.risk === r).length;
  const green = Math.round((count("green") / total) * 100);
  const amber = Math.round((count("amber") / total) * 100);
  const pct: Record<Risk, number> = { green, amber, red: Math.max(0, 100 - green - amber) };

  // t goes 0 → 1 with easing; every number and arc below is multiplied by it
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now() + 500; // small delay: starts as the gems fly out
    const tick = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - t0) / 1800));
      setT(1 - Math.pow(1 - k, 3));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [promises]);

  let start = 0; // where each arc begins, as a fraction of the circle
  const arcs = ORDER.map(({ risk }) => {
    const frac = pct[risk] / 100;
    const len = Math.max(0, frac * C * t - (frac > 0 && frac < 1 ? 3 : 0));
    const arc = { risk, len, offset: -start * C };
    start += frac;
    return arc;
  });

  return (
    <section className="glass card-in flex items-center gap-3 p-2.5 sm:p-3" aria-label="Trust meter">
      <div className="relative h-[72px] w-[72px] shrink-0 sm:h-[92px] sm:w-[92px]">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="9" />
          {arcs.map((a) => (
            <circle
              key={a.risk}
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke={RISK_HEX[a.risk]}
              strokeWidth="9"
              strokeDasharray={`${a.len} ${C - a.len}`}
              strokeDashoffset={a.offset}
              style={{ filter: `drop-shadow(0 0 5px ${RISK_HEX[a.risk]})` }}
            />
          ))}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center leading-none">
          <div>
            <div className="font-head text-lg font-extrabold sm:text-2xl">{Math.round(pct.green * t)}%</div>
            <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-300 sm:text-[10px]">trust</div>
          </div>
        </div>
      </div>

      <ul className="hidden gap-1 text-xs font-semibold sm:grid">
        {ORDER.map(({ risk, label }) => (
          <li key={risk} className="flex items-center gap-2">
            <span className="dot" style={{ background: RISK_HEX[risk], boxShadow: `0 0 10px ${RISK_HEX[risk]}` }} />
            <span className="w-14 text-slate-200">{label}</span>
            <span className="font-head tabular-nums text-white">{Math.round(pct[risk] * t)}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
