/**
 * GET /api/status — tells the browser whether we are in demo mode.
 * Only a yes/no is returned. The API key itself is never sent anywhere.
 */
import { isDemoMode } from "@/lib/gnaniClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ demo: isDemoMode() });
}
