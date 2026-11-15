import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempDisposableSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createApp } from "../server.mjs";

test("copies and moves selected entries atomically without overwriting either list", async () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), "redlib-transfers-"));
  let server;
  let base;
  async function start() {
    server = createApp({
      dataDirectory: directory.path,
      redlibUrl: "https://feed.example",
      checkUrl: "http://redlib.example:8080",
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    base = `http://127.0.0.1:${server.address().port}/api/lists`;
  }
  const stop = () => new Promise((resolve) => server.close(resolve));
  const get = async (name) => (await fetch(`${base}/${name}`)).json();
  const write = (path, method, body, headers = {}) =>
    fetch(`${base}/${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const transfer = (body, headers) => write("source/transfer", "POST", body, headers);
  await start();
  try {
    await write("source", "PUT", {
      revision: 0,
      subreddits: ["australia", "sydney", "melbourne"],
    });
    await write("target", "PUT", {
      revision: 0,
      subreddits: ["perth", "sydney"],
    });
    const body = {
      action: "copy",
      destination: " target ",
      revision: 1,
      subreddits: ["SYDNEY", "australia"],
    };
    assert.equal((await transfer(body)).status, 200);
    assert.deepEqual(await get("target"), {
      revision: 2,
      subreddits: ["australia", "perth", "sydney"],
    });
    assert.equal((await get("source")).revision, 1);
    assert.equal((await transfer({ ...body, action: "move" })).status, 200);
    assert.deepEqual(await get("source"), {
      revision: 2,
      subreddits: ["melbourne"],
    });
    assert.equal((await get("target")).revision, 2);
    assert.equal((await transfer(body)).status, 409);
    assert.equal((await transfer({ ...body, revision: 2 })).status, 400);
    for (const destination of ["source", "health", "bad/name", ""]) {
      assert.equal(
        (
          await transfer({
            ...body,
            destination,
            revision: 2,
            subreddits: ["melbourne"],
          })
        ).status,
        400,
      );
    }
    assert.equal(
      (
        await transfer(
          { ...body, revision: 2, subreddits: ["melbourne"] },
          { "Sec-Fetch-Site": "cross-site" },
        )
      ).status,
      403,
    );
    assert.equal((await get("target")).revision, 2);

    // A failure after the destination write must roll back both sides of a move.
    const database = new DatabaseSync(join(directory.path, "lists.sqlite"));
    database.exec(
      "CREATE TRIGGER reject_source_update BEFORE DELETE ON lists WHEN OLD.subreddits = '[\"melbourne\"]' BEGIN SELECT RAISE(ABORT, 'test failure'); END",
    );
    const move = {
      action: "move",
      destination: "new-target",
      revision: 2,
      subreddits: ["melbourne"],
    };
    assert.equal((await transfer(move)).status, 500);
    assert.deepEqual(await get("new-target"), { revision: 0, subreddits: [] });
    assert.deepEqual(await get("source"), {
      revision: 2,
      subreddits: ["melbourne"],
    });
    database.exec("DROP TRIGGER reject_source_update");
    database.close();
    assert.equal((await transfer(move)).status, 200);
    await stop();
    await start();
    assert.deepEqual(await get("source"), { revision: 3, subreddits: [] });
    assert.deepEqual(await get("new-target"), {
      revision: 1,
      subreddits: ["melbourne"],
    });
  } finally {
    await stop();
  }
});

test("deletes empty lists while preserving stale-edit protection after recreation", async () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), "redlib-empty-"));
  await using server = createApp({
    dataDirectory: directory.path,
    redlibUrl: "https://feed.example",
    checkUrl: "http://redlib.example:8080",
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const url = `http://127.0.0.1:${server.address().port}/api/lists/example`;
  const put = (revision, subreddits) =>
    fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision, subreddits }),
    });
  using database = new DatabaseSync(join(directory.path, "lists.sqlite"));
  assert.equal((await put(0, ["sydney"])).status, 200);
  assert.equal((await put(1, [])).status, 200);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM lists").get().count, 0);
  assert.deepEqual(await (await fetch(url)).json(), {
    revision: 2,
    subreddits: [],
  });
  assert.equal((await put(0, ["perth"])).status, 409);
  assert.equal((await put(2, ["melbourne"])).status, 200);
  assert.equal((await put(1, ["sydney"])).status, 409);
  assert.deepEqual(await (await fetch(url)).json(), {
    revision: 3,
    subreddits: ["melbourne"],
  });
});
