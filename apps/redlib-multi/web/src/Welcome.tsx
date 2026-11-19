import { Box, Button, Card, Group, Stack, Text, TextInput, Title } from "@mantine/core";
import { useState, type FormEvent } from "react";
import { listName, maxListNameLength, reservedList } from "../../subreddits.mjs";
import { normalisedChange } from "./input";

export function Welcome() {
  const [name, setName] = useState("");
  const [invalid, setInvalid] = useState<string>();

  // The server folds a legacy mixed-case list into its lowercase key and redirects there.
  function open(event: FormEvent) {
    event.preventDefault();
    if (!listName.test(name))
      return setInvalid(`Use up to ${maxListNameLength} letters, numbers, underscores or hyphens.`);
    if (reservedList(name)) return setInvalid("This name is reserved. Choose another list name.");
    location.assign(`/${name}`);
  }

  return (
    <Stack gap="lg" pt="md" maw={640} mx="auto">
      <Card>
        <Stack gap="lg">
          <Stack gap="xs">
            <Title order={1}>Your Subreddits, One Feed</Title>
            <Text size="sm" c="dimmed">
              Open a saved list or start a new one. Add your favourite subreddits and read them
              together.
            </Text>
          </Stack>
          <Box component="form" onSubmit={open} noValidate>
            <Group align="flex-end" gap="sm" wrap="nowrap">
              <TextInput
                label="List Name"
                autoComplete="off"
                autoCapitalize="none"
                maxLength={maxListNameLength}
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
          </Box>
        </Stack>
      </Card>
    </Stack>
  );
}
