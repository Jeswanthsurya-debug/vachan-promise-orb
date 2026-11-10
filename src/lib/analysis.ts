/**
 * analysis.ts — the shape of the "analysis" JSON and a safety net around it.
 *
 * Shared by the server (gnaniClient.ts) and the browser (scene, cards, share image).
 * AI models sometimes return slightly broken JSON, so `normalizeAnalysis`
 * cleans whatever comes back and guarantees the UI always gets a valid object.
 */

export type Risk = "green" | "amber" | "red";

export interface PromiseItem {
  id: number;
  who: string; // the person who owes / must do something
  to: string; // the person who is owed
  what: string; // plain-language description
  amount: number | null; // rupees, if any
  due: string; // "15 Dec", "Every month", "Not fixed"...
  risk: Risk;
  reason: string; // short plain-language explanation
}

export interface Analysis {
  language: string; // e.g. "hi-en"
  parties: string[];
  promises: PromiseItem[];
  summary: string;
}

/** Friendly words used in the UI for each colour. */
export const RISK_LABEL: Record<Risk, string> = {
  green: "Clear",
  amber: "Unclear",
  red: "Risky",
};

/** "Aurora Saffron" risk colours — bright, glowing, still obvious to a beginner. */
export const RISK_HEX: Record<Risk, string> = {
  green: "#2DFF8F",
  amber: "#FFC83D",
  red: "#FF3B5C",
};

export const RISK_EMOJI: Record<Risk, string> = {
  green: "✅",
  amber: "⚠️",
  red: "🚨",
};

const isRisk = (v: unknown): v is Risk => v === "green" || v === "amber" || v === "red";

/** Pull a JSON object out of text that might be wrapped in ```json fences or chatter. */
export function parseJsonLoose(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("Model did not return JSON");
  }
}

/** Validate + clean an unknown value into a safe Analysis. Throws if it is unusable. */
export function normalizeAnalysis(input: unknown, fallbackLanguage = "hi-en"): Analysis {
  if (!input || typeof input !== "object") throw new Error("Analysis is not an object");
  const o = input as Record<string, unknown>;
  const rawPromises = Array.isArray(o.promises) ? o.promises : [];

  const promises: PromiseItem[] = rawPromises
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map((p, i) => {
      const amountNum = typeof p.amount === "number" ? p.amount : Number(p.amount);
      return {
        id: typeof p.id === "number" ? p.id : i + 1,
        who: String(p.who ?? "Someone"),
        to: String(p.to ?? "Someone"),
        what: String(p.what ?? "A promise"),
        amount: Number.isFinite(amountNum) && p.amount !== null && p.amount !== "" ? amountNum : null,
        due: String(p.due ?? "Not said"),
        risk: isRisk(p.risk) ? p.risk : "amber",
        reason: String(p.reason ?? ""),
      };
    });

  if (promises.length === 0) throw new Error("No promises found");

  const parties = Array.isArray(o.parties) ? o.parties.map(String) : [];
  for (const p of promises) {
    if (!parties.includes(p.who)) parties.push(p.who);
    if (!parties.includes(p.to)) parties.push(p.to);
  }

  return {
    language: typeof o.language === "string" ? o.language : fallbackLanguage,
    parties,
    promises,
    summary: typeof o.summary === "string" ? o.summary : "",
  };
}

export function formatRupees(n: number | null): string {
  if (n === null) return "—";
  return "₹" + n.toLocaleString("en-IN");
}

/**
 * Picks the icon floating inside each promise gem:
 * 🏠 rent, ⚠️ risky, 📅 unclear date, 💰 money, 🤝 any other promise.
 */
export function iconFor(p: PromiseItem): string {
  const text = `${p.what} ${p.reason}`.toLowerCase();
  if (/\b(rent|kiraya|kiraaya|lease|deposit)\b|किराया/.test(text)) return "🏠";
  if (p.risk === "red") return "⚠️";
  if (/jaldi|baad mein|not fixed|no end|not said|soon|later|vague/i.test(p.due)) return "📅";
  if (p.amount !== null) return "💰";
  return "🤝";
}
