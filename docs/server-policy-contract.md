# Server access and control-plane policy

31 October 2026. Original source implementation of the approved
[backend milestone](proposals/activation-plan.md), following the frozen
[identity/data policy](proposals/identity-data-activation.md). It is not a
deployed route, Auth/database adapter, migration or live-service activation.
`server/policy.mjs` exports `createServerPolicy(ports)`; missing bindings fail
closed. Only Node built-ins and the existing public `web/domain.mjs` API are used.

## Admission and capability ceiling

The caller's opaque request context goes only to the trusted identity port.
`identity.verify(context)` must perform the actual online identity check and
return exactly `{userId,email,emailConfirmed,handleHash,supabaseSessionId}`, or
null. These are trusted-port output, never accepted request-body authority.
Mutation admission additionally requires `identity.verifyMutation(context,
{handleHash}) === true`, meaning the future BFF verified Origin and session-bound
CSRF. No cookie, JWT, role, actor or “confirmed” request field substitutes for it.

Every method opens a store transaction, rereads the current application-session
row, matches all subject/handle/provider-session bindings and checks revocation,
real expiry and authentication time. Organization methods then read the active
organization and current membership inside that same transaction. Memberships
and JWT metadata are never cached as authorization. The trusted transaction
adapter must lock those records through its decision/commit. The source cannot
prove an injected port actually does this; no such live adapter is bound.

| Current role | Capabilities and operation kinds |
| --- | --- |
| Owner | Organization read, chat read/write ceiling, intent write, request/review/confirm/cancel all five kinds, membership write, credential consent, retirement ceiling. |
| Administrator | Organization read, chat read/write ceiling, intent write, configure/pause/resume workflow, credential consent; no provision/delete or membership grant. |
| Member | Organization read and chat read/write ceiling; no intent/lifecycle/membership mutation. |
| Viewer | Organization read and chat-read ceiling only. |
| Missing/revoked/unconfirmed/inactive | No admitted access. No worker/support bypass exists. |

There is no chat admission, ticket issuance, dispatch, connector, credential or
provider method. Every public workspace retains `adapter:"unbound"`,
`dispatchAllowed:false`, `chatAdmissionAllowed:false`, `ready:false` and
`readiness:"unproven"`. A capability ceiling does not enable a workload port.
Provision/delete mutations also require Owner and application-session
authentication no more than five minutes old. Authentication time must originate
in a real successful login/re-authentication, never token refresh or cookie use.
The external Supabase revocation/JWT-expiry limitation in the approved proposal
still applies; this code checks Business Claw-owned application sessions only.

## Lifecycle methods and exact review

`readWorkspace(context,{orgId})` returns the canonical portable workspace,
separate `serverRevision`, current role/capabilities, server-generated operation
previews and disabled execution facts. Foreign org/instance/operation ownership
returns 404; a stale revision/generation/hash returns 409.

All lifecycle mutation bodies contain `orgId,instanceId,expectedRevision,
expectedGeneration`. `expectedRevision` is the server organization row's CAS,
not the portable workspace revision. The server constructs the existing domain
guard from its own stored workspace. Request bodies cannot supply a workspace,
actor, portable confirmation, raw runtime configuration, resource ID or URL.

| Method | Additional exact body fields |
| --- | --- |
| `updateIntent` | `intent` (validated by the existing domain owner). |
| `requestOperation` | Stable `operationId`, `kind`. |
| `reviewOperation` | `operationId,planHash,decision` (`reviewed` or `rejected`). |
| `confirmOperation`, `cancelOperation` | `operationId,planHash`. |

`planHash` binds the canonical organization/instance/generation, operation ID,
kind, requester and immutable domain plan. It deliberately excludes the mutable
server row revision and review/confirmation fields. Request, review and confirm
therefore retain the exact same plan hash while each separate call checks the
current CAS. Review and confirmation are distinct explicit transitions; the same
authorized person may perform both. This is one-person confirmation, not
separation-of-duties proof. The immutable review audit records that plan hash.
An intent edit supersedes active domain plans; old confirmations cannot revive them.

Exact operation/terminal retries must still have current admission, role/kind,
fresh-auth where applicable, generation and current server CAS. After a lost
response, read the workspace and retry the same operation/decision/hash with its
current CAS. Identical domain results return `replayed:true` without another
revision/audit. A stale original CAS fails; conflicting operation-ID reuse fails.

Every changed mutation performs server row CAS, domain/member effects and one
minimal immutable audit in the same transaction. Audit metadata contains only
server-constructed IDs, kind/state, hashes, revisions and the private application
session fingerprint; no label, email, token, raw config or provider error is copied.
An audit/effect failure must roll back the whole transaction. This atomicity is
a required store-port guarantee, not distributed isolation proved by pure source.

