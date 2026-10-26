import { listName } from "../../subreddits.mjs";

export type Status = "available" | "banned" | "private" | "restricted" | "unknown";
export type List = { revision: number; subreddits: string[] };

export const redsimUrl = "https://anvaka.github.io/redsim/";

/** A failed list request; a revision conflict carries the latest saved list. */
export class ListError extends Error {
  constructor(
    message: string,
    readonly latest?: List,
  ) {
    super(message);
  }
}

export async function listRequest(
  id: string,
  method: "GET" | "POST" | "PUT",
  body?: object,
  suffix = "",
): Promise<List> {
  const response = await fetch(`/api/lists/${encodeURIComponent(id)}${suffix}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  // A proxy or gateway error may return HTML instead of the API's JSON.
  const result: Partial<List> & { error?: string } = await response.json().catch(() => ({}));
  if (!response.ok || !result.subreddits)
    throw new ListError(
      result.error || "Unable to complete this request. Try again.",
      response.status === 409 && result.subreddits ? (result as List) : undefined,
    );
  return result as List;
}

export const statuses = new Map<string, Status>();
const pending = new Map<string, { request: Promise<Status>; signal?: AbortSignal }>();
const queue: Array<() => Promise<void>> = [];
let active = 0;

// One page-wide queue limits Redlib checks to two at a time.
function drain() {
  while (active < 2 && queue.length) {
    active++;
    void queue.shift()!().finally(() => {
      active--;
      drain();
    });
  }
}

export function checkSubreddit(name: string, signal?: AbortSignal): Promise<Status> {
  const existing = pending.get(name);
  if (existing && !existing.signal?.aborted) return existing.request;
  const request = new Promise<Status>((resolve) => {
    queue.push(async () => {
      if (signal?.aborted) return resolve("unknown");
      let status: Status = "unknown";
      try {
        const response = await fetch("/api/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subreddit: name }),
          signal,
        });
        if (response.ok) status = (await response.json()).status;
      } catch {
        // An aborted or failed check leaves the status unknown.
      }
      if (!signal?.aborted) statuses.set(name, status);
      resolve(status);
    });
  }).finally(() => {
    if (pending.get(name)?.request === request) pending.delete(name);
  });
  pending.set(name, { request, signal });
  drain();
  return request;
}

export const needsCheck = (name: string) => !statuses.has(name) || statuses.get(name) === "unknown";

export async function loadRedsim() {
  const options: RequestInit = {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(20000),
  };
  const [labels, links] = await Promise.all([
    fetch(new URL("data/labels.json", redsimUrl), options).then((response) => {
      if (!response.ok) throw new Error("Suggestions unavailable.");
      return response.json() as Promise<string[]>;
    }),
    fetch(new URL("data/links.bin", redsimUrl), options).then((response) => {
      if (!response.ok) throw new Error("Suggestions unavailable.");
      return response.arrayBuffer();
    }),
  ]);
  return { labels, links: new Int32Array(links) };
}

function readKnownLists(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem("lists") || "[]");
    if (Array.isArray(saved))
      return [
        ...new Set(
          saved.filter((name): name is string => typeof name === "string" && listName.test(name)),
        ),
      ];
  } catch {
    // Saved lists still work by URL when browser storage is unavailable.
  }
  return [];
}

function storeKnownLists(names: string[]) {
  try {
    localStorage.setItem("lists", JSON.stringify(names));
  } catch {
    // Browser storage may be unavailable or full.
  }
}

/** Lists this browser has opened, folded to their lowercase keys. */
export let knownLists = readKnownLists();

export function rememberList(name: string, populated: boolean) {
  knownLists = knownLists.filter((value) => value !== name);
  if (populated) knownLists.push(name);
  knownLists.sort();
  storeKnownLists(knownLists);
}

// Original spellings identify legacy hashed records before the browser history is folded.
export async function normaliseKnownLists() {
  if (!knownLists.length) return;
  try {
    const normalised: string[] = [];
    for (let offset = 0; offset < knownLists.length; offset += 1000) {
      const response = await fetch("/api/normalise-lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names: knownLists.slice(offset, offset + 1000) }),
      });
      if (!response.ok) throw new Error("Could not normalise saved lists.");
      normalised.push(...(await response.json()).names);
    }
    knownLists = [...new Set(normalised)].sort();
    storeKnownLists(knownLists);
  } catch {
    // Retain original spellings for a later migration attempt if a request fails.
  }
}
