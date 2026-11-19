import { Notifications } from "@mantine/notifications";
import { mount } from "@ui/mount";
import "@mantine/notifications/styles.css";
import { App } from "./App";

mount(
  <>
    <Notifications position="bottom-right" />
    <App />
  </>,
);
