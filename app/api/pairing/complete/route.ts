import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../db";
import { devices, pairingCodes, pairingRateLimits } from "../../../../db/schema";
import {
  apiError,
  clientFingerprint,
  randomToken,
  readJson,
  safeDeviceName,
  sha256Hex,
} from "../../../../lib/server";

type PairingRequest = {
  code?: string;
  name?: string;
  platform?: string;
  appVersion?: string;
};

export async function POST(request: Request) {
  const db = await getDb();
  const now = Date.now();
  const rateLimitKey = `pair:${await clientFingerprint(request)}`;
  const [rateLimit] = await db
    .select()
    .from(pairingRateLimits)
    .where(eq(pairingRateLimits.key, rateLimitKey))
    .limit(1);
  if (rateLimit && now - rateLimit.windowStartedAt < 10 * 60 * 1000 && rateLimit.attempts >= 20) {
    return Response.json(
      { error: "등록 시도가 너무 많습니다. 10분 뒤 다시 시도해 주세요." },
      { status: 429, headers: { "Retry-After": "600" } },
    );
  }
  if (!rateLimit) {
    await db
      .insert(pairingRateLimits)
      .values({
        key: rateLimitKey,
        windowStartedAt: now,
        attempts: 1,
        updatedAt: now,
      })
      .onConflictDoNothing();
  } else if (now - rateLimit.windowStartedAt >= 10 * 60 * 1000) {
    await db
      .update(pairingRateLimits)
      .set({ windowStartedAt: now, attempts: 1, updatedAt: now })
      .where(eq(pairingRateLimits.key, rateLimitKey));
  } else {
    await db
      .update(pairingRateLimits)
      .set({ attempts: rateLimit.attempts + 1, updatedAt: now })
      .where(eq(pairingRateLimits.key, rateLimitKey));
  }

  const payload = await readJson<PairingRequest>(request);
  const code = payload?.code?.replace(/\D/g, "") ?? "";
  if (!/^\d{6}$/.test(code)) return apiError("6자리 등록 코드를 입력해 주세요.");

  const [pairing] = await db
    .select()
    .from(pairingCodes)
    .where(and(eq(pairingCodes.code, code), isNull(pairingCodes.consumedAt)))
    .limit(1);

  if (!pairing || pairing.expiresAt <= now) {
    return apiError("등록 코드가 만료되었거나 이미 사용되었습니다.", 410);
  }

  const claimed = await db
    .update(pairingCodes)
    .set({ consumedAt: now })
    .where(and(eq(pairingCodes.code, code), isNull(pairingCodes.consumedAt)))
    .returning({ code: pairingCodes.code });
  if (!claimed.length) return apiError("이미 사용된 등록 코드입니다.", 409);

  const token = randomToken();
  const deviceId = crypto.randomUUID();
  await db.insert(devices).values({
    id: deviceId,
    ownerEmail: pairing.ownerEmail,
    name: safeDeviceName(payload?.name),
    platform: payload?.platform?.slice(0, 24) || "android",
    appVersion: payload?.appVersion?.slice(0, 24) || "1.0.0",
    tokenHash: await sha256Hex(token),
    createdAt: now,
    lastSeenAt: now,
  });
  await db.delete(pairingRateLimits).where(eq(pairingRateLimits.key, rateLimitKey));

  const origin = new URL(request.url).origin;
  return Response.json(
    {
      deviceId,
      deviceToken: token,
      signalingBaseUrl: origin,
      owner: pairing.ownerEmail,
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
