/**
 * download.ts — turns sessions into files the user can keep.
 *
 *   .txt / .json / .csv   → text files, always UTF-8 (the .txt and .csv start with a BOM so
 *                           Excel and Notepad open Hindi, Tamil, Telugu, Kannada, Bengali
 *                           and Marathi correctly)
 *   PNG card / PDF        → a one-page summary of ONE session. The page is painted on a canvas
 *                           by the browser (so Indic scripts are shaped properly with the Noto
 *                           fonts) and the PDF simply wraps that picture. No libraries.
 */
import { RISK_EMOJI, RISK_HEX, RISK_LABEL, formatRupees, iconFor } from "./analysis";
import { ALL_NOTO, fontStack, langLabel, type Dict } from "./i18n";
import { exportFileName, toCsv, toJson, toTxt, type SessionEntry } from "./sessionLog";

const BOM = "\uFEFF";

/** Saves a Blob through a temporary link (Blob + URL.createObjectURL). */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadData(sessions: SessionEntry[], kind: "txt" | "json" | "csv") {
  if (kind === "txt") {
    saveBlob(new Blob([BOM + toTxt(sessions)], { type: "text/plain;charset=utf-8" }), exportFileName("txt"));
  } else if (kind === "csv") {
    saveBlob(new Blob([BOM + toCsv(sessions)], { type: "text/csv;charset=utf-8" }), exportFileName("csv"));
  } else {
    saveBlob(new Blob([toJson(sessions)], { type: "application/json;charset=utf-8" }), exportFileName("json"));
  }
}

/* ═════════════════ the one-page card ═════════════════ */

const W = 1240; // A4 at ~150 dpi
const H = 1754;
const M = 80;

/** Make sure the Noto fonts needed for this text are loaded before we draw it. */
async function ensureFonts(s: SessionEntry) {
  const sample = [s.transcript, s.summary, ...s.promises.map((p) => `${p.who}${p.to}${p.what}${p.due}${p.reason}`)]
    .join(" ")
    .slice(0, 600);
  try {
    const loads: Promise<unknown>[] = [];
    for (const f of [...ALL_NOTO, "Inter", "Sora"]) {
      loads.push(document.fonts.load(`400 28px "${f}"`, sample), document.fonts.load(`700 28px "${f}"`, sample));
    }
    await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 3500))]);
  } catch {
    /* draw with whatever is available */
  }
}

