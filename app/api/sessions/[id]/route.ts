import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { remoteSessionCandidates, remoteSessions } from "../../../../db/schema";
import { apiError, requireApiUser } from "../../../../lib/server";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (!user) return apiError("로그인이 필요합니다.", 401);
  const { id } = await context.params;
  const db = await getDb();
  const [session] = await db
    .select({
      id: remoteSessions.id,
      deviceId: remoteSessions.deviceId,
      state: remoteSessions.state,
      answerType: remoteSessions.answerType,
      answerSdp: remoteSessions.answerSdp,
      expiresAt: remoteSessions.expiresAt,
      updatedAt: remoteSessions.updatedAt,
    })
    .from(remoteSessions)
    .where(and(eq(remoteSessions.id, id), eq(remoteSessions.ownerEmail, user.email)))
    .limit(1);

  if (!session) return apiError("연결 요청을 찾을 수 없습니다.", 404);
  if (session.expiresAt <= Date.now()) return apiError("연결 요청이 만료되었습니다.", 410);
  const candidates = await db
    .select({
      id: remoteSessionCandidates.id,
      candidate: remoteSessionCandidates.candidate,
      sdpMid: remoteSessionCandidates.sdpMid,
      sdpMLineIndex: remoteSessionCandidates.sdpMLineIndex,
    })
    .from(remoteSessionCandidates)
    .where(
      and(
        eq(remoteSessionCandidates.sessionId, id),
        eq(remoteSessionCandidates.sender, "device"),
      ),
    )
    .orderBy(asc(remoteSessionCandidates.createdAt));
  return Response.json({ session, candidates });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (!user) return apiError("로그인이 필요합니다.", 401);
  const { id } = await context.params;
  const db = await getDb();
  const closed = await db
    .update(remoteSessions)
    .set({ state: "closed", updatedAt: Date.now() })
    .where(and(eq(remoteSessions.id, id), eq(remoteSessions.ownerEmail, user.email)))
    .returning({ id: remoteSessions.id });
  if (!closed.length) return apiError("연결 요청을 찾을 수 없습니다.", 404);
  await db.delete(remoteSessionCandidates).where(eq(remoteSessionCandidates.sessionId, id));
  return Response.json({ ok: true });
}
