import "@fontsource-variable/geist";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./vendor/mantinehub/shadcn-styles.css";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { cssVariablesResolver, theme } from "./theme";

/** Render an app with the shared Mantine theme and notifications. */
export function mount(app: ReactNode) {
  // The Content-Security-Policy only admits Mantine's style elements with this per-request nonce.
  const nonce = document.querySelector<HTMLMetaElement>('meta[name="style-nonce"]')?.content ?? "";
  // Mantine's scroll lock (react-style-singleton via get-nonce) reads the nonce from this global.
  (globalThis as { __webpack_nonce__?: string }).__webpack_nonce__ = nonce;
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <MantineProvider
        theme={theme}
        cssVariablesResolver={cssVariablesResolver}
        defaultColorScheme="auto"
        getStyleNonce={() => nonce}
      >
        <Notifications position="bottom-right" />
        {app}
      </MantineProvider>
    </StrictMode>,
  );
}
