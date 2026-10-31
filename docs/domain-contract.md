# Portable managed-control-plane domain

31 October 2026. `web/domain.mjs` is the dependency-free browser/server owner of
this contract. The first profile contains one organization, one planned instance
generation and bounded workflow records. Every live adapter is unbound. Review,
confirmation and imported observations are data, never authentication, an
execution grant, a successful provision or verified readiness.

## Exact exports

```js
limits // frozen: { operations: 50, observations: 100, bytes: 262144 }
defaultIntent // frozen, shown below
normalizeWorkspace(value) // detached deeply frozen canonical workspace
createWorkspace({ orgId, instanceId, name, now })
parseWorkspace(text) // bounded UTF-8 JSON, then normalizeWorkspace
serializeWorkspace(value) // canonical pretty JSON (2 spaces) + newline
updateIntent(workspace, intent, guard)
requestOperation(workspace, { id, kind, actorId }, guard)
reviewOperation(workspace, operationId, { decision, actorId }, guard)
confirmOperation(workspace, operationId, { actorId }, guard)
cancelOperation(workspace, operationId, { actorId }, guard)
recordObservation(workspace, observation, guard)
proposedCommands(workspace) // frozen proposed command array; never dispatches
workspaceStatus(workspace) // frozen truth-limited summary
```

All mutations return a new canonical workspace; they do not modify their inputs.
They take `guard = { expectedRevision, expectedGeneration, now }`. Both integers
must match the supplied workspace/instance; `now` is an explicit canonical ISO
timestamp, at least the workspace's current `updatedAt`. These are snapshot
preconditions. A future durable store must enforce its own atomic compare-and-
swap; pure functions do not provide cross-tab or distributed locking.

## Workspace shape

```js
{
  schemaVersion: "business-claw.workspace.v1",
  revision: 0,
  createdAt: "2026-10-31T12:00:00.000Z",
  updatedAt: "2026-10-31T12:00:00.000Z",
  organization: { id: "<lowercase UUID>", name: "Acme" },
  instance: {
    id: "<different lowercase UUID>", orgId: "<organization.id>",
    generation: 1, revision: 0,
    desiredSetup: {
      purpose: "", provider: "unselected", channel: "web-chat",
      notion: "off", memory: "workspace", selfBuilding: "review-required"
    }
  },
  operations: [],
  observations: []
}
```

`defaultIntent` is the exact `desiredSetup` object above. An updated intent is
exactly those six fields: `purpose` is public portable single-line text, at most
280 UTF-16 code units; `provider` is `unselected | organization-owned`; `channel`
is only `web-chat`; `notion` is `off | requested`; `memory` is `off | workspace`;
`selfBuilding` is `off | review-required`. These are desired product settings,
not OpenClaw config keys, a connected provider or an executable setup script.
There is no arbitrary instructions/config/URL/credential field in this profile.

Organization names are nonblank single-line text of at most 80 code units.
UUIDs, finite integer revisions (0–1,000,000) and generations (1–1,000,000), and
canonical ISO timestamps are strict. All records reject unknown, symbol,
hidden, inherited or accessor properties; data-only null-prototype records are
accepted. Arrays must be dense ordinary arrays. NUL/isolated surrogates are
rejected. The canonical serialized workspace must fit `limits.bytes`.

All labels/purpose are non-secret portable text. Credential-bearing fields,
raw headers, raw config, provider errors, tokens and secret values have no
schema representation. Common credential/PEM/Bearer-like text is rejected, but
this is not a universal secret scanner: never paste credentials into labels.
Errors contain only fixed codes, never the rejected input. UI/log/export should
use canonical domain results, not echo arbitrary raw import data.

## Operation ownership and workflow

Kinds are `provision | configure | pause | resume | delete`. `requestOperation`
captures the current desired setup and instance revision in an immutable plan:

```js
{
  id, orgId, instanceId, generation, revision: 0, kind, actorId,
  state: "requested", createdAt, updatedAt,
  plan: { instanceRevision, desiredSetup },
  review: null, confirmation: null, cancellation: null
}
```

