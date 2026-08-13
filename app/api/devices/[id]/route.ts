import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { devices, remoteSessionCandidates, remoteSessions } from "../../../../db/schema";
import { apiError, requireApiUser } from "../../../../lib/server";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (!user) return apiError("로그인이 필요합니다.", 401);
  const { id } = await context.params;
  const db = await getDb();

  const removed = await db
    .delete(devices)
    .where(and(eq(devices.id, id), eq(devices.ownerEmail, user.email)))
    .returning({ id: devices.id });
  if (!removed.length) return apiError("등록된 기기를 찾을 수 없습니다.", 404);

  const sessionRows = await db
    .select({ id: remoteSessions.id })
    .from(remoteSessions)
    .where(and(eq(remoteSessions.deviceId, id), eq(remoteSessions.ownerEmail, user.email)));
  if (sessionRows.length) {
    await db
      .delete(remoteSessionCandidates)
      .where(inArray(remoteSessionCandidates.sessionId, sessionRows.map((session) => session.id)));
  }
  await db
    .delete(remoteSessions)
    .where(and(eq(remoteSessions.deviceId, id), eq(remoteSessions.ownerEmail, user.email)));
  return Response.json({ ok: true });
}
