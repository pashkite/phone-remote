import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/remote-console.tsx", import.meta.url), "utf8");
const accessibility = await readFile(
  new URL("../android-client/app/src/main/java/com/galaxyremote/app/RemoteAccessibilityService.kt", import.meta.url),
  "utf8",
);
const webRtcSession = await readFile(
  new URL("../android-client/app/src/main/java/com/galaxyremote/app/WebRtcSession.kt", import.meta.url),
  "utf8",
);

test("detached opacity is visual-only and bounded", () => {
  assert.match(source, /type="range" min="20" max="100" step="1"/);
  assert.match(source, /style=\{\{ opacity: detachedOpacity \/ 100 \}\}/);
  assert.match(source, /\[25, 50, 75, 100\]/);
});

test("public mode does not retain local preferences", () => {
  assert.match(source, /localStorage\.removeItem\("galaxy-remote-detached-opacity"\)/);
  assert.match(source, /window\.sessionStorage\.clear\(\)/);
  assert.match(source, /window\.location\.assign\(signOutPath\)/);
});

test("letterbox clicks are rejected and long press reaches Android", () => {
  assert.match(source, /if \(!point\.inside\) return/);
  assert.match(source, /type: "longPress"/);
  assert.match(accessibility, /"longPress" -> longPress/);
});

test("connection failures schedule bounded retries", () => {
  assert.match(source, /attempt > 4/);
  assert.match(source, /setConnection\("reconnecting"\)/);
});

test("intentional close suppresses reconnect and releases media", () => {
  assert.match(source, /intentionalCloseRef\.current = intentional/);
  assert.match(source, /if \(intentional && reconnectTimerRef\.current\)/);
  assert.match(source, /remoteStreamRef\.current\?\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(source, /method: "DELETE", keepalive: true/);
});

test("detached window listeners and timers are removed", () => {
  assert.match(source, /removeEventListener\("pagehide", close\)/);
  assert.match(source, /removeEventListener\("resize", keepPhoneRatio\)/);
  assert.match(source, /removeEventListener\("galaxy-phone-ratio-change", applyChangedPhoneRatio\)/);
  assert.match(source, /if \(resizeTimer\) detachedWindow\.clearTimeout\(resizeTimer\)/);
  assert.match(source, /if \(settleTimer\) detachedWindow\.clearTimeout\(settleTimer\)/);
});

test("resolution and frame rate are selected independently", () => {
  assert.match(source, /aria-label="화면 해상도"/);
  assert.match(source, /aria-label="화면 프레임"/);
  assert.match(source, /shortEdge: resolution, fps: next/);
  assert.match(source, /shortEdge: next, fps: frameRate/);
  assert.match(source, /shortEdge: resolutionRef\.current, fps: frameRateRef\.current/);
  assert.match(webRtcSession, /fun setQuality\(shortEdge: Int, fps: Int\)/);
  assert.match(webRtcSession, /ALLOWED_SHORT_EDGES = setOf\(540, 1080, 1440\)/);
  assert.match(webRtcSession, /ALLOWED_FRAME_RATES = setOf\(24, 30, 60\)/);
});
