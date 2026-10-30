import {requireApiUser, apiError} from '../../../lib/server';
import {BRAND_NAME, BRAND_ENGLISH_NAME, DEVICE_TEST_BUILD_ID, CONTROL_PROTOCOL_VERSION} from '../../../lib/brand';

/** Read-only owner diagnostics. No device tokens, DB mutation or permission bypass. */
export async function GET(request: Request) {
  if (!await requireApiUser()) return apiError('로그인이 필요합니다.', 401);
  return Response.json({
    brand: BRAND_NAME, englishName: BRAND_ENGLISH_NAME,
    buildId: DEVICE_TEST_BUILD_ID, protocolVersion: CONTROL_PROTOCOL_VERSION,
    signalingOrigin: new URL(request.url).origin,
    physicalDeviceVerified: false,
  }, {headers: {'Cache-Control': 'no-store'}});
}
