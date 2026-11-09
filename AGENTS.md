# Minilab

- Keep each app in `apps/<name>`: its browser source in `web/` with the built
  bundle committed in `dist/`, a small `server.mjs` only when needed, and native
  Kubernetes resources beside it: `deploy.yaml` holds the resources and
  `kustomization.yaml` mounts the assets. Apps share the root npm package,
  `vite.config.ts` and `ui/`; add no per-app package, Docker build or Mise task.
  Prefer standard upstream runtimes and minimal deployment config; avoid
  generators, task wrappers and alternate packaging. Substantial services, such
  as Actual Up, belong in their own repositories.
- Name the Namespace after the retained deployment name, set the same name as
  the kustomization's `namespace` and include `components/app`. Write `app` as
  the placeholder HelmRelease and NetworkPolicy name; the component derives
  names and the private hostname from the Namespace. Mini apps use only this
  hostname; cluster app aliases belong to Kubelab. Select apps in
  `clusters/syd/kustomization.yaml`; Kubelab reconciles only `clusters/syd`.
- Kubelab's `minilab` Flux Kustomization confines Minilab to namespaces it
  creates, with restricted Pod Security, and to the resource kinds and release
  permissions it grants. It places every HelmRelease on
  `node.excloo.dev/network: external` nodes. A `local-path` PV is bound to the
  node that created it, so keep apps with storage on that external node and back
  up before changing placement.
- Choose a backend and datastore for the app's behaviour; existing Node.js/SQLite
  apps are examples, not a required stack. A backend such as PocketBase can
  replace custom auth, data APIs and file handling when that reduces the app's
  code and operational burden. Keep reusable recipes in the build skill.
- Build every UI from Mantine components with the shared MantineHub shadcn
  theme, through `ui/mount.tsx` and `ui/Shell.tsx`. Add no CSS, raw HTML
  elements, `className` or `style` (oxlint enforces this), and use palette
  colour names (green, red, amber, gray) rather than semantic aliases.
  `ui/vendor/mantinehub/` is an unmodified upstream copy, kept because upstream
  publishes no package; override it in `ui/theme.ts`.
- Keep `app.js` in the script ConfigMap and the other built files in the source
  ConfigMap, each mounted by `subPath`. Pages carry a `%STYLE_NONCE%` placeholder
  that the server replaces per request, with the same nonce in the CSP's
  `style-src`, because Mantine injects style elements.
- Choose private or public access from the README's table and review live route
  changes. Probe a capability-free `/health` endpoint.
- Apps listen on `0.0.0.0`, run as the image's actual non-root UID/GID, disable
  service-account token automount and use a read-only root filesystem with a
  separate writable `/tmp` where supported. Publish a custom image's exact
  version before merging the change that uses it.
- Gateways and ExternalDNS own DNS targets: never hard-code a target IP or add a
  competing record. A wildcard certificate covers one label depth only.
- Keep storage, secrets and network access isolated. Credentials stay server-side
  through ExternalSecrets that use the `onepassword` ClusterSecretStore and
  reference 1Password items titled `Minilab: <App>`, matching the route's
  Homepage name. Flux postBuild substitution applies to ConfigMaps, so disable
  it on code ConfigMaps to keep JavaScript template literals such as `${name}`
  intact.
- Kubelab owns shared substitutions in `apps/overlays/syd/minilab.yaml` and
  `apps/overlays/syd/kustomization.yaml`; backup credentials and the bucket come
  from `apps/base/minilab`. Add shared variables there. Apps have no setting
  defaults or fallbacks: a missing or empty variable, which is how Flux leaves
  a missing substitution, must stop startup with its name. Write ports and
  paths directly; do not derive them with replacements.
- Preserve deployed namespaces, release names, PVCs and old URLs during source
  cleanups. SQLite apps use one replica with `Recreate` and keep live data off
  NFS. A PVC is persistence, not a backup: before storing important data, have a
  recovery path, and copy a database only with SQLite's backup API or with the
  writer stopped. Use `apps/redlib-multi` as the backup example, with credentials
  from Kubelab's `Minilab: Backups` item. Take a consistent backup before changing
  storage, data ownership or a destructive schema migration; an image rollback
  does not undo a migration.
- Redlib Multi keeps its secret-link model and retains its existing SQLite format,
  SHA-256 keys and revisions; never discard unidentified saved lists. Mixed-case
  names fold into lowercase keys: opening or listing `Foo` merges its legacy
  record into `foo` (subreddit union, newer revision) and removes the old key.
- Kubelab's Traefik drops `RequestPath` from its access logs, which keeps Redlib
  Multi's editing URLs out of them; secret-link apps rely on that.
- Open a PR and merge into `main`; Flux deploys it directly. Ordinary mini apps
  have no Actions workflow or separate deploy branch. Source changes must update
  hashed ConfigMap references or an immutable image. Run data tests directly with
  `node --test` and render affected Kustomizations with `kubectl kustomize`.
