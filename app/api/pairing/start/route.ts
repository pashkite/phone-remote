import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../db";
import { pairingCodes } from "../../../../db/schema";
import { apiError, randomDigits, requireApiUser } from "../../../../lib/server";

export async function POST() {
  const user = await requireApiUser();
  if (!user) return apiError("로그인이 필요합니다.", 401);

  const db = await getDb();
  const now = Date.now();
  await db
    .update(pairingCodes)
    .set({ consumedAt: now })
    .where(and(eq(pairingCodes.ownerEmail, user.email), isNull(pairingCodes.consumedAt)));

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = randomDigits(6);
    try {
      await db.insert(pairingCodes).values({
        code,
        ownerEmail: user.email,
        createdAt: now,
        expiresAt: now + 10 * 60 * 1000,
      });
      return Response.json({ code, expiresAt: now + 10 * 60 * 1000 });
    } catch {
      // A six-digit collision is rare; generate another code.
    }
  }

  return apiError("등록 코드를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
}
