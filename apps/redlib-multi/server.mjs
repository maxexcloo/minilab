import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { listName, normaliseSubreddits, subredditName } from "./subreddits.mjs";

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readJson(request, limit, tooLarge, action = "writes") {
  const site = request.headers["sec-fetch-site"];
  if (site && !["none", "same-origin"].includes(site))
    throw new RequestError(403, `Cross-site ${action} are not allowed.`);
  const type = request.headers["content-type"]?.split(";")[0].trim();
  if (type?.toLowerCase() !== "application/json")
    throw new RequestError(415, "Use application/json.");
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new RequestError(413, tooLarge);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError(400, "Invalid JSON.");
  }
}

function parseOrigin(value, variable) {
  let origin;
  try {
    origin = new URL(value);
  } catch {
    throw new Error(`${variable} must be an HTTP or HTTPS origin.`);
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error(`${variable} must be an HTTP or HTTPS origin.`);
  return origin;
}

// Redlib shows the canonical spelling, such as r/AskReddit for a lowercase request.
export function subredditStatus(html, name) {
  const error = /<div id="error">\s*<h1>([^<]*)<\/h1>/.exec(html)?.[1]?.trim().toLowerCase();
  if (error === `r/${name} has been banned from reddit`) return "banned";
  if (error === `r/${name} is a private community`) return "private";
  if (new RegExp(`<h1>r/${name} is (?:quarantined|gated)</h1>`, "i").test(html))
    return "restricted";
  if (!error && new RegExp(`<p id="sub_name">r/${name}</p>`, "i").test(html)) return "available";
  return "unknown";
}

// Every setting is required; Flux leaves a missing substitution variable empty.
function setting(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function createApp({
  dataDirectory = setting("DATA_DIRECTORY"),
  redlibUrl = setting("REDLIB_URL"),
  checkUrl = setting("REDLIB_CHECK_URL"),
  fetchStatus = fetch,
} = {}) {
  const origin = parseOrigin(redlibUrl, "REDLIB_URL");
  const checkOrigin = parseOrigin(checkUrl, "REDLIB_CHECK_URL");
  const statusCache = new Map();
  mkdirSync(dataDirectory, { mode: 0o700, recursive: true });
  // Retain the original filename, schema and hashed keys for existing lists.
  const database = new DatabaseSync(resolve(dataDirectory, "lists.sqlite"));
  database.exec(
    "PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS lists (id TEXT PRIMARY KEY, subreddits TEXT NOT NULL, revision INTEGER NOT NULL)",
  );
  const select = database.prepare("SELECT subreddits, revision FROM lists WHERE id = ?");
  // Keep only revision metadata for deleted lists, so stale editors cannot revive old data.
  database.exec(
    "CREATE TABLE IF NOT EXISTS deleted_lists (id TEXT PRIMARY KEY, revision INTEGER NOT NULL)",
  );
  function readList(key) {
    const row = select.get(key);
    return row
      ? { revision: row.revision, subreddits: JSON.parse(row.subreddits) }
      : {
          revision:
            database.prepare("SELECT revision FROM deleted_lists WHERE id = ?").get(key)
              ?.revision || 0,
          subreddits: [],
        };
  }
  function writeList(key, names, revision) {
    if (names.length) {
      database
        .prepare(
          "INSERT INTO lists (id, subreddits, revision) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET subreddits = excluded.subreddits, revision = excluded.revision",
        )
        .run(key, JSON.stringify(names), revision + 1);
      database.prepare("DELETE FROM deleted_lists WHERE id = ?").run(key);
    } else {
      database.prepare("DELETE FROM lists WHERE id = ?").run(key);
      database
        .prepare(
          "INSERT INTO deleted_lists (id, revision) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision",
        )
        .run(key, revision + 1);
    }
  }
  const listKey = (name) => createHash("sha256").update(name).digest("hex");
  function normaliseLists(names) {
    const legacy = names.filter(
      (name) => name !== name.toLowerCase() && readList(listKey(name)).revision,
    );
    if (legacy.length) {
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const name of legacy) {
          const oldKey = listKey(name);
          const key = listKey(name.toLowerCase());
          const old = readList(oldKey);
          if (old.revision) {
            const current = readList(key);
            const merged = normaliseSubreddits(
              [...current.subreddits, ...old.subreddits].join(" "),
            );
            writeList(key, merged, Math.max(current.revision, old.revision));
            database.prepare("DELETE FROM lists WHERE id = ?").run(oldKey);
            database.prepare("DELETE FROM deleted_lists WHERE id = ?").run(oldKey);
          }
        }
        database.exec("COMMIT");
      } finally {
        if (database.isTransaction) database.exec("ROLLBACK");
      }
    }
    return [...new Set(names.map((name) => name.toLowerCase()))]
      .filter((name) => readList(listKey(name)).subreddits.length)
      .sort();
  }
  const assets = new Map(
    [
      ["/", ["dist/index.html", "text/html; charset=utf-8"]],
      ["/app.css", ["dist/app.css", "text/css; charset=utf-8"]],
      ["/app.js", ["dist/app.js", "text/javascript; charset=utf-8"]],
      ["/third-party-licences.txt", ["dist/third-party-licences.txt", "text/plain; charset=utf-8"]],
    ].map(([path, [file, type]]) => [
      path,
      {
        content: readFileSync(new URL(file, import.meta.url)),
        type,
      },
    ]),
  );
  const page = assets.get("/");
  const html = page.content.toString();
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    // Mantine's style elements carry this per-request nonce, written into the page's meta tag.
    const nonce = randomBytes(16).toString("base64");
    response.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; connect-src 'self' https://anvaka.github.io/redsim/data/; font-src data:; img-src 'self' data:; script-src 'self'; style-src 'self' 'nonce-${nonce}'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
    );
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Robots-Tag", "noindex, nofollow");
    const json = (status, value) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(value));
    };
    try {
      const path = new URL(request.url, "http://localhost").pathname;
      if (path === "/health" && request.method === "GET") {
        database.prepare("SELECT 1").get();
        return json(200, { status: "ok" });
      }
      if (path === "/api/config" && request.method === "GET")
        return json(200, { redlibUrl: origin.origin });
      if (path === "/api/normalise-lists" && request.method === "POST") {
        const names = (await readJson(request, 150000, "Too many list names."))?.names;
        if (
          !Array.isArray(names) ||
          names.length > 1000 ||
          names.some((name) => typeof name !== "string" || !listName.test(name))
        )
          return json(400, { error: "Provide up to 1,000 valid list names." });
        return json(200, { names: normaliseLists(names) });
      }
      if (path === "/api/check" && request.method === "POST") {
        const name = (await readJson(request, 1024, "Check one subreddit at a time.", "checks"))
          ?.subreddit;
        if (typeof name !== "string" || !subredditName.test(name))
          return json(400, { error: "Provide a valid subreddit name." });
        const cached = statusCache.get(name);
        if (cached && cached.expires > Date.now()) return json(200, { status: cached.status });
        let status = "unknown";
        try {
          const upstream = await fetchStatus(`${checkOrigin.origin}/r/${name}?limit=1`, {
            headers: { "User-Agent": "Redlib-Multi" },
            redirect: "error",
            signal: AbortSignal.timeout(10000),
          });
          if (upstream.status !== 429 && upstream.status < 500)
            status = subredditStatus(await upstream.text(), name);
        } catch {
          // A timeout, network block or upstream failure cannot establish a ban.
        }
        if (statusCache.size >= 1000) statusCache.delete(statusCache.keys().next().value);
        statusCache.set(name, {
          status,
          expires: Date.now() + (status === "unknown" ? 60000 : 900000),
        });
        return json(200, { status });
      }
      const match = /^\/api\/lists\/([a-zA-Z0-9_-]{1,128})(\/transfer)?$/.exec(path);
      if (match) {
        const name = match[1].toLowerCase();
        if (name === "health")
          return json(400, {
            error: "This name is reserved. Choose another list name.",
          });
        normaliseLists([match[1]]);
        const key = listKey(name);
        const current = () => readList(key);
        const transfer = Boolean(match[2]);
        if (!transfer && request.method === "GET") return json(200, current());
        if (request.method !== (transfer ? "POST" : "PUT"))
          return json(405, { error: "Method not allowed." });
        const input = await readJson(
          request,
          Math.max(65536, current().subreddits.length * 24 + 1024),
          "List is too large.",
        );
        if (
          !input ||
          !Number.isSafeInteger(input.revision) ||
          input.revision < 0 ||
          !Array.isArray(input.subreddits) ||
          input.subreddits.length > Math.max(1000, current().subreddits.length) ||
          input.subreddits.some((value) => typeof value !== "string")
        )
          return json(400, {
            error: "Provide a revision and up to 1,000 subreddit names.",
          });
        let names;
        try {
          names = normaliseSubreddits(input.subreddits.join(" "));
        } catch (error) {
          return json(400, { error: error.message });
        }
        if (names.length > Math.max(1000, current().subreddits.length))
          return json(400, { error: "Use up to 1,000 subreddits." });
        if (transfer) {
          const originalDestination =
            typeof input.destination === "string" ? input.destination.trim() : "";
          const destination = originalDestination.toLowerCase();
          if (!listName.test(destination) || destination === "health" || destination === name)
            return json(400, {
              error: "Choose a different valid destination list name.",
            });
          if (!["copy", "move"].includes(input.action) || !names.length)
            return json(400, { error: "Select subreddits to copy or move." });
          normaliseLists([originalDestination]);
          database.exec("BEGIN IMMEDIATE");
          try {
            const source = current();
            if (source.revision !== input.revision)
              return json(409, {
                ...source,
                error:
                  "This list changed elsewhere. The latest list is loaded; select entries and try again.",
              });
            if (names.some((name) => !source.subreddits.includes(name)))
              return json(400, {
                error: "Select entries that belong to this list.",
              });
            const destinationKey = listKey(destination);
            const destinationList = readList(destinationKey);
            const existing = destinationList.subreddits;
            const combined = [...new Set([...existing, ...names])].sort();
            if (combined.length > 1000)
              return json(400, {
                error: "The destination would exceed 1,000 subreddits.",
              });
            if (combined.length !== existing.length)
              writeList(destinationKey, combined, destinationList.revision);
            if (input.action === "move") {
              const selected = new Set(names);
              writeList(
                key,
                source.subreddits.filter((name) => !selected.has(name)),
                source.revision,
              );
            }
            database.exec("COMMIT");
            return json(200, current());
          } finally {
            if (database.isTransaction) database.exec("ROLLBACK");
          }
        }
        database.exec("BEGIN IMMEDIATE");
        try {
          if (current().revision !== input.revision)
            return json(409, {
              ...current(),
              error:
                "This list changed elsewhere. The latest list is loaded; try your change again.",
            });
          writeList(key, names, input.revision);
          database.exec("COMMIT");
          return json(200, current());
        } finally {
          if (database.isTransaction) database.exec("ROLLBACK");
        }
      }
      if (path.startsWith("/api/")) return json(404, { error: "Unknown list path." });
      if (request.method !== "GET" && request.method !== "HEAD")
        return json(405, { error: "Method not allowed." });
      const listPage = listName.test(path.slice(1));
      if (listPage && !assets.has(path)) {
        normaliseLists([path.slice(1)]);
        if (path !== path.toLowerCase() && path.toLowerCase() !== "/health") {
          response.writeHead(308, {
            Location: path.toLowerCase() + new URL(request.url, "http://localhost").search,
          });
          return response.end();
        }
      }
      const asset = assets.get(path) || (listPage ? page : null);
      if (!asset) return json(404, { error: "Page not found." });
      response.writeHead(200, { "Content-Type": asset.type });
      const content = asset === page ? html.replace("%STYLE_NONCE%", nonce) : asset.content;
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      json(error instanceof RequestError ? error.status : 500, {
        error: error instanceof RequestError ? error.message : "Unable to process this request.",
      });
    }
  });
  server.on("close", () => database.close());
  return server;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  const port = Number(setting("PORT"));
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("PORT must be a port number.");
  const host = setting("HOST");
  const server = createApp();
  server.listen(port, host);
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());
}
