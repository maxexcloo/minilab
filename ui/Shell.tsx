import {
  ActionIcon,
  Anchor,
  AppShell,
  Container,
  Group,
  Title,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { IconMoon, IconSun } from "@tabler/icons-react";
import type { ReactNode } from "react";

export function Shell({ title, children }: { title: string; children: ReactNode }) {
  const { setColorScheme } = useMantineColorScheme();
  const dark = useComputedColorScheme("light") === "dark";
  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <Container size="md" h="100%">
          <Group h="100%" justify="space-between">
            <Anchor href="/" c="inherit" underline="never" aria-label={`${title} Home`}>
              <Title order={4}>{title}</Title>
            </Anchor>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              aria-label={dark ? "Light Mode" : "Dark Mode"}
              title={dark ? "Switch to Light Mode" : "Switch to Dark Mode"}
              onClick={() => setColorScheme(dark ? "light" : "dark")}
            >
              {dark ? <IconSun size={18} /> : <IconMoon size={18} />}
            </ActionIcon>
          </Group>
        </Container>
      </AppShell.Header>
      <AppShell.Main>
        <Container size="md" pb="xl">
          {children}
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
