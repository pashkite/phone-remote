import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../../../../db";
import { remoteSessions } from "../../../../db/schema";
import { apiError, authenticateDevice, readJson } from "../../../../lib/server";

type AnswerPayload = { sessionId?: string; type?: string; sdp?: string };

export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return apiError("등록되지 않은 기기입니다.", 401);
  const payload = await readJson<AnswerPayload>(request);
  if (!payload?.sessionId || payload.type !== "answer" || !payload.sdp || payload.sdp.length > 250_000) {
    return apiError("올바른 연결 응답이 아닙니다.");
  }

  const db = await getDb();
  const now = Date.now();
  const updated = await db
    .update(remoteSessions)
    .set({
      answerType: "answer",
      answerSdp: payload.sdp,
      state: "answer_ready",
      updatedAt: now,
    })
    .where(
      and(
        eq(remoteSessions.id, payload.sessionId),
        eq(remoteSessions.deviceId, device.id),
        eq(remoteSessions.state, "offer_ready"),
        gt(remoteSessions.expiresAt, now),
      ),
    )
    .returning({ id: remoteSessions.id });

  return updated.length ? Response.json({ ok: true }) : apiError("연결 요청이 만료되었거나 닫혔습니다.", 409);
}
