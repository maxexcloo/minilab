import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type Rolldown } from "vite";

// Each built file lands in a ConfigMap, which Kubernetes caps at 1 MiB.
const sizeLimit = 900 * 1024;

/** Add the vendored theme to Vite's licence file and refuse files a ConfigMap cannot hold. */
function packaging(): Plugin {
  return {
    name: "minilab-packaging",
    apply: "build",
    generateBundle: {
      // Runs after Vite's licence plugin has emitted its file.
      order: "post",
      async handler(_options, bundle) {
        const licences = bundle["third-party-licences.txt"] as Rolldown.OutputAsset;
        licences.source += `\n## MantineHub shadcn theme (ui/vendor/mantinehub)\n\n${await readFile("ui/vendor/mantinehub/LICENSE", "utf8")}`;
        for (const output of Object.values(bundle)) {
          const size = Buffer.byteLength(output.type === "chunk" ? output.code : output.source);
          if (size > sizeLimit)
            this.error(
              `${output.fileName} is ${Math.ceil(size / 1024)} KiB; a ConfigMap holds 1 MiB`,
            );
        }
      },
    },
  };
}

// Build one app with `vite build --config vite.config.ts apps/<name>/web`. Fixed file names keep
// each app's ConfigMap file lists stable, and fonts are inlined so the build is four files.
export default defineConfig({
  plugins: [react(), packaging()],
  resolve: { alias: { "@ui": resolve("ui") } },
  build: {
    assetsInlineLimit: () => true,
    chunkSizeWarningLimit: sizeLimit / 1024,
    emptyOutDir: true,
    license: { fileName: "third-party-licences.txt" },
    outDir: "../dist",
    rolldownOptions: { output: { assetFileNames: "app[extname]", entryFileNames: "app.js" } },
  },
});
