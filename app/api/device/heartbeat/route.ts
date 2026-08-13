import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { devices } from "../../../../db/schema";
import {
  apiError,
  authenticateDevice,
  readJson,
  safeInteger,
} from "../../../../lib/server";

type HeartbeatPayload = {
  batteryLevel?: number;
  screenWidth?: number;
  screenHeight?: number;
  appVersion?: string;
};

export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device) return apiError("등록되지 않은 기기입니다.", 401);
  const payload = await readJson<HeartbeatPayload>(request);

  const db = await getDb();
  await db
    .update(devices)
    .set({
      lastSeenAt: Date.now(),
      batteryLevel: safeInteger(payload?.batteryLevel, 0, 100),
      screenWidth: safeInteger(payload?.screenWidth, 1, 10_000),
      screenHeight: safeInteger(payload?.screenHeight, 1, 10_000),
      appVersion:
        typeof payload?.appVersion === "string"
          ? payload.appVersion.trim().slice(0, 24) || device.appVersion
          : device.appVersion,
    })
    .where(eq(devices.id, device.id));

  return Response.json({ ok: true });
}
