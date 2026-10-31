# Hetzner compute port

31 October 2026. Original source, unbound: no account, credential, VM, network,
provider call or paid resource is activated. This is a **server-only VM adapter**,
not the complete [hosting topology](proposals/runtime-activation.md). Volumes,
Networks, Firewalls, SSH keys and Primary IPs must already exist under an approved
server-owned resource manifest. Their creation, encrypted state, OS bootstrap,
OCI installation, ingress, broker, backup/restore and retirement are separate owners.

## Trusted seam

[`runtime/compute-provider.mjs`](../runtime/compute-provider.mjs) exports
`createComputeProvider({transport,admission,ledger,clock,timeoutMs?})` and pure
`normalizeComputeAdmission`, `computeRequestHash`, `normalizeComputeDescriptor`,
`normalizeComputeReceipt`. There is no environment read, credential/default fetch,
process, guest command, scheduler or database import. Missing ports fail closed.
The public methods are `execute(operationId)` and `reconcile(operationId)`; the
caller can supply only a Business Claw UUID, never an endpoint or resource label.

`admission.authorize(operationId)` must resolve current authenticated server-side
authority, approved paid quote/resource limits, qualified artifact and the current
organization/instance/generation/installation, returning this exact DTO:

```text
{operationId, requestId, fence, binding, action, serverId, manifest}
binding = {orgId, instanceId, generation, installationId, releaseCommit}
action = create | poweron | shutdown | delete
manifest = {creationRequestId, name, serverType, location, imageId,
            networkIds, firewallIds, volumeIds, sshKeyIds, ipv4Id, ipv6Id}
```

This injected function is the trust boundary; a DTO or `approved` flag supplied by
a browser is not authorization. No authorizer is bound here. Portable v1 review
records, caller claims and labels cannot enable execution. All binding fields use
the existing [runtime binding](runtime-config-contract.md). Provider IDs are positive
safe integers; fences/revisions are positive safe integers. UUIDs are lowercase;
times are real canonical UTC ISO strings with milliseconds. Names use bounded
lowercase alphanumeric/hyphen syntax. Records reject extra/inherited/accessor,
symbol and hidden fields; arrays reject sparse/getter/duplicate/extra elements.
All normalized records and results are detached and deeply frozen.

`serverId` is null only for create. `creationRequestId` equals create's `requestId`
and remains the original VM allocation identity in later operations. New operation
request IDs never overwrite ownership labels. An image ID is an approved provider
OS/snapshot identity, not proof that an OpenClaw OCI image was installed or qualified.
The current adapter requires at least one private Network, Firewall and SSH key,
at most three Networks, at most eight other references/group. Null IP IDs disable
that address family. Existing IPs must have `auto_delete:false`; server deletion
does not silently retire them. There is no cloud-init/userdata or credential field.

## Durable journal port

`ledger.reserve(descriptor)` durably and atomically commits the first reservation
before any provider mutation and returns `{acquired,receipt}`. Only the first-ever
`acquired:true` may dispatch; another worker/replay gets `false` and reads only.
The reservation must survive process failure and unknown request completion.
`ledger.read(operationId)` returns the stored receipt/null.
`ledger.commit({expectedRevision,receipt})` atomically checks identity, fence and
old revision, persists the next revision and returns boolean; success is strictly
`true`. No optimistic in-memory journal is a production implementation.

```text
descriptor = {operationId,requestId,fence,binding,action,serverId,requestHash,observedAt}
receipt = {operationId,requestId,fence,binding,action,requestHash,revision,state,
           serverId,actionIds,providerStatus,actionStatus,observedAt,errorCode}
state = reserved | uncertain | pending | succeeded | failed
```

Initial receipt is revision 1, `reserved`, descriptor serverId, empty action IDs,
null provider/action status and error. The SHA-256 request hash uses normalized
`{operationId,requestId,binding,action,serverId,manifest}` in that order; observation
time/fence are excluded. Identity/fence drift fails closed. Fence rotation/reclaim
requires a separately reviewed recovery owner; this port does not silently take
over a different fence. Create's null descriptor serverId may progress to the
actual verified ID. Other operations keep their exact original serverId.
Commits use revision+1; clocks moving backward fail rather than reorder evidence.
Unexpected journal failures return fixed errors, never raw database/provider text.

## Dispatch and reconciliation

- Fixed origin: `https://api.hetzner.cloud/v1`. Transport receives
  `{method,url,body,signal,maxResponseBytes}` and returns exactly `{status,body}`,
  where body is JSON text. The trusted transport owns project-bound authorization,
  TLS, redirect refusal and streaming size enforcement. It must honor AbortSignal;
  no global BFF secret is passed to customers. Responses are checked again here.
- Create checks exact existing dependency IDs and org/instance/generation/install
  labels; Volumes and IPs must be unassigned. It rechecks current admission just
  before POST. The fixed create request uses `start_after_create:false`,
  `automount:false`, explicit approved IP IDs/disabled families and no implicit
  replacement resources, cloud-init or credentials. Provider root passwords are
  discarded and never appear in a receipt.
- Before power/shutdown/delete, GET must match the stored server ID, all six fixed
  `bc_org/instance/generation/installation/release/request` labels and manifest
  name/type/location/image/Networks/Volumes/Firewall/IP IDs; current admission is
  reread immediately before mutation. Create accepts HTTP 201; delete accepts 200.
  Power/shutdown accept only 200 or 201 with the same exact action/resource checks:
  200 preserves current official SDK fixture compatibility; 201 is a creation
  acknowledgement. This is source compatibility, not observed provider acceptance.
  Shutdown is graceful: no timed force-off,
  resize, protection removal, restart or fallback region/type is implicit.
