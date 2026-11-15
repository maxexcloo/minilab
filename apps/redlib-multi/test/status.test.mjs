import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempDisposableSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp, subredditStatus } from "../server.mjs";

test("recognises explicit Redlib statuses without inferring bans from generic errors or post content", () => {
  assert.equal(
    subredditStatus(
      '<div id="error"><h1>r/example has been banned from Reddit</h1></div>',
      "example",
    ),
    "banned",
  );
  assert.equal(
    subredditStatus('<div id="error"><h1>r/example is a private community</h1></div>', "example"),
    "private",
  );
  assert.equal(subredditStatus("<h1>r/example is quarantined</h1>", "example"), "restricted");
  assert.equal(subredditStatus("<h1>r/example is gated</h1>", "example"), "restricted");
  assert.equal(
    subredditStatus(
      '<p id="sub_name">r/example</p><p>r/example has been banned from Reddit</p>',
      "example",
    ),
    "available",
  );
  assert.equal(subredditStatus('<p id="sub_name">r/AskReddit</p>', "askreddit"), "available");
  assert.equal(
    subredditStatus(
      '<div id="error"><h1>r/Example has been banned from Reddit</h1></div>',
      "example",
    ),
    "banned",
  );
  for (const html of [
    "<h1>Blocked</h1>",
    '<div id="error"><h1>Reddit rate limit exceeded</h1></div>',
    '<div id="error"><h1>r/another has been banned from Reddit</h1></div>',
    "<center>No posts were found.</center>",
  ])
    assert.equal(subredditStatus(html, "example"), "unknown");
});

test("checks a fixed Redlib origin, caches results and preserves lists", async () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), "redlib-status-"));
  let calls = 0;
  await using server = createApp({
    dataDirectory: directory.path,
    redlibUrl: "https://feed.example",
    checkUrl: "http://redlib.example:8080",
    fetchStatus: async (url, options) => {
      calls++;
      assert.equal(new URL(url).origin, "http://redlib.example:8080");
      assert.equal(options.redirect, "error");
      const name = new URL(url).pathname.slice(3);
      if (name === "offline") throw new Error("Network unavailable");
      if (name === "limited") return new Response("banned", { status: 429 });
      return new Response(`<div id="error"><h1>r/${name} has been banned from Reddit</h1></div>`);
    },
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const check = (subreddit, headers = {}) =>
    fetch(`${base}/api/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ subreddit }),
    });
  const saved = { revision: 0, subreddits: ["example"] };
  await fetch(`${base}/api/lists/test`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(saved),
  });
  assert.deepEqual(await (await check("example")).json(), {
    status: "banned",
  });
  assert.deepEqual(await (await check("example")).json(), {
    status: "banned",
  });
  assert.equal(calls, 1);
  assert.equal((await check("example", { "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await check("../example")).status, 400);
  assert.deepEqual(await (await check("offline")).json(), {
    status: "unknown",
  });
  assert.deepEqual(await (await check("limited")).json(), {
    status: "unknown",
  });
  assert.deepEqual(await (await fetch(`${base}/api/lists/test`)).json(), {
    revision: 1,
    subreddits: ["example"],
  });
});
