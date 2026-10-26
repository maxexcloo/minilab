import {
  Alert,
  Anchor,
  Autocomplete,
  Badge,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { listName, multiredditUrl, normaliseSubreddits } from "../../subreddits.mjs";
import {
  checkSubreddit,
  knownLists,
  ListError,
  listRequest,
  needsCheck,
  normaliseKnownLists,
  redsimUrl,
  rememberList,
  statuses,
  type List,
  type Status,
} from "./api";
import { normalisedChange } from "./input";
import { Suggestions } from "./Suggestions";

type Action = "add" | "copy" | "move" | "remove" | "suggestion";

const statusBadges: Record<Status, [label: string, colour: string]> = {
  available: ["Available", "green"],
  banned: ["Banned", "red"],
  private: ["Private", "amber"],
  restricted: ["Restricted", "amber"],
  unknown: ["Unknown", "gray"],
};

async function fetchList(id: string) {
  await normaliseKnownLists();
  const configuration = await fetch("/api/config");
  if (!configuration.ok) throw new Error("Unable to load the feed configuration.");
  const { redlibUrl }: { redlibUrl: string } = await configuration.json();
  return { redlibUrl, list: await listRequest(id, "GET") };
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    notifications.show({ color: "green", message: "Link copied." });
  } catch {
    notifications.show({ color: "gray", message: "Select and copy the link." });
  }
}