All operation ownership fields must match the workspace's organization,
instance and generation. Plan revisions cannot exceed the current instance
revision. An active plan must match the current revision and exact intent.
Operation revisions cannot exceed the workspace revision. Operation IDs are
unique. Re-requesting an existing ID with the same actor,
kind and current plan returns the existing workspace; conflicting reuse fails.

`reviewOperation` accepts `decision: reviewed | rejected` and records
`{ actorId, decision, at }`. A reviewed request can be confirmed, recording
`{ actorId, at }`; either decision is only a local workflow statement. The
allowed sequence is `requested → reviewed → confirmed`, or
`requested → rejected`. Requested/reviewed/confirmed records may be cancelled,
recording `{ actorId, at }`. No dispatch/executing/succeeded/ready state exists.
Repeating the same completed review/confirmation/cancellation by the same actor
is idempotent where the current state still matches that transition. Current
revision, generation and ownership guards still run first. Identical completed
cancellation/rejection retries may return unchanged after a later intent edit;
they grant no action. Any changed transition must pass fresh-plan checks.

Changing the intent increments workspace and instance revisions and marks all
active operations `superseded`, preserving their immutable plans and review
history. A fresh operation ID and review are then required. Other successful
mutations increment workspace revision and the changed operation revision.
Historical generations are outside this portable profile; import must select
one generation rather than merge several installations.

`proposedCommands` emits only fresh confirmed plans:

```js
{
  schemaVersion: "business-claw.command.v1", operationId, kind,
  orgId, instanceId, generation, instanceRevision, desiredSetup,
  mode: "proposal-only", adapter: "unbound", executionAuthority: "not-granted"
}
```

An actual server must authenticate, authorize, resolve the owned resource,
check the current generation/revision, bind approved runtime/schema/secrets/
hosting ports and validate actual lifecycle preconditions before any action.
This module does none of those live operations. Requesting pause/delete here
does not assert that a host exists or has stopped.

## Observations and readiness

`recordObservation` accepts the exact fields below (excluding `source` and
`verification`), checks ownership/current generation, and adds those two fixed
fields. `operationId` may be `null` or an existing operation ID.

```js
{
  id, orgId, instanceId, generation, operationId,
  kind: "resource-reported", recordedAt,
  source: "authored", verification: "unverified"
}
```

Kinds are `resource-reported | configuration-persisted | configuration-applied |
health-reported | failure-reported`. Imports may retain `source: authored |
imported`; verification must always be `unverified`. Receipts accept no raw
resource URL, output/error body, credential or chat content. They do not change
operations into success or make an instance ready. Observation IDs are unique;
exact repeats are idempotent, conflicting reuse fails.

`recordedAt` is the time the receipt enters this portable workspace ledger,
not a verified provider event time. It must fall between workspace creation and
its current update time, and cannot precede a linked operation's creation.

`workspaceStatus` returns `{ adapter: unbound, readiness: unverified, ready:
false, revision, generation, desiredRevision, pendingOperations,
proposedCommands, observationCount }`. Pending counts include only requested,
reviewed and confirmed operations. No imported field can set `ready: true` or
connect an adapter. Future verified runtime records need a separately approved
server-owned contract, not a client flag in this schema.

## Example and failures

```js
const workspace = createWorkspace({ orgId, instanceId, name: "Acme", now });
const guard = { expectedRevision: workspace.revision,
  expectedGeneration: workspace.instance.generation, now };
const requested = requestOperation(workspace,
  { id: operationId, kind: "provision", actorId }, guard);
// Refresh guard.expectedRevision after every returned transition.
const exported = serializeWorkspace(requested);
const imported = parseWorkspace(exported); // still unconnected/unverified
```

Failures are `TypeError` with fixed `business_claw_...` codes: `record_invalid`,
`field_invalid`, `text_invalid`, `secret_like_text`, `identity_invalid`,
`timestamp_invalid`, `timestamp_order`, `integer_invalid`, `schema_invalid`,
`array_invalid`, `limit_exceeded`, `ownership_mismatch`, `revision_conflict`,
`generation_conflict`, `operation_missing`, `operation_identity_conflict`,
`observation_identity_conflict`, `plan_stale`, `transition_invalid`, and
`json_invalid`. They preserve the caller's workspace. Source validation,
workflow review and static syntax inspection do not prove Auth, organization
isolation, hosted operation, provider/model behavior or managed-service delivery.
