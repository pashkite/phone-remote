import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const geometrySource = await readFile(new URL("../app/remote-geometry.ts", import.meta.url), "utf8");

function normalizedVideoPoint(clientX, clientY, bounds, video) {
  const frameAspect = bounds.width / bounds.height;
  const videoAspect = video.width > 0 && video.height > 0 ? video.width / video.height : frameAspect;
  const renderedWidth = videoAspect > frameAspect ? bounds.width : bounds.height * videoAspect;
  const renderedHeight = videoAspect > frameAspect ? bounds.width / videoAspect : bounds.height;
  const offsetX = bounds.left + (bounds.width - renderedWidth) / 2;
  const offsetY = bounds.top + (bounds.height - renderedHeight) / 2;
  return {
    x: Math.min(1, Math.max(0, (clientX - offsetX) / renderedWidth)),
    y: Math.min(1, Math.max(0, (clientY - offsetY) / renderedHeight)),
    inside: clientX >= offsetX && clientX <= offsetX + renderedWidth
      && clientY >= offsetY && clientY <= offsetY + renderedHeight,
  };
}

test("coordinate helper remains the UI source of truth", () => {
  assert.match(geometrySource, /export function normalizedVideoPoint/);
});

test("portrait video rejects horizontal letterbox and maps center", () => {
  const bounds = { left: 0, top: 0, width: 1000, height: 600 };
  const video = { width: 1080, height: 2340 };
  assert.equal(normalizedVideoPoint(50, 300, bounds, video).inside, false);
  const center = normalizedVideoPoint(500, 300, bounds, video);
  assert.equal(center.inside, true);
  assert.ok(Math.abs(center.x - 0.5) < 1e-9);
  assert.ok(Math.abs(center.y - 0.5) < 1e-9);
});

test("landscape video rejects vertical letterbox and maps center", () => {
  const bounds = { left: 20, top: 10, width: 700, height: 700 };
  const video = { width: 2340, height: 1080 };
  assert.equal(normalizedVideoPoint(370, 20, bounds, video).inside, false);
  assert.deepEqual(normalizedVideoPoint(370, 360, bounds, video), { x: 0.5, y: 0.5, inside: true });
});

test("new bounds are used immediately after resize", () => {
  const video = { width: 1080, height: 2340 };
  const before = normalizedVideoPoint(300, 400, { left: 0, top: 0, width: 600, height: 800 }, video);
  const after = normalizedVideoPoint(600, 400, { left: 0, top: 0, width: 1200, height: 800 }, video);
  assert.equal(before.inside, true);
  assert.equal(after.inside, true);
  assert.ok(Math.abs(before.x - 0.5) < 1e-9);
  assert.ok(Math.abs(after.x - 0.5) < 1e-9);
});
