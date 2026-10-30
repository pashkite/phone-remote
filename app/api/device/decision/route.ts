import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { remoteSessionCandidates, remoteSessions } from "../../../../db/schema";
import { getIceServers } from "../../../../lib/ice";
import { apiError, authenticateDevice, readJson } from "../../../../lib/server";

type DecisionPayload = {
  sessionId?: string;
  decision?: "opened" | "approve" | "reject";
};

export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return apiError("등록되지 않은 기기입니다.", 401);
  const payload = await readJson<DecisionPayload>(request);
  const sessionId = (typeof payload?.sessionId === "string" ? payload.sessionId.trim() : "");
  if (!sessionId || !payload?.decision) return apiError("올바른 연결 승인 요청이 아닙니다.");

  const db = await getDb();
  const now = Date.now();
  const [session] = await db
    .select()
    .from(remoteSessions)
    .where(
      and(
        eq(remoteSessions.id, sessionId),
        eq(remoteSessions.deviceId, device.id),
        gt(remoteSessions.expiresAt, now),
      ),
    )
    .limit(1);
  if (!session) return apiError("연결 요청이 만료되었거나 닫혔습니다.", 410);

  if (!["opened", "approve", "reject"].includes(payload.decision) ||
      !["approval_pending", "consent_pending", "offer_ready"].includes(session.state)) {
    return apiError("이미 처리되었거나 올바르지 않은 연결 요청입니다.", 409);
  }
  if (payload.decision === "reject") {
    const updated = await db
      .update(remoteSessions)
      .set({ state: "rejected", updatedAt: now })
      .where(
        and(
          eq(remoteSessions.id, sessionId),
          eq(remoteSessions.deviceId, device.id),
          gt(remoteSessions.expiresAt, Date.now()),
          inArray(remoteSessions.state, ["approval_pending", "consent_pending"]),
        ),
      ).returning({ id: remoteSessions.id });
    if (!updated.length) return apiError("이미 처리된 연결 요청입니다.", 409);
    return Response.json({ ok: true, state: "rejected" });
  }

  if (payload.decision === "opened") {
    const updated = await db
      .update(remoteSessions)
      .set({ state: "consent_pending", updatedAt: now })
      .where(
        and(
          eq(remoteSessions.id, sessionId),
          eq(remoteSessions.deviceId, device.id),
          gt(remoteSessions.expiresAt, Date.now()),
          eq(remoteSessions.state, "approval_pending"),
        ),
      ).returning({ id: remoteSessions.id });
    if (!updated.length) return apiError("이미 처리된 연결 요청입니다.", 409);
    return Response.json({ ok: true, state: "consent_pending" });
  }

  if (!["approval_pending", "consent_pending", "offer_ready"].includes(session.state)) {
    return apiError("이미 처리된 연결 요청입니다.", 409);
  }
  const approved = await db
    .update(remoteSessions)
    .set({ state: "offer_ready", updatedAt: now })
    .where(
      and(
        eq(remoteSessions.id, sessionId),
        eq(remoteSessions.deviceId, device.id),
        gt(remoteSessions.expiresAt, Date.now()),
        inArray(remoteSessions.state, ["approval_pending", "consent_pending", "offer_ready"]),
      ),
    ).returning({ id: remoteSessions.id });
  if (!approved.length) return apiError("이미 처리된 연결 요청입니다.", 409);

  const [candidates, iceServers] = await Promise.all([
    db
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
      .orderBy(asc(remoteSessionCandidates.createdAt)),
    getIceServers(),
  ]);
  return Response.json({
    ok: true,
    state: "offer_ready",
    session: {
      id: session.id,
      offerType: session.offerType,
      offerSdp: session.offerSdp,
      expiresAt: session.expiresAt,
    },
    candidates,
    iceServers,
  });
}
