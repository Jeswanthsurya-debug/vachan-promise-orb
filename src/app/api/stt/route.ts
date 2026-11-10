/**
 * POST /api/stt  (multipart form: audio=<Blob>, lang=<code>)
 * → { transcript, demo, notice? }
 *
 * Thin proxy: the browser sends recorded audio here, we call Prisma STT
 * through gnaniClient.ts (server-side, key stays secret).
 */
import { GnaniNotConfiguredError, transcribe } from "@/lib/gnaniClient";
import { DEMO_TRANSCRIPT } from "@/lib/demoData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const audio = form.get("audio");
    const lang = String(form.get("lang") ?? "hi-en");
    const blob = audio instanceof Blob ? audio : null;
    const forceDemo = form.get("demo") === "1";
    const result = await transcribe(blob, lang, forceDemo);
    return Response.json(result);
  } catch (err) {
    if (err instanceof GnaniNotConfiguredError) {
      // Key is set but the TODOs are not filled in yet → keep the app usable.
      return Response.json({ transcript: DEMO_TRANSCRIPT, demo: true, notice: err.message });
    }
    console.error("[stt]", err);
    return Response.json({ error: "Could not turn your voice into text. Please try again." }, { status: 502 });
  }
}
