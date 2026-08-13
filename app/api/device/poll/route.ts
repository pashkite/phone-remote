import { and, desc, eq, gt } from "drizzle-orm";
import { getDb } from "../../../../db";
import { remoteSessions } from "../../../../db/schema";
import { apiError, authenticateDevice } from "../../../../lib/server";

export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return apiError("등록되지 않은 기기입니다.", 401);

  const db = await getDb();
  const now = Date.now();

  const [session] = await db
    .select({
      id: remoteSessions.id,
      state: remoteSessions.state,
      createdAt: remoteSessions.createdAt,
      expiresAt: remoteSessions.expiresAt,
    })
    .from(remoteSessions)
    .where(
      and(
        eq(remoteSessions.deviceId, device.id),
        eq(remoteSessions.state, "approval_pending"),
        gt(remoteSessions.expiresAt, now),
      ),
    )
    .orderBy(desc(remoteSessions.createdAt))
    .limit(1);

  if (!session) {
    return Response.json(
      { session: null, pollAfterMs: 1800 },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(
    { session, pollAfterMs: 1000 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
