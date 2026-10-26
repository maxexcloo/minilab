import { Alert, Button, Card, Group, Stack, Text, TextInput, Title } from "@mantine/core";
import { useState, type FormEvent } from "react";
import { listName } from "../../subreddits.mjs";
import { normalisedChange } from "./input";

export function Welcome() {
  const [name, setName] = useState("");
  const [invalid, setInvalid] = useState<string>();
  const [failure, setFailure] = useState<string>();

  async function open(event: FormEvent) {
    event.preventDefault();
    if (!listName.test(name))
      return setInvalid("Use up to 128 letters, numbers, underscores or hyphens.");
    if (name.toLowerCase() === "health")
      return setInvalid("This name is reserved. Choose another list name.");
    try {
      const response = await fetch(`/api/lists/${encodeURIComponent(name)}`);
      if (!response.ok) throw new Error("Unable to open this list. Try again.");
      location.assign(`/${name.toLowerCase()}`);
    } catch (error) {
      setFailure((error as Error).message);
    }
  }

  return (
    <Stack gap="lg" pt="md" maw={640} mx="auto">
      {failure && (
        <Alert color="red" role="status">
          {failure}
        </Alert>
      )}
      <Card>
        <Stack gap="lg">
          <Stack gap="xs">
            <Title order={1}>Your Subreddits, One Feed</Title>
            <Text size="sm" c="dimmed">
              Open a saved list or start a new one. Add your favourite subreddits and read them
              together.
            </Text>
          </Stack>
          <form onSubmit={open} noValidate>
            <Group align="flex-end" gap="sm" wrap="nowrap">
              <TextInput
                label="List Name"
                autoComplete="off"
                autoCapitalize="none"
                maxLength={128}
                required
                flex={1}
                value={name}
                error={invalid}
                onChange={(event) => {
                  setInvalid(undefined);
                  normalisedChange("name", setName)(event);
                }}
              />
              <Button type="submit">Open List</Button>
            </Group>
          </form>
        </Stack>
      </Card>
    </Stack>
  );
}
