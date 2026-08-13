import { getIceServers } from "../../../lib/ice";
import { apiError, requireApiUser } from "../../../lib/server";

export async function GET() {
  const user = await requireApiUser();
  if (!user) return apiError("로그인이 필요합니다.", 401);
  return Response.json(
    { iceServers: await getIceServers() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