export function Editor({ id }: { id: string }) {
  const [redlibUrl, setRedlibUrl] = useState<string>();
  const [list, setList] = useState<List>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Action>();
  const [notice, setNotice] = useState<{ text: string; colour: string; retry?: boolean }>();
  const [saveState, setSaveState] = useState("Loading…");
  const [checkState, setCheckState] = useState("");
  const [filter, setFilter] = useState("");
  const [additions, setAdditions] = useState("");
  const [destination, setDestination] = useState("");
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  const [checking, setChecking] = useState<AbortController>();
  const table = useRef<HTMLTableSectionElement>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const suggestions = useRef<HTMLDivElement>(null);
  // Where focus and scroll should land once a save that removes or adds rows has rendered.
  const restore = useRef<{ remove?: number; suggestion?: number; top?: number }>(undefined);

  const subreddits = list?.subreddits ?? [];
  const selected = subreddits.filter((name) => selection.has(name));
  const visible = subreddits.filter((name) => name.includes(filter.trim()));
  const visibleSelected = visible.filter((name) => selection.has(name)).length;
  const feed = redlibUrl ? multiredditUrl(subreddits, redlibUrl) : null;
  const destinations = [...new Set(knownLists.map((name) => name.toLowerCase()))]
    .sort()
    .filter((name) => name !== id);

  const load = useCallback(
    () =>
      fetchList(id).then(
        (loaded) => {
          setRedlibUrl(loaded.redlibUrl);
          setList(loaded.list);
          rememberList(id, loaded.list.subreddits.length > 0);
          setSaveState(loaded.list.revision ? "Saved." : "Add a subreddit to save this list.");
          setLoading(false);
        },
        (error: Error) => {
          setNotice({ text: error.message, colour: "red", retry: true });
          setLoading(false);
        },
      ),
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  useLayoutEffect(() => {
    const target = restore.current;
    if (busy || !target) return;
    restore.current = undefined;
    if (target.remove !== undefined) {
      const buttons = table.current?.querySelectorAll<HTMLButtonElement>("[data-remove]") ?? [];
      (buttons[Math.min(target.remove, buttons.length - 1)] ?? addInput.current)?.focus({
        preventScroll: true,
      });
    }
    if (target.suggestion !== undefined && target.top !== undefined && suggestions.current) {
      const buttons = suggestions.current.querySelectorAll<HTMLButtonElement>("[data-suggestion]");
      buttons[Math.min(target.suggestion, buttons.length - 1)]?.focus({ preventScroll: true });
      // The saved list grows above suggestions; keep the same place in the viewport.
      window.scrollBy({
        top: suggestions.current.getBoundingClientRect().top - target.top,
        behavior: "instant",
      });
    }
  }, [busy, list]);

  function failed(error: unknown) {
    if (error instanceof ListError && error.latest) {
      setList(error.latest);
      setSelection(new Set());
    }
    setNotice({ text: (error as Error).message, colour: "red" });
  }

  async function save(next: string[], action: Action) {
    if (busy || !list) return false;
    setBusy(action);
    setNotice(undefined);
    setSaveState("Saving…");
    try {
      const result = await listRequest(id, "PUT", { revision: list.revision, subreddits: next });
      setList(result);
      rememberList(id, result.subreddits.length > 0);
      setSaveState("Saved.");
      return true;
    } catch (error) {
      failed(error);
      setSaveState("Not saved. Try again.");
      return false;
    } finally {
      setBusy(undefined);
    }
  }

  async function transfer(action: "copy" | "move") {
    if (busy || !list || !selected.length) return;
    const original = destination.trim();
    const target = original.toLowerCase();
    if (!listName.test(target) || target === "health" || target === id) {
      setNotice({ text: "Choose a different valid destination list name.", colour: "red" });
      return;
    }
    setBusy(action);
    setNotice(undefined);
    setSaveState(action === "move" ? "Moving…" : "Copying…");
    try {
      const result = await listRequest(
        id,
        "POST",
        { action, destination: original, revision: list.revision, subreddits: selected },
        "/transfer",
      );
      setList(result);
      setSelection(new Set());
      rememberList(target, true);
      rememberList(id, result.subreddits.length > 0);
      setSaveState(action === "move" ? "Moved." : "Copied.");
    } catch (error) {
      failed(error);
      setSaveState("Transfer not completed. Try again.");
    } finally {
      setBusy(undefined);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    let names: string[];
    try {
      names = normaliseSubreddits(additions);
      if (!names.length) throw new Error("Enter at least one subreddit.");
    } catch (error) {
      setNotice({ text: (error as Error).message, colour: "red" });
      return;
    }
    const next = [...new Set([...subreddits, ...names])].sort();
    if (next.length === subreddits.length)
      return setNotice({ text: "Already in this list.", colour: "gray" });
    if (await save(next, "add")) setAdditions("");
  }

  async function checkAll() {
    if (checking) return checking.abort();
    const controller = new AbortController();
    setChecking(controller);
    const names = subreddits.filter(needsCheck);
    let completed = 0;
    const progress = (stopped = false) => {
      const banned = subreddits.filter((name) => statuses.get(name) === "banned").length;
      const state = stopped
        ? "Needs Attention · Stopped"
        : completed === names.length
          ? "Completed · Checked"
          : "Running · Checking";
      setCheckState(`${state} ${completed}/${names.length} · ${banned} banned`);
      refresh();
    };
    progress();
    await Promise.all(
      names.map(async (name) => {
        await checkSubreddit(name, controller.signal);
        if (controller.signal.aborted) return;
        completed++;
        progress();
      }),
    );
    setChecking(undefined);
    progress(controller.signal.aborted);
  }

  function select(names: string[], on: boolean) {
    const next = new Set(selection);
    for (const name of names) {
      if (on) next.add(name);
      else next.delete(name);
    }
    setSelection(next);
  }

  return (
    <Stack gap="lg" pt="md">
      {notice && (
        <Alert color={notice.colour} role="status" aria-live="polite">
          <Group justify="space-between" gap="sm">
            <Text size="sm">{notice.text}</Text>
            {notice.retry && (
              <Button
                size="xs"
                variant="default"
                onClick={() => {
                  setNotice(undefined);
                  setLoading(true);
                  void load();
                }}
              >
                Retry
              </Button>
            )}
          </Group>
        </Alert>
      )}
      {loading && (
        <Group gap="sm" role="status">
          <Loader size="sm" />
          <Text>Loading your list…</Text>
        </Group>
      )}
      {list && redlibUrl && !loading && (
        <>
          <Group justify="space-between" gap="sm">
            <Group gap="sm">
              <Title order={1}>{id}</Title>
              <Badge variant="light" color="gray">
                {subreddits.length}
              </Badge>
            </Group>
            <Button variant="subtle" onClick={() => copy(location.href)}>
              Copy Editing Link
            </Button>
          </Group>
          <Card>
            <Stack gap="sm">
              <Title order={2} size="h4">
                Combined Feed
              </Title>
              {feed ? (
                <Anchor href={feed} target="_blank" rel="noreferrer" size="sm" truncate="end">
                  {feed}
                </Anchor>
              ) : (
                <Text size="sm" c="dimmed">
                  Add subreddits to build your feed.
                </Text>
              )}
              <Group>
                <Button variant="default" disabled={!feed} onClick={() => feed && copy(feed)}>
                  Copy Feed Link
                </Button>
              </Group>
            </Stack>
          </Card>
          <Card>
            <Stack gap="lg">
              <form onSubmit={add}>
                <Group align="flex-end" gap="sm" wrap="nowrap">
                  <TextInput
                    ref={addInput}
                    label="Add Subreddits"
                    placeholder="Names, r/ links or a multi link"
                    autoComplete="off"
                    autoCapitalize="none"
                    required
                    flex={1}
                    value={additions}
                    onChange={normalisedChange("subreddits", setAdditions)}
                  />
                  <Button type="submit" disabled={Boolean(busy)} loading={busy === "add"}>
                    Add
                  </Button>
                </Group>
              </form>
              <Divider />
              <Stack gap="sm">
                <Group justify="space-between" gap="sm">
                  <Title order={2} size="h4">
                    Subreddits
                  </Title>
                  <Text size="sm" c="dimmed" role="status">
                    {saveState}
                  </Text>
                </Group>
                <Group gap="sm">
                  <TextInput
                    type="search"
                    aria-label="Filter Subreddits"
                    placeholder="Filter subreddits"
                    autoCapitalize="none"
                    flex={1}
                    miw={180}
                    value={filter}
                    onChange={normalisedChange("subreddits", setFilter)}
                  />
                  <Button
                    variant="default"
                    disabled={!checking && (Boolean(busy) || !subreddits.some(needsCheck))}
                    onClick={checkAll}
                  >
                    {checking ? "Stop Check" : "Check Availability"}
                  </Button>
                </Group>
                {checkState && (
                  <Text size="sm" c="dimmed" aria-live="polite">
                    {checkState}
                  </Text>
                )}
                <Group justify="space-between" gap="sm">
                  <Checkbox
                    size="xs"
                    label="Select Visible"
                    checked={visible.length > 0 && visibleSelected === visible.length}
                    indeterminate={visibleSelected > 0 && visibleSelected < visible.length}
                    disabled={Boolean(busy) || !visible.length}
                    onChange={(event) => select(visible, event.currentTarget.checked)}
                  />
                  <Group gap="sm">
                    <Text size="sm" c="dimmed">
                      {selected.length} Selected
                    </Text>
                    <Button
                      variant="subtle"
                      size="xs"
                      disabled={Boolean(busy) || !selected.length}
                      onClick={() => setSelection(new Set())}
                    >
                      Clear
                    </Button>
                  </Group>
                </Group>
                {selected.length > 0 && (
                  <Card withBorder>
                    <Stack gap="sm">
                      <Autocomplete
                        label="Destination List"
                        placeholder="Choose a saved list or enter a new one"
                        autoComplete="off"
                        autoCapitalize="none"
                        maxLength={128}
                        data={destinations}
                        disabled={Boolean(busy)}
                        value={destination}
                        onChange={(value) => setDestination(value.trim())}
                      />
                      <Group gap="sm">
                        <Button
                          variant="default"
                          disabled={Boolean(busy)}
                          loading={busy === "copy"}
                          onClick={() => transfer("copy")}
                        >
                          Copy Selected
                        </Button>
                        <Button
                          variant="default"
                          disabled={Boolean(busy)}
                          loading={busy === "move"}
                          onClick={() => transfer("move")}
                        >
                          Move Selected
                        </Button>
                        <Button
                          variant="outline"
                          color="red"
                          disabled={Boolean(busy)}
                          loading={busy === "remove"}
                          onClick={() =>
                            save(
                              subreddits.filter((name) => !selection.has(name)),
                              "remove",
                            )
                          }
                        >
                          Remove Selected
                        </Button>
                      </Group>
                    </Stack>
                  </Card>
                )}
                {!subreddits.length ? (
                  <Text size="sm" c="dimmed">
                    No subreddits yet. Add some above to get started.
                  </Text>
                ) : !visible.length ? (
                  <Text size="sm" c="dimmed">
                    No subreddits match your filter.
                  </Text>
                ) : (
                  <Table verticalSpacing="xs" aria-label="Subreddits">
                    <Table.Tbody ref={table}>
                      {visible.map((name, index) => {
                        const status = statuses.get(name);
                        return (
                          <Table.Tr key={name}>
                            <Table.Td w={32}>
                              <Checkbox
                                size="xs"
                                aria-label={`Select r/${name}`}
                                checked={selection.has(name)}
                                disabled={Boolean(busy)}
                                onChange={(event) => select([name], event.currentTarget.checked)}
                              />
                            </Table.Td>
                            <Table.Td>
                              <Group gap="xs">
                                <Anchor
                                  href={`${redlibUrl}/r/${name}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {name}
                                </Anchor>
                                {status && (
                                  <Badge
                                    variant="light"
                                    color={statusBadges[status][1]}
                                    title={
                                      status === "unknown"
                                        ? "The community's status could not be confirmed."
                                        : "Checked through Redlib."
                                    }
                                  >
                                    {statusBadges[status][0]}
                                  </Badge>
                                )}
                              </Group>
                            </Table.Td>
                            <Table.Td>
                              <Group gap={0} justify="flex-end" wrap="nowrap">
                                <Button
                                  component="a"
                                  size="xs"
                                  variant="subtle"
                                  href={`${redsimUrl}#!?q=${encodeURIComponent(name)}`}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  aria-label={`Similar to r/${name}`}
                                >
                                  Similar
                                </Button>
                                <Button
                                  size="xs"
                                  variant="subtle"
                                  color="red"
                                  data-remove
                                  disabled={Boolean(busy)}
                                  aria-label={`Remove r/${name}`}
                                  onClick={() => {
                                    restore.current = { remove: index };
                                    void save(
                                      subreddits.filter((value) => value !== name),
                                      "remove",
                                    );
                                  }}
                                >
                                  Remove
                                </Button>
                              </Group>
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                )}
              </Stack>
            </Stack>
          </Card>
          <Stack ref={suggestions}>
            <Suggestions
              subreddits={subreddits}
              redlibUrl={redlibUrl}
              busy={Boolean(busy)}
              onChecked={refresh}
              onAdd={(name, index) => {
                restore.current = {
                  suggestion: index,
                  top: suggestions.current?.getBoundingClientRect().top,
                };
                void save([...new Set([...subreddits, name])].sort(), "suggestion");
              }}
            />
          </Stack>
        </>
      )}
    </Stack>
  );
}
