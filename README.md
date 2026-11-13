# Minilab

Small self-hosted tools. Each app lives in `apps/<name>` and is published at
`https://<name>.mini.excloo.com`.

## Apps

To run [Redlib Multi](apps/redlib-multi) locally with the Node.js version in
`package.json`'s `engines`, set `DATA_DIRECTORY` (such as
`apps/redlib-multi/data`), `HOST`, `PORT`, `REDLIB_URL` to your Redlib origin
and `REDLIB_CHECK_URL` to the origin the server uses for status checks, then run
`node apps/redlib-multi/server.mjs` and open `http://<HOST>:<PORT>`.

With the [shared Mise configuration](https://github.com/maxexcloo/dotfiles#shared-tools--tasks)
installed and `npm ci` run, use `mise run check` to check the project locally.

## Add An App

For a browser-only tool, copy `templates/static` into `apps/<name>`. Rename its
Namespace together with the kustomization's `namespace`, and the ConfigMap
generators' names together with `persistence.script.name` and
`persistence.source.name`. Edit the page in `web/` and the native deployment
resources, run `mise run build`, then select the app in
`clusters/syd/kustomization.yaml`. Only add a backend if the app needs one.

| Access            | Gateway                                     | DNS                                                  |
| ----------------- | ------------------------------------------- | ---------------------------------------------------- |
| Private (default) | `private`, listener `websecure`             | Shared wildcard to SYD's private gateway             |
| Public            | `public-direct`, listener `websecuredirect` | Explicit unproxied app record managed by ExternalDNS |

Public routes need `gateway.excloo.dev/public-access: "true"` on their namespace
and route, plus `external-dns.alpha.kubernetes.io/cloudflare-proxied: "false"`.

Set the app's Homepage description, icon and `Minilab: <App>` display name on
its route. Link its safe landing page; never publish editing URLs or list
names.

## Build The Interfaces

Build every app's `web/` source into its `dist/` from the repository root:

```sh
npm ci
mise run build
```

Commit the rebuilt `dist/` with its source, including after dependency updates.
Before merging, run `mise run check` and check the page in a browser for Content
Security Policy errors.

## Licence

AGPL-3.0 — see [LICENSE](LICENSE).
