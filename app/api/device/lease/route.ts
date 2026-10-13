import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { remoteSessions } from "../../../../db/schema";
import { apiError, authenticateDevice, readJson } from "../../../../lib/server";

// Initial offer expiry is not a live-session lease. Continue checking account
// revocation and replacement without extending an expired connection request.
export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return apiError("등록되지 않은 기기입니다.", 401);
  const body = await readJson<{ sessionId?: string }>(request);
  if (typeof body?.sessionId !== "string" || body.sessionId.length > 100) return apiError("연결 ID가 필요합니다.");
  const [session] = await (await getDb()).select({ state: remoteSessions.state }).from(remoteSessions)
    .where(and(eq(remoteSessions.id, body.sessionId), eq(remoteSessions.deviceId, device.id))).limit(1);
  return Response.json({ active: session?.state === "answer_ready" }, { headers: { "Cache-Control": "no-store" } });
}
