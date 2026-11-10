"use client";
/**
 * Timeline.tsx — the "Promise Timeline" ribbon at the bottom.
 * A glowing line with one gem marker per promise, ordered by due date
 * (Today first, then dated promises, then ones with no real date).
 * Tap a marker to focus that promise in the 3D scene.
 */
import { RISK_HEX, iconFor, formatRupees, type PromiseItem } from "@/lib/analysis";

interface Props {
  promises: PromiseItem[];
  selected: number | null;
  onSelect: (index: number) => void;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Rough sort key for a due-date string. Smaller = sooner. Unknown dates go last. */
function dueKey(due: string, fallbackIndex: number): number {
  const d = due.toLowerCase();
  if (/today|aaj|இன்று/.test(d)) return 0;
  const m = d.match(/(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
  if (m) return 1 + MONTHS.indexOf(m[2]) * 40 + Number(m[1]);
  return 1000 + fallbackIndex;
}

export default function Timeline({ promises, selected, onSelect }: Props) {
  const items = promises
    .map((p, i) => ({ p, i, key: dueKey(p.due, i) }))
    .sort((a, b) => a.key - b.key || a.i - b.i);

  return (
    <nav className="glass card-in relative overflow-x-auto px-4 pb-2 pt-3" aria-label="Promise timeline">
      <div className="relative mx-auto" style={{ minWidth: items.length * 76, maxWidth: 720 }}>
        {/* the glowing line, with a light running along it */}
        <div className="absolute inset-x-8 top-[1.05rem]">
          <div className="tl-line" />
          <span className="tl-spark" />
        </div>

        <ol className="relative flex justify-between">
          {items.map(({ p, i }, order) => {
            const color = RISK_HEX[p.risk];
            return (
              <li key={p.id}>
                <button
                  className="tl-marker"
                  aria-current={selected === i}
                  aria-label={`Promise ${i + 1}: ${p.what}, due ${p.due}`}
                  onClick={() => onSelect(i)}
                  style={{ animationDelay: `${0.5 + order * 0.15}s` }}
                >
                  <span
                    className="tl-gem"
                    style={{
                      background: `linear-gradient(135deg, ${color}, ${color}55)`,
                      border: `1.5px solid ${color}`,
                      boxShadow: `0 0 ${selected === i ? 24 : 14}px ${color}, inset 0 0 8px rgba(255,255,255,0.5)`,
                    }}
                  >
                    <span aria-hidden>{iconFor(p)}</span>
                  </span>
                  <span className="mt-1 max-w-[4.6rem] truncate text-[11px] font-bold text-white" title={p.due}>
                    {p.due.replace(/\s*\(.*\)/, "")}
                  </span>
                  <span className="text-[10px] font-semibold text-amber-200/90">{p.amount !== null ? formatRupees(p.amount) : "—"}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
