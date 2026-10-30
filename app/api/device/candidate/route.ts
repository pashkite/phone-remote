import { and, eq, gt, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { remoteSessionCandidates, remoteSessions } from "../../../../db/schema";
import { apiError, authenticateDevice, readJson } from "../../../../lib/server";

type CandidatePayload = {
  sessionId?: string;
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
};

export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return apiError("등록되지 않은 기기입니다.", 401);
  const payload = await readJson<CandidatePayload>(request);
  const sessionId = (typeof payload?.sessionId === "string" ? payload.sessionId.trim() : "");
  const candidate = typeof payload?.candidate === "string" ? payload.candidate.trim() : "";
  if (!sessionId || !candidate || candidate.length > 8_192) {
    return apiError("올바른 ICE 후보가 아닙니다.");
  }
  const sdpMid = typeof payload?.sdpMid === "string" ? payload.sdpMid.slice(0, 64) : null;
  const sdpMLineIndex = Number.isInteger(payload?.sdpMLineIndex)
    ? Math.max(0, Math.min(64, payload?.sdpMLineIndex as number))
    : null;

  const db = await getDb();
  const now = Date.now();
  const [session] = await db
    .select({ id: remoteSessions.id })
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
  if (!session) return apiError("연결 요청이 만료되었거나 닫혔습니다.", 409);

  await db.insert(remoteSessionCandidates).values({
    id: crypto.randomUUID(),
    sessionId,
    sender: "device",
    candidate,
    sdpMid,
    sdpMLineIndex,
    createdAt: now,
  });
  return Response.json({ ok: true }, { status: 201 });
}
