import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { remoteSessions } from "../../../../../db/schema";
import { apiError, readJson, requireApiUser } from "../../../../../lib/server";

type OfferPayload = { type?: string; sdp?: string };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (!user) return apiError("로그인이 필요합니다.", 401);
  const { id } = await context.params;
  const payload = await readJson<OfferPayload>(request);
  if (payload?.type !== "offer" || !payload.sdp || payload.sdp.length > 250_000) {
    return apiError("올바른 연결 요청이 아닙니다.");
  }

  const db = await getDb();
  const now = Date.now();
  const updated = await db
    .update(remoteSessions)
    .set({
      offerType: "offer",
      offerSdp: payload.sdp,
      state: "approval_pending",
      updatedAt: now,
    })
    .where(
      and(
        eq(remoteSessions.id, id),
        eq(remoteSessions.ownerEmail, user.email),
        eq(remoteSessions.state, "created"),
        gt(remoteSessions.expiresAt, now),
      ),
    )
    .returning({ id: remoteSessions.id });

  return updated.length
    ? Response.json({ ok: true })
    : apiError("연결 요청이 만료되었거나 이미 처리되었습니다.", 409);
}
