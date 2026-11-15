import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempDisposableSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../server.mjs";

test("rejects invalid JSON requests consistently while retaining endpoint limits and errors", async () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), "redlib-multi-requests-"));
  await using server = createApp({
    dataDirectory: directory.path,
    redlibUrl: "https://feed.example",
    checkUrl: "http://redlib.example:8080",
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [path, method, limit, tooLarge] of [
    ["/api/normalise-lists", "POST", 150000, "Too many list names."],
    ["/api/check", "POST", 1024, "Check one subreddit at a time."],
    ["/api/lists/example", "PUT", 65536, "List is too large."],
    ["/api/lists/example/transfer", "POST", 65536, "List is too large."],
  ]) {
    for (const [body, headers, status, error] of [
      ["{}", { "Sec-Fetch-Site": "cross-site" }, 403, "Cross-site requests are not allowed."],
      ["{}", { "Sec-Fetch-Site": "same-site" }, 403, "Cross-site requests are not allowed."],
      ["{}", { "Content-Type": "text/plain" }, 415, "Use application/json."],
      ["{", {}, 400, "Invalid JSON."],
      [JSON.stringify("a".repeat(limit)), {}, 413, tooLarge],
    ]) {
      const response = await fetch(base + path, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body,
      });
      assert.equal(response.status, status, path);
      assert.deepEqual(await response.json(), { error }, path);
    }
    const response = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: "null",
    });
    assert.equal(response.status, 400, path);
    assert.notEqual((await response.json()).error, "Invalid JSON.", path);
  }
  assert.deepEqual(await (await fetch(base + "/api/lists/example")).json(), {
    revision: 0,
    subreddits: [],
  });
  const saved = await fetch(base + "/api/lists/example", {
    method: "PUT",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ revision: 0, subreddits: ["example"] }),
  });
  assert.equal(saved.status, 200);
  for (const [path, method] of [
    ["/api/lists/health", "GET"],
    ["/api/lists/Health", "PUT"],
    ["/api/lists/health/transfer", "POST"],
  ]) {
    const response = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(method === "GET" ? {} : { body: "{}" }),
    });
    assert.equal(response.status, 400, path);
  }
});

test("serves the page with a fresh style nonce and no inline scripts", async () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), "redlib-multi-page-csp-"));
  await using server = createApp({
    dataDirectory: directory.path,
    redlibUrl: "https://feed.example",
    checkUrl: "http://redlib.example:8080",
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const nonces = new Set();
  for (const path of ["/", "/example"]) {
    const response = await fetch(base + path);
    const policy = response.headers.get("Content-Security-Policy");
    const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(policy)?.[1];
    assert.ok(nonce);
    assert.ok((await response.text()).includes(`name="style-nonce" content="${nonce}"`));
    assert.match(policy, /script-src 'self';/);
    assert.ok(!policy.includes("unsafe-inline"));
    nonces.add(nonce);
  }
  assert.equal(nonces.size, 2);
});
