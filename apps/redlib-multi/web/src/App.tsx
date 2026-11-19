import { Shell } from "@ui/Shell";
import { Editor } from "./Editor";
import { Welcome } from "./Welcome";

const id = location.pathname.slice(1).toLowerCase();

export function App() {
  return <Shell title="Redlib Multi">{id ? <Editor id={id} /> : <Welcome />}</Shell>;
}
