export const maxListNameLength = 128;
export const normaliseListBatchSize = 1000;
export const unknownStatusCacheSeconds = 60;
export const redsimUrl = "https://anvaka.github.io/redsim/";
export const redsimDataUrl = new URL("data/", redsimUrl);

export const listName = new RegExp(`^[a-zA-Z0-9_-]{1,${maxListNameLength}}$`);
export const subredditName = /^[a-z0-9_]{2,21}$/;

// /health is the probe endpoint, so no list can use that name.
export const reservedList = (name) => name.toLowerCase() === "health";

export function normaliseSubreddits(input) {
  const tokens = String(input)
    .trim()
    .toLowerCase()
    .replace(/https?:\/\/[^\s/]+\/(?:r\/)?/g, "")
    .split(/[\s,+]+/)
    .filter(Boolean)
    .map((value) => value.replace(/^\/?r\//, "").replace(/\/$/, ""));
  const invalid = tokens.filter((value) => !subredditName.test(value));
  if (invalid.length)
    throw new Error(`Invalid subreddit: ${invalid[0]}. Use 2–21 letters, numbers or underscores.`);
  return [...new Set(tokens)].sort();
}

export function multiredditUrl(subreddits, redlibUrl) {
  if (!subreddits.length) return null;
  return `${redlibUrl}/r/${subreddits.join("+")}`;
}

// RedSim packs a negative source marker, then destination IDs and ranks.
export function relatedSubreddits(labels, links, subreddits) {
  const existing = new Set(subreddits);
  const sources = new Set();
  labels.forEach((label, index) => {
    if (existing.has(label.toLowerCase())) sources.add(index);
  });
  const scores = new Map();
  function add(index, rank) {
    const name = labels[index]?.toLowerCase();
    if (!name || existing.has(name) || !subredditName.test(name)) return;
    scores.set(name, (scores.get(name) || 0) + 1 / (rank + 1));
  }
  let source = -1;
  for (const value of links) {
    if (value < 0) source = -value - 1;
    else {
      const destination = (value >>> 8) - 1;
      const rank = value & 255;
      if (sources.has(source)) add(destination, rank);
      if (sources.has(destination)) add(source, rank);
    }
  }
  return [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
}
