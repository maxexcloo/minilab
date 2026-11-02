import { Anchor, Button, Card, Group, Stack, Text, Title } from "@mantine/core";
import { useEffect, useState } from "react";
import { relatedSubreddits } from "../../subreddits.mjs";
import { checkSubreddit, loadRedsim, redlibUrl, redsimUrl, statuses, type Status } from "./api";

type Redsim = Awaited<ReturnType<typeof loadRedsim>>;

/** Related subreddits from RedSim, keeping only those Redlib confirms are available. */
export function Suggestions({
  subreddits,
  busy,
  onAdd,
  onChecked,
}: {
  subreddits: string[];
  busy: boolean;
  onAdd: (name: string, index: number) => void;
  onChecked: () => void;
}) {
  const [redsim, setRedsim] = useState<Redsim>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; names: string[]; partial: boolean }>();
  const shown = subreddits.length > 0;
  const key = subreddits.join("+");
  const run = `${attempt}:${key}`;

  useEffect(() => {
    if (!shown || redsim) return;
    let current = true;
    loadRedsim().then(
      (data) => current && setRedsim(data),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [shown, redsim, attempt]);

  useEffect(() => {
    if (!redsim || !key) return;
    const names = key.split("+");
    const controller = new AbortController();
    void (async () => {
      const candidates = relatedSubreddits(redsim.labels, redsim.links, names, Infinity);
      const available: string[] = [];
      let partial = false;
      for (let index = 0; index < candidates.length && available.length < 20; index += 2) {
        const batch = candidates.slice(index, index + 2);
        const results = await Promise.all(
          batch.map(
            (name): Status | Promise<Status> =>
              statuses.get(name) ?? checkSubreddit(name, controller.signal),
          ),
        );
        if (controller.signal.aborted) return;
        batch.forEach((name, offset) => {
          if (results[offset] === "available") available.push(name);
        });
        if (results.includes("unknown")) partial = true;
        // Pause on an upstream outage instead of probing the whole graph repeatedly.
        if (results.every((status) => status === "unknown")) break;
      }
      setResult({ key: `${attempt}:${key}`, names: available.slice(0, 20), partial });
      onChecked();
    })();
    return () => controller.abort();
  }, [redsim, key, attempt, onChecked]);

  // Earlier suggestions stay listed, minus any just added, while replacements are checked.
  const suggested = (result?.names ?? []).filter((name) => !subreddits.includes(name));
  const checking = Boolean(redsim) && result?.key !== run;
  const incomplete = !checking && Boolean(result?.partial);
  if (!shown) return null;
  const loading = !redsim && !failed;
  const state = loading
    ? "Finding related subreddits…"
    : checking
      ? "Checking related subreddits…"
      : failed || incomplete
        ? "Some suggestions could not be checked. Try again."
        : suggested.length
          ? ""
          : "No related subreddits found.";
  return (
    <Card>
      <Stack gap="sm">
        <Title order={2} size="h4">
          Suggested Subreddits
        </Title>
        {state && (
          <Text size="sm" c="dimmed">
            {state}
          </Text>
        )}
        <Stack gap={4} aria-label="Suggested Subreddits">
          {suggested.map((name, index) => (
            <Group key={name} justify="space-between" wrap="nowrap" gap="sm">
              <Anchor href={`${redlibUrl}/r/${name}`} target="_blank" rel="noreferrer">
                {name}
              </Anchor>
              <Button
                size="xs"
                variant="default"
                disabled={busy}
                data-suggestion={index}
                aria-label={`Add r/${name}`}
                onClick={() => onAdd(name, index)}
              >
                Add
              </Button>
            </Group>
          ))}
        </Stack>
        {(failed || incomplete) && (
          <Group>
            <Button
              variant="subtle"
              size="xs"
              onClick={() => {
                for (const [name, status] of statuses)
                  if (status === "unknown") statuses.delete(name);
                setFailed(false);
                setAttempt((value) => value + 1);
              }}
            >
              Retry
            </Button>
          </Group>
        )}
        <Text size="sm" c="dimmed">
          Related subreddits from{" "}
          <Anchor href={redsimUrl} target="_blank" rel="noreferrer" inherit>
            RedSim
          </Anchor>
          .
        </Text>
      </Stack>
    </Card>
  );
}
