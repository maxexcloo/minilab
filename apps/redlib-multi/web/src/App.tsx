import { Alert } from "@mantine/core";
import { Shell } from "@ui/Shell";
import { listName } from "../../subreddits.mjs";
import { Editor } from "./Editor";
import { Welcome } from "./Welcome";

const id = location.pathname.slice(1).toLowerCase();

export function App() {
  return (
    <Shell title="Redlib Multi">
      {!id ? (
        <Welcome />
      ) : listName.test(id) ? (
        <Editor id={id} />
      ) : (
        <Alert color="red" role="status" mt="md">
          Use a single path containing letters, numbers, underscores or hyphens.
        </Alert>
      )}
    </Shell>
  );
}
