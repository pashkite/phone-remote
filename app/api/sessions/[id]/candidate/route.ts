import { and, eq, gt, inArray } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { remoteSessionCandidates, remoteSessions } from "../../../../../db/schema";
import { apiError, readJson, requireApiUser } from "../../../../../lib/server";

type CandidatePayload = {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (!user) return apiError("로그인이 필요합니다.", 401);
  const { id } = await context.params;
  const payload = await readJson<CandidatePayload>(request);
  const candidate = payload?.candidate?.trim() ?? "";
  if (!candidate || candidate.length > 8_192) return apiError("올바른 ICE 후보가 아닙니다.");
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
        eq(remoteSessions.id, id),
        eq(remoteSessions.ownerEmail, user.email),
        inArray(remoteSessions.state, [
          "created",
          "approval_pending",
          "consent_pending",
          "offer_ready",
          "answer_ready",
        ]),
        gt(remoteSessions.expiresAt, now),
      ),
    )
    .limit(1);
  if (!session) return apiError("연결 요청이 만료되었거나 닫혔습니다.", 409);

  await db.insert(remoteSessionCandidates).values({
    id: crypto.randomUUID(),
    sessionId: id,
    sender: "browser",
    candidate,
    sdpMid,
    sdpMLineIndex,
    createdAt: now,
  });
  return Response.json({ ok: true }, { status: 201 });
}
