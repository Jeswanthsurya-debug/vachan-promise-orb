/**
 * shareCard.ts — draws the "Share" PNG in the Aurora Saffron theme:
 * orb snapshot + summary + every promise. Pure canvas drawing, no libraries.
 * On phones it opens the native share sheet; elsewhere it downloads the image.
 */
import { RISK_EMOJI, RISK_HEX, RISK_LABEL, formatRupees, iconFor, type Analysis } from "./analysis";

const W = 1080;
const H = 1620;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = cut[maxLines - 1].replace(/\s*\S*$/, "") + "…";
    return cut;
  }
  return lines;
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color + Math.round(alpha * 255).toString(16).padStart(2, "0"));
  g.addColorStop(1, color + "00");
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

export async function createShareCard(analysis: Analysis, orbCanvas: HTMLCanvasElement): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;

  // midnight plum + aurora blobs
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0A0612");
  bg.addColorStop(1, "#1A0B2E");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  blob(ctx, 180, 380, 560, "#FF3D9A", 0.32);
  blob(ctx, 920, 520, 600, "#7C3AED", 0.4);
  blob(ctx, 560, 1250, 600, "#14F1D9", 0.16);
  blob(ctx, 120, 1450, 480, "#FF9F1C", 0.22);
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = `rgba(255,${190 + Math.random() * 50},${90 + Math.random() * 80},${Math.random() * 0.6})`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }

  // title (gradient text)
  ctx.textAlign = "center";
  const tg = ctx.createLinearGradient(W / 2 - 160, 0, W / 2 + 160, 0);
  tg.addColorStop(0, "#FFC83D");
  tg.addColorStop(0.5, "#FF3D9A");
  tg.addColorStop(1, "#A78BFA");
  ctx.fillStyle = tg;
  ctx.font = "800 76px Sora, system-ui, sans-serif";
  ctx.fillText("Vachan", W / 2, 110);
  ctx.fillStyle = "#FFE3A3";
  ctx.font = "500 32px Inter, system-ui, sans-serif";
  ctx.fillText("Your word, made visible", W / 2, 158);

  // orb snapshot (centre square, rounded, gradient frame)
  const side = Math.min(orbCanvas.width, orbCanvas.height);
  const sx = (orbCanvas.width - side) / 2;
  const sy = (orbCanvas.height - side) / 2;
  const size = 640;
  const ox = (W - size) / 2;
  const oy = 190;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(ox, oy, size, size, 40);
  ctx.clip();
  ctx.drawImage(orbCanvas, sx, sy, side, side, ox, oy, size, size);
  ctx.restore();
  const frame = ctx.createLinearGradient(ox, oy, ox + size, oy + size);
  frame.addColorStop(0, "#FF9F1C");
  frame.addColorStop(0.5, "#FF3D9A");
  frame.addColorStop(1, "#7C3AED");
  ctx.strokeStyle = frame;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(ox, oy, size, size, 40);
  ctx.stroke();

  // summary
  ctx.textAlign = "left";
  ctx.fillStyle = "#F5EBFF";
  ctx.font = "500 34px Inter, system-ui, sans-serif";
  let y = oy + size + 70;
  for (const line of wrap(ctx, analysis.summary, W - 160, 4)) {
    ctx.fillText(line, 80, y);
    y += 46;
  }
  y += 20;

  // promises
  const maxRows = 5;
  analysis.promises.slice(0, maxRows).forEach((p) => {
    const col = RISK_HEX[p.risk];
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.beginPath();
    ctx.roundRect(70, y, W - 140, 110, 28);
    ctx.fill();
    ctx.strokeStyle = col + "88";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = col + "33";
    ctx.beginPath();
    ctx.arc(125, y + 55, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.font = "30px 'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif";
    ctx.fillText(iconFor(p), 125, y + 66);
    ctx.textAlign = "left";

    ctx.fillStyle = "#fff";
    ctx.font = "700 32px Inter, system-ui, sans-serif";
    const t = wrap(ctx, `${p.who} → ${p.to}: ${p.what}`, W - 440, 1)[0];
    ctx.fillText(t, 180, y + 48);
    ctx.fillStyle = "#C9B4E6";
    ctx.font = "500 26px Inter, system-ui, sans-serif";
    ctx.fillText(`${formatRupees(p.amount)} · ${p.due}`, 180, y + 85);

    ctx.textAlign = "right";
    ctx.fillStyle = col;
    ctx.font = "800 28px Inter, system-ui, sans-serif";
    ctx.fillText(`${RISK_EMOJI[p.risk]} ${RISK_LABEL[p.risk]}`, W - 100, y + 66);
    ctx.textAlign = "left";
    y += 126;
  });
  if (analysis.promises.length > maxRows) {
    ctx.fillStyle = "#C9B4E6";
    ctx.font = "500 28px Inter, system-ui, sans-serif";
    ctx.fillText(`+ ${analysis.promises.length - maxRows} more promises`, 80, y + 20);
  }

  // footer
  ctx.textAlign = "center";
  ctx.fillStyle = "#9A87B8";
  ctx.font = "500 26px Inter, system-ui, sans-serif";
  ctx.fillText("Powered by Gnani AI (Prisma, Evon, Timbre). Not legal advice.", W / 2, H - 44);

  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not make image"))), "image/png"),
  );
}

/** Opens the share sheet on phones, otherwise downloads the PNG. */
export async function shareOrDownload(blob: Blob) {
  const file = new File([blob], "vachan-promise-orb.png", { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: "Vachan — Promise Orb" });
      return;
    } catch {
      /* user cancelled or share failed → fall through to download */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "vachan-promise-orb.png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
