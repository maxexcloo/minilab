# Minilab

Small self-hosted tools. Each app lives in `apps/<name>` and is published at
`https://<name>.mini.excloo.com`. Open a PR, review it and merge into `main`, and
Flux deploys the change to SYD. There's no GitHub Actions workflow or deployment
branch.

## Apps

[Redlib Multi](apps/redlib-multi) manages combined subreddit feeds. Each list has
its own editing URL and persistent SQLite data. Lists saved under the old
`reddit` hostname open at the same path on `redlib-multi`. Editing URLs are
secret links, and they show up in Kubelab's Traefik access logs. I accept that
because the app is private.

The interface is in `apps/redlib-multi/web` and its built bundle is in `dist/`.
`server.mjs` handles the API and SQLite database, and `subreddits.mjs` has the
shared parsing and recommendation logic.

To run it locally, use Node.js 26 or newer:

```sh
DATA_DIRECTORY=apps/redlib-multi/data HOST=127.0.0.1 PORT=3000 \
  REDLIB_CHECK_URL=https://your-redlib.example REDLIB_URL=https://your-redlib.example \
  node apps/redlib-multi/server.mjs
```

Every setting is required, and a missing or empty value stops startup. Set
`REDLIB_URL` to your Redlib origin, including its scheme and any port, and
`REDLIB_CHECK_URL` to the origin the server uses for status checks. Then open
`http://127.0.0.1:3000`. Local data stays in the app's ignored `data/` directory.
Deployed data stays on its existing volume, so never delete that volume when
replacing the app. Run the data tests with `node --test`.

With the [shared Mise configuration](https://github.com/maxexcloo/dotfiles#shared-tools--tasks)
installed and `npm ci` run, `mise run check` runs the data tests, checks that
each committed bundle matches its source, lints and type-checks the interfaces,
renders the deployed apps and static template with the project `kubectl`, and
checks repository formatting and configuration. It does not deploy anything.

## Add An App

For a browser-only tool, copy `templates/static` into `apps/<name>`. Rename its
Namespace together with the kustomization's `namespace`, and the ConfigMap
generators' names together with `persistence.script.name` and
`persistence.source.name`. Edit the page in `web/` and the native deployment
resources, run `mise run build`, then select the app in
`clusters/syd/kustomization.yaml`. `components/app` derives the other Kubernetes
names and the hostname from the Namespace. Only add a backend if the app needs one. Flux and the
shared cluster integrations live in Kubelab, while app source and resources stay
here.

| Access            | Gateway                                     | DNS                                                  |
| ----------------- | ------------------------------------------- | ---------------------------------------------------- |
| Private (default) | `private`, listener `websecure`             | Shared wildcard to SYD's private gateway             |
| Public            | `public-direct`, listener `websecuredirect` | Explicit unproxied app record managed by ExternalDNS |

Public routes need `gateway.excloo.dev/public-access: "true"` on their namespace
and route, plus `external-dns.alpha.kubernetes.io/cloudflare-proxied: "false"`.
Both gateways use the wildcard certificate. Who can reach an app and how it
authenticates are separate choices. Keep credentials in the existing secret
integration.

`components/app` lists each app in Homepage's **Minilab** group and links its
safe landing page. Set the app's description, icon and `Minilab: <App>` display
name on its route, and the listing refreshes automatically. An AI
connection to the repository can submit PRs without cluster credentials; read
`AGENTS.md` before editing. The source is public, but stored app data and
credentials stay private.

## Build The Interfaces

Every app's page is React with [Mantine](https://mantine.dev) and the
MantineHub shadcn theme, in light and dark mode. `ui/` holds the shared theme
and page frame, and the root `package.json` holds the only dependencies. Vite
builds each `web/` directory into `dist/`, with fixed file names, fonts inlined
and the bundled packages' licences in `third-party-licences.txt`:

```sh
npm ci
mise run build
```

Commit the rebuilt `dist/` with its source. Renovate updates the dependencies;
rebuild when it does. Before merging, run `mise run check` and check the page in
a browser for Content Security Policy errors.

## Licence

AGPL-3.0 — see [LICENSE](LICENSE).
