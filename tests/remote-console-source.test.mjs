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
  assert.match(source, /aria-label="분리 창 투명도"/);
  assert.match(source, /style=\{\{ opacity: detachedOpacity \/ 100 \}\}/);
  assert.match(source, /<option value=\{25\}>투명도 25%<\/option>/);
  assert.match(source, /<option value=\{100\}>투명도 100%<\/option>/);
});
test("detached controls are available only on the main site", () => {
  assert.doesNotMatch(source, /className="detached-settings-button"/);
  assert.doesNotMatch(source, /className="detached-toolbar"/);
  assert.match(source, /className="screen-heading-actions"/);
  assert.match(source, /aria-label="분리 창 투명도"/);
});

test("main site quality controls keep resolution and frame rate separate", () => {
  assert.match(source, /aria-label="화면 해상도"/);
  assert.match(source, /aria-label="화면 프레임"/);
  assert.match(source, /changeResolution\(Number\(event\.target\.value\)/);
  assert.match(source, /changeFrameRate\(Number\(event\.target\.value\)/);
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

test("accessibility text fallback never treats a placeholder as entered text", () => {
  assert.match(accessibility, /val current = editableText\(focused\)/);
  assert.match(accessibility, /if \(focused\.isShowingHintText\) return ""/);
  assert.match(accessibility, /current == hint/);
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
  assert.match(source, /shortEdge: next, fps: next === 1440 \? Math.min\(frameRate, 30\) : frameRate/);
  assert.match(source, /shortEdge: resolutionRef\.current, fps: frameRateRef\.current/);
  assert.match(webRtcSession, /fun setQuality\(shortEdge: Int, fps: Int\)/);
  assert.match(webRtcSession, /requestedQuality = StreamQuality.resolve\(shortEdge, fps\)/);
  assert.match(webRtcSession, /encoding.maxFramerate = StreamQuality.DEFAULT.fps/);
});