/** Word-wraps (also splits very long words) and adds "…" when text is cut. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width <= maxW) {
        line = test;
        continue;
      }
      if (line) lines.push(line);
      line = word;
      while (ctx.measureText(line).width > maxW && line.length > 1) {
        let k = line.length - 1;
        while (k > 1 && ctx.measureText(line.slice(0, k)).width > maxW) k--;
        lines.push(line.slice(0, k));
        line = line.slice(k);
      }
    }
    lines.push(line);
  }
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    let last = cut[maxLines - 1];
    while (last.length > 1 && ctx.measureText(last + "…").width > maxW) last = last.slice(0, -1);
    cut[maxLines - 1] = last.replace(/\s+$/, "") + "…";
    return cut;
  }
  return lines;
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color + Math.round(alpha * 255).toString(16).padStart(2, "0"));
  g.addColorStop(1, color + "00");
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

export async function renderSessionCard(s: SessionEntry, t: Dict): Promise<HTMLCanvasElement> {
  await ensureFonts(s);
  const FONT = fontStack(s.language);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const font = (px: number, weight: 400 | 700 = 400) => (ctx.font = `${weight} ${px}px ${FONT}`);

  // Aurora Saffron background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0A0612");
  bg.addColorStop(1, "#1A0B2E");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  glow(ctx, 160, 260, 560, "#FF3D9A", 0.3);
  glow(ctx, 1100, 360, 600, "#7C3AED", 0.38);
  glow(ctx, 640, 1500, 640, "#14F1D9", 0.12);
  glow(ctx, 100, 1650, 460, "#FF9F1C", 0.2);

  // title + meta
  ctx.textAlign = "left";
  const tg = ctx.createLinearGradient(M, 0, M + 300, 0);
  tg.addColorStop(0, "#FFC83D");
  tg.addColorStop(0.5, "#FF3D9A");
  tg.addColorStop(1, "#A78BFA");
  ctx.fillStyle = tg;
  ctx.font = `700 80px "Sora", ${FONT}`;
  ctx.fillText("Vachan", M, 150);
  ctx.fillStyle = "#FFE3A3";
  font(30);
  ctx.fillText("Your word, made visible", M + 330, 148);

  const when = new Date(s.ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  ctx.fillStyle = "#C9B4E6";
  font(27);
  const meta = `${when}  ·  ${langLabel(s.language)}  ·  ${s.mode === "demo" ? "Demo" : "Live"}  ·  ${s.input === "voice" ? t.voice : t.text}`;
  ctx.fillText(wrap(ctx, meta, W - 2 * M, 1)[0], M, 210);

  let y = 250;
  const innerW = W - 2 * M - 64;

  /** A rounded panel with a small label and wrapped body text. */
  const panel = (label: string, body: string, maxLines: number, fill: string, stroke: string, labelColor: string) => {
    font(34);
    const lines = wrap(ctx, body || "-", innerW, maxLines);
    const lh = 50;
    const h = 40 + 38 + lines.length * lh + 28;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(M, y, W - 2 * M, h, 28);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = labelColor;
    font(26, 700);
    ctx.fillText(label, M + 32, y + 50);
    ctx.fillStyle = "#F5EBFF";
    font(34);
    lines.forEach((l, i) => ctx.fillText(l, M + 32, y + 40 + 38 + 8 + i * lh));
    y += h + 26;
  };

  panel(`🎙️ ${t.you}`, s.transcript, 7, "rgba(255,159,28,0.12)", "rgba(255,159,28,0.55)", "#FFC83D");
  panel(`🔮 ${t.vachan}`, s.summary, 6, "rgba(124,58,237,0.2)", "rgba(167,139,250,0.55)", "#C4B5FD");

  // promises
  const footerTop = H - 120;
  let drawn = 0;
  for (const p of s.promises) {
    const col = RISK_HEX[p.risk];
    font(32, 700);
    const title = wrap(ctx, `${p.who} → ${p.to}: ${p.what}`, W - 2 * M - 330, 2);
    font(27);
    const reason = p.reason ? wrap(ctx, p.reason, W - 2 * M - 150, 2) : [];
    const h = 32 + title.length * 44 + 40 + reason.length * 38 + 24;
    if (y + h > footerTop - 40) break;

    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.beginPath();
    ctx.roundRect(M, y, W - 2 * M, h, 26);
    ctx.fill();
    ctx.strokeStyle = col + "99";
    ctx.lineWidth = 2;
    ctx.stroke();
    // left colour bar
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.roundRect(M, y + 14, 8, h - 28, 4);
    ctx.fill();
    // icon
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.font = "44px 'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif";
    ctx.fillText(iconFor(p), M + 62, y + 70);
    ctx.textAlign = "left";

    let ty = y + 48;
    ctx.fillStyle = "#fff";
    font(32, 700);
    title.forEach((l, i) => ctx.fillText(l, M + 110, ty + i * 44));
    ty += (title.length - 1) * 44 + 42;
    ctx.fillStyle = "#FFE3A3";
    font(27);
    ctx.fillText(`${formatRupees(p.amount)}  ·  ${p.due || "-"}`, M + 110, ty);
    ctx.fillStyle = "#D9C7F0";
    reason.forEach((l, i) => ctx.fillText(l, M + 110, ty + 40 + i * 38));

    // risk badge (top-right)
    ctx.textAlign = "right";
    ctx.fillStyle = col;
    font(28, 700);
    ctx.fillText(`${RISK_EMOJI[p.risk]} ${RISK_LABEL[p.risk]}`, W - M - 28, y + 48);
    ctx.textAlign = "left";

    y += h + 18;
    drawn++;
  }
  if (drawn < s.promises.length) {
    ctx.fillStyle = "#C9B4E6";
    font(28);
    ctx.fillText(`+ ${s.promises.length - drawn} more`, M, y + 22);
  }

  // footer
  ctx.textAlign = "center";
  ctx.fillStyle = "#9A87B8";
  font(24);
  ctx.fillText("Powered by Gnani AI (Prisma, Evon, Timbre). Not legal advice.", W / 2, H - 70);
  ctx.fillText(`${t.privacy}  ·  ${s.provider}`.slice(0, 120), W / 2, H - 36);
  return c;
}

/* ═════════════════ tiny PDF writer (one JPEG page) ═════════════════ */

function buildPdf(jpeg: Uint8Array, imgW: number, imgH: number): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let len = 0;
  const push = (d: string | Uint8Array) => {
    const b = typeof d === "string" ? enc.encode(d) : d;
    parts.push(b);
    len += b.length;
  };
  const PW = 595; // A4 in points
  const PH = 842;

  push("%PDF-1.4\n");
  offsets[1] = len;
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  offsets[2] = len;
  push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  offsets[3] = len;
  push(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`);
  offsets[4] = len;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  push("\nendstream\nendobj\n");
  const content = `q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;
  offsets[5] = len;
  push(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
  const xref = len;
  push("xref\n0 6\n0000000000 65535 f \n");
  for (let i = 1; i <= 5; i++) push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

export async function downloadCard(session: SessionEntry, kind: "png" | "pdf", t: Dict) {
  const canvas = await renderSessionCard(session, t);
  if (kind === "png") {
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG failed"))), "image/png"),
    );
    saveBlob(blob, exportFileName("png"));
    return;
  }
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  const bin = atob(dataUrl.split(",")[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  saveBlob(buildPdf(bytes, canvas.width, canvas.height), exportFileName("pdf"));
}
