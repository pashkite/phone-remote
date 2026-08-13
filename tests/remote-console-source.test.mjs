import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/remote-console.tsx", import.meta.url), "utf8");
const accessibility = await readFile(
  new URL("../android-client/app/src/main/java/com/galaxyremote/app/RemoteAccessibilityService.kt", import.meta.url),
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