## Bootstrap and membership

`bootstrap(context,{requestId,name})` binds a stable create request to the
confirmed principal and exact name. It generates the organization/instance IDs,
creates the first Owner and appends audit together. Exact retry recovers current
state only with current active membership; it never restores a revoked Owner.
No automatic organization membership follows ordinary authentication.

The membership owner exposes invitation creation/acceptance/revocation, validated
role changes, member revocation and recipient-accepted Owner transfer. Invites
cannot grant Owner; accepted-token replay cannot restore a revoked membership.
An existing active role cannot be replaced through invite acceptance. The last
active Owner cannot be revoked or demoted. Owner transfer requires the current
Owner's fresh application session, exact active recipient and recipient acceptance;
the two membership changes and audit are atomic. A requested role is data to
validate, never proof that its caller holds that role.

| Method | Exact body |
| --- | --- |
| `createInvite` | `{orgId,expectedRevision,inviteId,email,role}`; only administrator/member/viewer. |
| `acceptInvite` | `{inviteId,token}`; organization/role come from the stored invite, with store CAS under lock. |
| `revokeInvite` | `{orgId,expectedRevision,inviteId}`. |
| `changeMemberRole` | `{orgId,expectedRevision,userId,role}`; role cannot be Owner. |
| `revokeMember` | `{orgId,expectedRevision,userId}`. |
| `requestOwnerTransfer` | `{orgId,expectedRevision,transferId,toUserId}`. |
| `acceptOwnerTransfer` | `{orgId,expectedRevision,transferId}`; only the exact active recipient. |

Invite/transfer IDs are caller-stable UUIDs bound by stored server-computed
request hashes. Owner methods require current CAS before replay. Invitation
acceptance serializes against current stored state without a caller-org claim.
Unused invites expire in seven days; the current issuing Owner is checked again
at acceptance. A revoked member's new invite must strictly postdate revocation;
equal millisecond times are conservatively refused. Accepted-token replay returns
only the original acknowledgment, never workspace/capabilities or a membership
write. Reissuing a lost invite secret requires an explicit new invite/revocation;
same-ID retry returns an acknowledgment with no secret envelope.

Transfers expire at the issuing application's original authentication time plus
five minutes. Acceptance rereads that exact issuer session, provider-session ID,
authentication event and current Owner membership, then promotes the active
recipient and demotes the issuer to Administrator atomically. Loss of the issuer's
Owner role, issuer-session revocation/expiry or a new issuer authentication event
invalidates the pending transfer. Recipient revocation prevents acceptance.
Accepted transfer retry needs current recipient membership and does not repeat
the ownership writes or restore a later-demoted role.

Invitation plaintext belongs only in a separately returned private delivery
envelope for a future trusted delivery adapter. Store/audit contain only its
hash; public workspace/acknowledgment has no token. Delivery remains `unbound`.
No SMTP call, real invitation delivery or public signup readiness is claimed.

## Injected port contract and verification boundary

Required wiring is `identity:{verify,verifyMutation}`, `store:{transaction}`,
`clock:{now}` and `random:{uuid,bytes}`. Clock returns canonical ISO UTC with
milliseconds; UUIDs are lowercase UUID-shaped server IDs; `bytes(32)` returns
exactly 32 random bytes. No fallback credentials, storage or randomness is used.

The transaction object provides locked `readSession(handleHash)`,
`readOrganization(orgId)`, `readMembership(orgId,userId)`, bootstrap lookup,
organization CAS/insert, membership/invite/transfer reads and writes, and
append-only audit. All returns are detached data; writes return true on success.
`writeOrganization({orgId,expectedRevision,next})` must enforce atomic CAS.
`findBootstrap(userId,requestId)` and first insertion must serialize their unique
key. No partial transaction can escape if a callback throws. The adapter must
invoke and await the callback exactly once; the policy rejects missing/duplicate
invocation and uses only its own callback outcome, not a fabricated transaction
return value. The source store
DTOs are adapter records, not executed SQL or a claim that the proposed DDL has
already been migrated; concrete adapter/DDL mapping remains a later review.

DTOs reject unknown/inherited/hidden/symbol/accessor fields and malformed IDs,
revisions and times. Portable intent/workspace validation is reused, not forked.
Returned data/audit is detached and deeply frozen; errors use fixed public codes.
`tests/server-policy.test.mjs` is authored against independent fake ports.
Its execution waits for source/API freeze, root review and a bounded controller
under the owner's current approval. No test or product module was imported or
executed while authoring this source. Real Auth/DB concurrency, email, external
revocation, browser behavior, two-org isolation and hosting remain unverified.
