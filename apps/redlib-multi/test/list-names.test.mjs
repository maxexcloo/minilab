import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtempDisposableSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createApp } from "../server.mjs";

const key = (name) => createHash("sha256").update(name).digest("hex");

test("ordinary list reads need no writer lock and preserve existing aliases", async () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), "redlib-read-only-"));
  using database = new DatabaseSync(join(directory.path, "lists.sqlite"));
  database.exec("CREATE TABLE list_aliases (id TEXT PRIMARY KEY, canonical_id TEXT NOT NULL)");
  database.prepare("INSERT INTO list_aliases VALUES (?, ?)").run(key("Travel"), key("travel"));
  await using server = createApp({
    dataDirectory: directory.path,
    redlibUrl: "https://feed.example",
    checkUrl: "http://redlib.example:8080",
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  database.exec("BEGIN IMMEDIATE");
  for (const [path, method] of [
    ["/api/lists/travel", "GET"],
    ["/api/lists/Unknown", "GET"],
    ["/unsaved", "GET"],
    ["/unsaved", "HEAD"],
  ]) {
    const response = await fetch(base + path, { method });
    assert.equal(response.status, 200, path);
    await response.arrayBuffer();
  }
  database.exec("COMMIT");
  assert.deepEqual(
    database
      .prepare("SELECT * FROM list_aliases")
      .all()
      .map((row) => ({ ...row })),
    [{ id: key("Travel"), canonical_id: key("travel") }],
  );
  for (const table of ["lists", "deleted_lists"])
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
});

test("atomically merges legacy case variants, retains unrecognised lists and rejects stale edits", async () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), "redlib-names-"));
  using database = new DatabaseSync(join(directory.path, "lists.sqlite"));
  database.exec(
    "CREATE TABLE lists (id TEXT PRIMARY KEY, subreddits TEXT NOT NULL, revision INTEGER NOT NULL)",
  );
  const seed = (name, names, revision) =>
    database
      .prepare("INSERT INTO lists VALUES (?, ?, ?)")
      .run(key(name), JSON.stringify(names), revision);
  seed("Travel", ["sydney", "Australia"], 7);
  seed("TRAVEL", ["melbourne", "sydney"], 3);
  seed("travel", ["perth", "australia"], 2);
  seed("Unseen", ["brisbane"], 4);
  await using server = createApp({
    dataDirectory: directory.path,
    redlibUrl: "https://feed.example",
    checkUrl: "http://redlib.example:8080",
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (name) => (await fetch(`${base}/api/lists/${name}`)).json();
  const response = await fetch(`${base}/api/normalise-lists`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ names: ["Travel", "TRAVEL", "travel"] }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { names: ["travel"] });
  const merged = await get("travel");
  assert.deepEqual(merged, {
    revision: 9,
    subreddits: ["australia", "melbourne", "perth", "sydney"],
  });
  assert.deepEqual(await get("Travel"), merged);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM lists").get().count, 2);
  assert.ok(database.prepare("SELECT 1 FROM lists WHERE id = ?").get(key("Unseen")));
  const redirect = await fetch(`${base}/TRAVEL`, { redirect: "manual" });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get("location"), "/travel");
  const stale = await fetch(`${base}/api/lists/TRAVEL`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision: 3, subreddits: [] }),
  });
  assert.equal(stale.status, 409);
  assert.deepEqual((await stale.json()).subreddits, merged.subreddits);
  const selfMove = await fetch(`${base}/api/lists/travel/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "move",
      destination: " TRAVEL ",
      revision: 9,
      subreddits: ["sydney"],
    }),
  });
  assert.equal(selfMove.status, 400);
  assert.deepEqual(await get("travel"), merged);

  // The migration must roll back earlier merges if a later record fails to move.
  seed("First", ["adelaide"], 1);
  seed("Blocked", ["darwin"], 1);
  database.exec(
    `CREATE TRIGGER reject_merge BEFORE DELETE ON lists WHEN OLD.id = '${key("Blocked")}' BEGIN SELECT RAISE(ABORT,'fixture failure'); END`,
  );
  const failed = await fetch(`${base}/api/normalise-lists`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ names: ["First", "Blocked"] }),
  });
  assert.equal(failed.status, 500);
  assert.ok(database.prepare("SELECT 1 FROM lists WHERE id = ?").get(key("First")));
  assert.equal(database.prepare("SELECT 1 FROM lists WHERE id = ?").get(key("first")), undefined);
  database.exec("DROP TRIGGER reject_merge");
});

test("merging more than 1,000 entries preserves them and still allows removals", async () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), "redlib-merge-capacity-"));
  using database = new DatabaseSync(join(directory.path, "lists.sqlite"));
  database.exec(
    "CREATE TABLE lists (id TEXT PRIMARY KEY, subreddits TEXT NOT NULL, revision INTEGER NOT NULL)",
  );
  for (const [name, prefix] of [
    ["Large", "aa"],
    ["large", "bb"],
  ])
    database
      .prepare("INSERT INTO lists VALUES (?, ?, 1)")
      .run(
        key(name),
        JSON.stringify(Array.from({ length: 1000 }, (_, index) => `${prefix}_${index}`)),
      );
  await using server = createApp({
    dataDirectory: directory.path,
    redlibUrl: "https://feed.example",
    checkUrl: "http://redlib.example:8080",
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const url = `http://127.0.0.1:${server.address().port}/api/lists/Large`;
  const merged = await (await fetch(url)).json();
  assert.equal(merged.subreddits.length, 2000);
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      revision: merged.revision,
      subreddits: merged.subreddits.slice(1),
    }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).subreddits.length, 1999);
});