- A create response can precede attachment completion. Its owned server identity
  and returned action IDs are persisted as pending; complete topology must match
  a later observation. Every returned/polled action must name that exact server.
  Up to 16 unique action IDs are retained and polled by exact `/actions/{id}`.
- Lost/malformed/oversized/timed-out responses or 5xx produce `uncertain` with a
  fixed error. Repeated execute never resends: it reconciles exact stored IDs, or
  searches all fixed ownership labels including original request identity if the
  create ID was lost. Zero/multiple matches and a nonterminal pagination page stay
  uncertain; the adapter does not follow arbitrary URLs or allocate a replacement.
- Successful compute requires the expected observed state, no server lock and no
  running/failed recorded action: off for create/shutdown, running for poweron.
  A recovered matching VM can establish observed compute state without claiming
  the missing acknowledgement or action receipt was recovered. Delete requires
  exact-ID absence and any recorded action terminal success. API absence is not
  physical erasure or proof that Volumes, IPs, snapshots or backups stopped billing.

Each request has an AbortSignal/deadline of at most 10 seconds and a 256 KiB JSON
response bound; optional shorter timeouts support focused checks. Calls are finite:
no internal polling/retry/sleep loop; reconciliation is one bounded observation
pass. Admission/store ports are trusted to bound their own latency. A transport
ignoring abort cannot be made safe by a JavaScript timeout; uncertain outcomes
must be reconciled under the same reservation. Known 4xx errors do not trigger
automatic provider retries. Rate-limit, resource/protection/permission and fixed
adapter errors are redacted; provider-supplied messages/details never escape.

Outputs contain `{receipt,persistence:"confirmed",resourceExists,ready:false,
readiness:"unproven"}` only after journal acknowledgement. Confirmed persistence
means the journal owns this receipt; it does not mean config was applied. A powered
VM is not a serving Gateway, schema/config/provider/channel readiness or isolation
proof. This port does not change the portable workspace or grant dispatch/chat.
The upstream API offers no label/ETag conditional mutation used here: GET/check
then mutation has a race. A dedicated project and sole trusted lifecycle writer
are required; hostile provider administrators are outside this source's boundary.

## Primary contracts inspected

Current [official API reference](https://docs.hetzner.cloud/reference/cloud) documents
safe integer IDs, actions running/success/error, label selectors, pagination and
typed HTTP errors; it does not provide an idempotency-key guarantee used here.
The official SDK at immutable commit
[`9adc140755042b41d7a1d865d8c1afe94535b5d6`](https://github.com/hetznercloud/hcloud-go/tree/9adc140755042b41d7a1d865d8c1afe94535b5d6)
confirms [server request/response fields](https://github.com/hetznercloud/hcloud-go/blob/9adc140755042b41d7a1d865d8c1afe94535b5d6/hcloud/schema/server.go#L100),
[action resources](https://github.com/hetznercloud/hcloud-go/blob/9adc140755042b41d7a1d865d8c1afe94535b5d6/hcloud/schema/action.go#L6)
and [server lifecycle paths](https://github.com/hetznercloud/hcloud-go/blob/9adc140755042b41d7a1d865d8c1afe94535b5d6/hcloud/server.go#L351).
The current [Server wire schema](https://github.com/hetznercloud/hcloud-go/blob/9adc140755042b41d7a1d865d8c1afe94535b5d6/hcloud/schema/server.go#L6)
has top-level `location`; the adapter does not invent a `datacenter.location`
alias. The same SDK's [DELETE receipt fixture](https://github.com/hetznercloud/hcloud-go/blob/9adc140755042b41d7a1d865d8c1afe94535b5d6/hcloud/server_test.go#L1178)
and [power/shutdown fixtures](https://github.com/hetznercloud/hcloud-go/blob/9adc140755042b41d7a1d865d8c1afe94535b5d6/hcloud/server_test.go#L1341)
use default HTTP 200 with action objects. No real account response was observed.
[Project-token scope](https://docs.hetzner.com/cloud/api/getting-started/generating-api-token/)
does not create an organization-specific provider credential boundary.

## Focused verification

After root and independent peer source review, the approved focused command
`node --test --test-concurrency=1 --test-reporter=tap tests/unit/compute-provider.test.mjs`
ran once at **2026-10-31T19:54:37.897Z**, Node **v26.8.2**: **16/16 passed**, zero
fail/cancel/skip/todo, actual exit 0, no signal, timeout, interruption or output-cap
breach; 176 ms including controller work. The child environment contained only
`TZ=UTC`; the controller used a 30-second group deadline, TERM then KILL after
three seconds, stdout256KiB/stderr64KiB caps. TAP was 4,156 bytes, stderr zero;
all 16 unique names matched the fixed authored scope. TAP SHA-256:
`8499bd9f73f077638c4a6f63bed3bfb0b22dca9cb2f894ea4935f57cdfd34a6f`.

The following input SHA-256 values matched before and after execution:

| Input | SHA-256 |
| --- | --- |
| `runtime/compute-provider.mjs` | `8ff206c15421c2605f874ff70e194474de2b38d21775e631ccbbcfe480ee8c06` |
| `runtime/config-observation.mjs` | `af12dbd3b785803fdf009f0d19496589d1e042009ddece7ab34c2210c21bf432` |
| `tests/unit/compute-provider.test.mjs` | `70f9346b6ca6bb2cbefb038f3fdffbc8116579f8f4d6a796f9ed2fe0d578cc54` |

The cases use in-memory admission/journal and fake REST transport, including
200/201 power/shutdown acknowledgements, a rejected 202 and an abort-listener
deadline race. No network, provider, file fixture or credential was used. Syntax
and whitespace checks also passed. Live provider compatibility, paid activation,
artifacts, worker/journal binding and full managed acceptance remain unverified.
No account or paid resource request was made; existing source was not modified.
