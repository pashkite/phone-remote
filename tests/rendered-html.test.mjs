import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("production console preserves owner access and removes temporary preview metadata", async (t) => {
  const ownerEmail = process.env.OWNER_EMAIL?.trim() || "preview@local.test";
  const oldOwner = process.env.OWNER_EMAIL;
  process.env.OWNER_EMAIL = ownerEmail;
  t.after(() => { if (oldOwner === undefined) delete process.env.OWNER_EMAIL; else process.env.OWNER_EMAIL = oldOwner; });
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: {
        accept: "text/html",
        "oai-authenticated-user-email": ownerEmail,
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.doesNotMatch(html, developmentPreviewMeta);
  assert.match(html, /Galaxy Remote/);
  assert.match(html, /기기 등록/);
  const denied = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html", "oai-authenticated-user-email": "not-owner@local.test" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
  assert.match(await denied.text(), /접근 권한이 없는 계정입니다/);
});
