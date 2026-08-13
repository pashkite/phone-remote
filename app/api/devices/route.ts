import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { devices } from "../../../db/schema";
import { apiError, requireApiUser } from "../../../lib/server";

export async function GET() {
  const user = await requireApiUser();
  if (!user) return apiError("로그인이 필요합니다.", 401);

  const db = await getDb();
  const rows = await db
    .select({
      id: devices.id,
      name: devices.name,
      platform: devices.platform,
      appVersion: devices.appVersion,
      batteryLevel: devices.batteryLevel,
      screenWidth: devices.screenWidth,
      screenHeight: devices.screenHeight,
      lastSeenAt: devices.lastSeenAt,
      createdAt: devices.createdAt,
    })
    .from(devices)
    .where(eq(devices.ownerEmail, user.email))
    .orderBy(desc(devices.lastSeenAt), desc(devices.createdAt));

  const now = Date.now();
  return Response.json({
    devices: rows.map((device) => ({
      ...device,
      online: Boolean(device.lastSeenAt && now - device.lastSeenAt < 45_000),
    })),
  });
}
