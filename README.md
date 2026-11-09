# Minilab

Small self-hosted tools. Each app lives in `apps/<name>` and is published at
`https://<name>.mini.excloo.com`.

## Apps

[Redlib Multi](apps/redlib-multi) manages combined subreddit feeds. Each list has
its own editing URL and persistent SQLite data. Editing URLs are secret links.

To run it locally, use the Node.js version in `package.json`'s `engines`:

```sh
DATA_DIRECTORY=apps/redlib-multi/data HOST=127.0.0.1 PORT=3000 \
  REDLIB_CHECK_URL=https://your-redlib.example REDLIB_URL=https://your-redlib.example \
  node apps/redlib-multi/server.mjs
```

Every setting is required, and a missing or empty value stops startup. Set
`REDLIB_URL` to your Redlib origin, including its scheme and any port, and
`REDLIB_CHECK_URL` to the origin the server uses for status checks. Then open
`http://127.0.0.1:3000`. Local data stays in the app's ignored `data/` directory.
Run the data tests with `node --test`.

With the [shared Mise configuration](https://github.com/maxexcloo/dotfiles#shared-tools--tasks)
installed and `npm ci` run, use `mise run check` to check the project locally.

## Add An App

For a browser-only tool, copy `templates/static` into `apps/<name>`. Rename its
Namespace together with the kustomization's `namespace`, and the ConfigMap
generators' names together with `persistence.script.name` and
`persistence.source.name`. Edit the page in `web/` and the native deployment
resources, run `mise run build`, then select the app in
`clusters/syd/kustomization.yaml`. Only add a backend if the app needs one. Flux
and the shared cluster integrations live in Kubelab, while app source and
resources stay here.

| Access            | Gateway                                     | DNS                                                  |
| ----------------- | ------------------------------------------- | ---------------------------------------------------- |
| Private (default) | `private`, listener `websecure`             | Shared wildcard to SYD's private gateway             |
| Public            | `public-direct`, listener `websecuredirect` | Explicit unproxied app record managed by ExternalDNS |

Public routes need `gateway.excloo.dev/public-access: "true"` on their namespace
and route, plus `external-dns.alpha.kubernetes.io/cloudflare-proxied: "false"`.
Both gateways use the wildcard certificate. Who can reach an app and how it
authenticates are separate choices. Keep credentials in the existing secret
integration.

Set the app's Homepage description, icon and `Minilab: <App>` display name on
its route. Link its safe landing page; never publish editing URLs or list
names. The source is public, but stored app data and credentials stay private.

## Build The Interfaces

Build the interfaces from each app's `web/` directory:

```sh
npm ci
mise run build
```

Commit the rebuilt `dist/` with its source, including after dependency updates.
Before merging, run `mise run check` and check the page in a browser for Content
Security Policy errors.

## Licence

AGPL-3.0 — see [LICENSE](LICENSE).
