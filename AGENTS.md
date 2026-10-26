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
  the kustomization's `namespace` and include `components/app`. It sets the
  shared app-template chart, derives the HelmRelease name, release name,
  `nameOverride`, NetworkPolicy name and pod selector, and mounts the hashed
  names of the `persistence.script` and `persistence.source` ConfigMaps. It
  also supplies the `minilab` ServiceAccount and its RoleBinding to ClusterRole
  `minilab-release`, and runs every HelmRelease as that account. Write `app` as the placeholder HelmRelease
  and NetworkPolicy name.
- `components/app` also owns the private route at
  `<namespace>.${MINILAB_DOMAIN}` (`mini.excloo.com`). Mini apps use only this
  hostname; cluster app aliases belong to Kubelab. Select apps in
  `clusters/syd/kustomization.yaml`; Kubelab reconciles only `clusters/syd`.
- Kubelab's `minilab` Flux Kustomization confines Minilab to namespaces it
  creates, with restricted Pod Security, and to the resource kinds and release
  permissions it grants. It places every HelmRelease on
  `node.excloo.dev/network: external` nodes. A `local-path` PV is bound to the node that created it, so keep apps with
  storage on that external node and back up before changing placement.
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
- Run `mise run build` after changing `web/`, `ui/` or dependencies and commit
  `dist/`; `mise run check` fails when a bundle is stale. A ConfigMap holds at
  most 1 MiB, so `app.js` goes in the `<app>-script` ConfigMap and the other
  built files in `<app>-source`, each mounted by `subPath`. The build refuses a
  file over 900 KiB. Pages carry a `%STYLE_NONCE%` placeholder that the server
  replaces per request, with the same nonce in the CSP's `style-src`, because
  Mantine injects style elements.
- Private apps use the private gateway and shared wildcard DNS. Public apps use
  SYD's `public-direct` gateway, `websecuredirect` listener, public-access
  namespace and route labels, and unproxied ExternalDNS records. Review live route
  changes.
- `components/app` enables Homepage discovery in the `Minilab` group and links
  the safe landing URL derived from the route. Name each route
  `gethomepage.dev/name: "Minilab: <App>"`; Kubelab's cluster groups show that
  prefix. Never publish editing capabilities or list names.
  Probe a capability-free `/health` endpoint.
- Apps listen on `0.0.0.0`, run as the image's actual non-root UID/GID, disable
  service-account token automount and use a read-only root filesystem with a
  separate writable `/tmp` where supported. Publish a custom image's exact
  version before merging the change that uses it.
- Gateways and ExternalDNS own DNS targets: never hard-code a target IP or add a
  competing record. A wildcard certificate covers one label depth only.
- Keep storage, secrets and network access isolated. Credentials stay server-side
  through ExternalSecrets that use the `onepassword` ClusterSecretStore and
  reference 1Password items titled `Minilab: <App>`, matching the route's
  Homepage name. Flux postBuild
  substitution applies to ConfigMaps, so disable it on code ConfigMaps to keep
  JavaScript template literals such as `${name}` intact.
- The `minilab` Kustomization gets `MINILAB_DOMAIN` from Kubelab's
  `platform/settings` (`minilab_domain`). Kubelab's `apps/overlays/syd/minilab.yaml`
  sets `REDLIB_URL` (Redlib's public origin, replaced from its route in the
  overlay's `kustomization.yaml`) and `REDLIB_CHECK_URL` (its in-cluster service).
  Add other shared variables to the overlay. Apps
  have no setting defaults or fallbacks: a missing or empty variable, which is
  how Flux leaves a missing substitution, must stop startup with its name. Write
  ports and paths directly; do not derive them with replacements.
- Preserve deployed namespaces, release names, PVCs and old URLs during source
  cleanups. SQLite apps use one replica with `Recreate` and keep live data off
  NFS. A PVC is persistence, not a backup: before storing important data, have a
  recovery path, and copy a database only with SQLite's backup API or with the
  writer stopped. Back up like `apps/redlib-multi`: a `backup` cronjob
  controller snapshots the database and restic stores it under
  `${MINILAB_BACKUP_BUCKET}/<namespace>`, with credentials from Kubelab's
  `Minilab: Backups` item. Take a consistent backup before changing storage, data
  ownership or a destructive schema migration; an image rollback does not undo
  a migration.
- Redlib Multi keeps its secret-link model and retains its existing SQLite format,
  SHA-256 keys and revisions; never discard unidentified saved lists. Mixed-case
  names fold into lowercase keys: opening or listing `Foo` merges its legacy
  record into `foo` (subreddit union, newer revision) and removes the old key.
- Traefik's JSON access logs record request paths, including Redlib Multi's editing
  URLs. This is accepted while the app is private; revisit it before publishing
  any secret-link app.
- Open a PR and merge into `main`; Flux deploys it directly. Ordinary mini apps
  have no Actions workflow or separate deploy branch. A GitHub AI connection may
  submit PRs without Kubernetes credentials, but must respect PR review and the
  existing credential integration. Source changes must update hashed ConfigMap
  references or an immutable image. Run data tests directly with `node --test` and
  render affected Kustomizations with `kubectl kustomize`.
