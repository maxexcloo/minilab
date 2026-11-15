import assert from "node:assert/strict";
import { test } from "node:test";
import { relatedSubreddits } from "../subreddits.mjs";

test("ranks related communities, merges duplicate recommendations and excludes existing or invalid names", () => {
  const labels = ["Australia", "sydney", "perth", "melbourne", "bad/name"];
  const links = Int32Array.from([
    -1,
    (3 << 8) | 1,
    (4 << 8) | 2,
    5 << 8,
    -2,
    (3 << 8) | 1,
    -4,
    1 << 8,
  ]);
  assert.deepEqual(relatedSubreddits(labels, links, ["australia", "sydney"]), [
    "melbourne",
    "perth",
  ]);
  assert.deepEqual(relatedSubreddits(labels, links, ["unknown"]), []);
});

test("merges every source before ranking and filters existing entries", () => {
  const labels = [
    "first",
    "second",
    ...Array.from({ length: 30 }, (_, index) => `related_${String(index).padStart(2, "0")}`),
  ];
  const links = Int32Array.from([
    -1,
    ...Array.from({ length: 30 }, (_, index) => ((index + 3) << 8) | (index + 1)),
    2 << 8,
    -2,
    (32 << 8) | 1,
  ]);
  const result = relatedSubreddits(labels, links, ["first", "second", "related_00"]);
  assert.equal(result.length, 29);
  assert.equal(new Set(result).size, 29);
  assert.equal(result[0], "related_29");
  assert.ok(
    !result.includes("first") && !result.includes("second") && !result.includes("related_00"),
  );
  assert.ok(result.includes("related_01"));
});
