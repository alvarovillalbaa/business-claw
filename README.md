# Business Claw

A managed OpenClaw workspace for customer organizations, with a separate
isolated runtime boundary per organization. The product is in development.

The source includes a private Postgres store, authenticated same-origin API and
server-workspace dashboard alongside the browser-local preview. A dedicated
free Supabase database and its private schema are provisioned. Production
environment and Auth delivery configuration remain incomplete, so the workspace reports
setup pending. No Gateway, model, chat, Notion connector or runtime is connected.

The chosen outcome is a managed service. The preview and portable data are its
foundation; they do not complete that service. See [the product contract](docs/spec.md)
and [managed-service architecture](docs/proposals/managed-service-architecture.md).

## Source

Native browser modules and a dependency-free Node source validator require no
package installation. Node 24.21.0 or newer is used for the source checks:

```sh
node scripts/check-source.mjs
```

To open the preview using an existing Python installation:

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory web
```

Then visit `http://127.0.0.1:8080`. A static host can serve `web/` directly.
The Vercel configuration installs the pinned PostgreSQL driver from its lock,
runs static validation, serves that directory and routes `/api/v1` to the BFF.
It does not start a Gateway or background service. Commands here are
instructions, not claims that they were executed. A plain local static server
supports the local preview; it does not emulate the hosted API.

## Records and boundaries

The shared [domain contract](docs/domain-contract.md) owns portable records,
ownership, revision and operation transitions. The browser uses those same
functions. Imported JSON is data, never code or an execution permission.
No credential is requested or accepted as a setup field. Saving on this device
is explicit; export is separate from saving, provisioning or cloud persistence.

The [runtime configuration data contract](docs/runtime-config-contract.md)
separates raw revision tokens, reported persistence and observed application.
Its pure module reconciles supplied receipts and observations for an exact
target; it has no transport, live adapter or readiness claim. The
[pinned runtime research](docs/research/2026-10-31/openclaw-runtime-contract.md)
and [artifact provenance research](docs/research/2026-10-31/openclaw-artifact-provenance.md)
record upstream evidence and remaining qualification gaps.

The [server policy boundary](docs/server-policy-contract.md) resolves current
identity, application session and organization membership through trusted ports.
It owns role-checked lifecycle, invitation and Owner-transfer decisions with
transactional revision/audit changes. The [HTTP/Auth boundary](docs/backend-http-contract.md)
and [Postgres adapter](docs/postgres-store-contract.md) implement those ports;
the [dashboard](docs/live-dashboard.md) keeps server and local records separate.
Missing production bindings fail closed. See [configuration](docs/backend-configuration.md)
and [actual activation evidence](docs/results/2026/10-31/backend-activation.md)
for what is configured and what remains unverified.

Review and confirmation records describe an intended operation. They cannot
authenticate a person or authorize a live provider. Hosted adapters must obtain
their own trusted identity, organization access and exact target binding before
executing a command. Upstream profiles and operator roles do not establish
hostile-customer isolation.

The full service still needs working production identity/persistence bindings,
qualified email delivery, real isolated runtimes, revision-checked applied
configuration, org-owned remote Notion MCP, memory and reviewed self-building.
Source, fake providers and a successful build do not establish those outcomes.
Earlier [source/publication evidence](docs/results/2026/10-31/source.md) retains
its actual historical scope and proof limits.

The [runtime source publication receipt](docs/results/2026/10-31/runtime-publication.md)
tracks the later data-contract source and its separate execution scope.

## Verification

The owner's blanket approval cleared the prepared check scopes and focused
local verification of this backend source. The [14 domain cases](docs/results/2026/10-31/domain-checks.md)
passed at immutable `1b5dcc8`; the [18 runtime-data cases](docs/results/2026/10-31/runtime-checks.md)
passed at immutable `3b39c2b`. The [policy source and check receipt](docs/results/2026/10-31/server-policy-checks.md)
owns the separate 32 fake-port cases and their actual execution status.

The [four browser scenarios](docs/results/2026/10-31/browser-checks.md) remain
approved; one is partial and three unrun after a plugin-worker version failure.
The [Auth/HTTP receipt](docs/results/2026/10-31/auth-http-checks.md) owns its
separate focused fake-port results. The latest
[backend activation receipt](docs/results/2026/10-31/backend-activation.md)
records116 passing integrated cases, the applied schema/grants and three
successful public HTTP checks. These do not qualify live accounts, delivery,
runtime execution or the new dashboard's browser behavior.
Later source does not rewrite an earlier checked identity. Static validation
imports no product module and runs no test controller. The live managed service
remains unfinished.
