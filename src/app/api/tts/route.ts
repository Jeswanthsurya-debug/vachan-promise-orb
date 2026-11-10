/**
 * POST /api/tts  { text, lang }
 * → audio bytes (Timbre), OR JSON { demo: true } meaning
 *   "no server voice available, please use the browser's built-in voice".
 */
import { GnaniNotConfiguredError, speak } from "@/lib/gnaniClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { text?: unknown; lang?: unknown; demo?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const lang = typeof body.lang === "string" ? body.lang : "hi-en";
  const forceDemo = body.demo === true;
  if (!text || text.length > 4000) {
    return Response.json({ error: "Text is empty or too long" }, { status: 400 });
  }

  try {
    const audio = await speak(text, lang, forceDemo);
    if (!audio) return Response.json({ demo: true });
    return new Response(audio.data, {
      headers: { "Content-Type": audio.contentType, "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof GnaniNotConfiguredError) return Response.json({ demo: true, notice: err.message });
    console.error("[tts]", err);
    return Response.json({ error: "Could not read it aloud." }, { status: 502 });
  }
}
