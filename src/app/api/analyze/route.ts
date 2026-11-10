/**
 * POST /api/analyze  { transcript, lang }
 * → { analysis, demo, notice? }
 *
 * Sends the transcript to Evon (via gnaniClient.ts) and returns the strict JSON analysis.
 */
import { GnaniNotConfiguredError, analyze, isDemoMode } from "@/lib/gnaniClient";
import { DEMO_ANALYSIS } from "@/lib/demoData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { transcript?: unknown; lang?: unknown; demo?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
  const lang = typeof body.lang === "string" ? body.lang : "hi-en";
  const forceDemo = body.demo === true;
  if (!transcript || transcript.length > 20000) {
    return Response.json({ error: "Transcript is empty or too long" }, { status: 400 });
  }

  try {
    const analysis = await analyze(transcript, lang, forceDemo);
    return Response.json({ analysis, demo: isDemoMode(forceDemo) });
  } catch (err) {
    if (err instanceof GnaniNotConfiguredError) {
      return Response.json({ analysis: DEMO_ANALYSIS, demo: true, notice: err.message });
    }
    console.error("[analyze]", err);
    return Response.json({ error: "Could not understand the agreement. Please try again." }, { status: 502 });
  }
}
