import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { remoteSessionCandidates, remoteSessions } from "../../../../db/schema";
import { apiError, authenticateDevice, readJson } from "../../../../lib/server";

type SessionPayload = { sessionId?: string };

export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return apiError("등록되지 않은 기기입니다.", 401);
  const payload = await readJson<SessionPayload>(request);
  const sessionId = payload?.sessionId?.trim();
  if (!sessionId) return apiError("연결 요청 ID가 필요합니다.");

  const db = await getDb();
  const now = Date.now();
  const [session] = await db
    .select({
      id: remoteSessions.id,
      state: remoteSessions.state,
      offerType: remoteSessions.offerType,
      offerSdp: remoteSessions.offerSdp,
      expiresAt: remoteSessions.expiresAt,
    })
    .from(remoteSessions)
    .where(
      and(
        eq(remoteSessions.id, sessionId),
        eq(remoteSessions.deviceId, device.id),
        inArray(remoteSessions.state, ["offer_ready", "answer_ready"]),
        gt(remoteSessions.expiresAt, now),
      ),
    )
    .limit(1);
  if (!session) return apiError("연결 요청이 만료되었거나 닫혔습니다.", 410);

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
        eq(remoteSessionCandidates.sessionId, sessionId),
        eq(remoteSessionCandidates.sender, "browser"),
      ),
    )
    .orderBy(asc(remoteSessionCandidates.createdAt));
  return Response.json({ session, candidates }, { headers: { "Cache-Control": "no-store" } });
}
