import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { devices, remoteSessionCandidates, remoteSessions } from "../../../db/schema";
import { apiError, readJson, requireApiUser } from "../../../lib/server";

type SessionRequest = { deviceId?: string };

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (!user) return apiError("로그인이 필요합니다.", 401);
  const payload = await readJson<SessionRequest>(request);
  if (!payload?.deviceId) return apiError("연결할 기기를 선택해 주세요.");

  const db = await getDb();
  const [device] = await db
    .select()
    .from(devices)
    .where(and(eq(devices.id, payload.deviceId), eq(devices.ownerEmail, user.email)))
    .limit(1);
  if (!device) return apiError("등록된 기기를 찾을 수 없습니다.", 404);
  if (!device.lastSeenAt || Date.now() - device.lastSeenAt > 90_000) {
    return apiError("휴대폰 앱에서 ‘연결 요청 알림’을 먼저 켜 주세요.", 409);
  }

  const now = Date.now();
  const activeStates = [
    "created",
    "approval_pending",
    "consent_pending",
    "offer_ready",
    "answer_ready",
  ];
  const previousSessions = await db
    .select({ id: remoteSessions.id })
    .from(remoteSessions)
    .where(
      and(
        eq(remoteSessions.deviceId, device.id),
        inArray(remoteSessions.state, activeStates),
      ),
    );
  await db
    .update(remoteSessions)
    .set({ state: "closed", updatedAt: now })
    .where(
      and(
        eq(remoteSessions.deviceId, device.id),
        inArray(remoteSessions.state, activeStates),
      ),
    );
  if (previousSessions.length) {
    await db
      .delete(remoteSessionCandidates)
      .where(
        inArray(
          remoteSessionCandidates.sessionId,
          previousSessions.map((session) => session.id),
        ),
      );
  }

  const sessionId = crypto.randomUUID();
  await db.insert(remoteSessions).values({
    id: sessionId,
    ownerEmail: user.email,
    deviceId: device.id,
    state: "created",
    createdAt: now,
    updatedAt: now,
    expiresAt: now + 60 * 1000,
  });

  return Response.json({ sessionId, expiresAt: now + 60 * 1000 }, { status: 201 });
}
