import { and, eq, isNull, sql } from "drizzle-orm";
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
  // One SQLite statement owns both increment and window rollover under concurrency.
  const [rateLimit] = await db.insert(pairingRateLimits).values({
    key: rateLimitKey, windowStartedAt: now, attempts: 1, updatedAt: now,
  }).onConflictDoUpdate({target: pairingRateLimits.key, set: {
    windowStartedAt: sql`CASE WHEN ${pairingRateLimits.windowStartedAt} <= ${now - 600000} THEN ${now} ELSE ${pairingRateLimits.windowStartedAt} END`,
    attempts: sql`CASE WHEN ${pairingRateLimits.windowStartedAt} <= ${now - 600000} THEN 1 ELSE ${pairingRateLimits.attempts} + 1 END`,
    updatedAt: now,
  }}).returning({attempts: pairingRateLimits.attempts});
  if (!rateLimit || rateLimit.attempts > 20) return Response.json(
    { error: "등록 시도가 너무 많습니다. 10분 뒤 다시 시도해 주세요." },
    { status: 429, headers: { "Retry-After": "600" } },
  );

  const payload = await readJson<PairingRequest>(request);
  if (payload && (["name", "platform", "appVersion"] as const).some(key => payload[key] !== undefined && typeof payload[key] !== "string")) return apiError("기기 정보는 문자열이어야 합니다.");
  const code = typeof payload?.code === "string" ? payload.code.replace(/\D/g, "") : "";
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
    platform: typeof payload?.platform === "string" ? payload.platform.slice(0, 24) || "android" : "android",
    appVersion: typeof payload?.appVersion === "string" ? payload.appVersion.slice(0, 24) || "1.0.0" : "1.0.0",
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
