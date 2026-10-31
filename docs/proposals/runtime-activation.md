# Hetzner runtime activation packet — inactive

31 October 2026 (Europe/Rome). **Proposal only; spend and activation authority: none.**
This refines the [managed architecture](managed-service-architecture.md), not its full product scope.
Application source `1b5dcc8b155012b1c9d1abaa327bfe5ecaeac477` and its 21 sealed inputs stay unchanged;
the pending 14-domain/4-browser scopes do not approve infrastructure, installation or live acceptance.

## Decision and minimum topology

Propose Hetzner Cloud `nbg1` (Nuremberg, Germany), x86 Linux, one VM per customer organization.
Railway, GCP and macOS are not automatic failovers. Account capacity, artifacts and approval remain gates.

| Proposed resource | One-org canary | Two-org acceptance | Boundary |
| --- | --- | --- | --- |
| CX23 management VM | 1 | 1 | Private lifecycle worker and long-lived WebSocket broker; separate OS users/processes. No customer agent runs here. |
| CX23 Gateway VM | 1 | 2 | One org/instance/generation per VM, unprivileged Gateway, bounded agent sandbox, no hosting or platform-store credential. |
| Encrypted 20 GB data Volume | 2 | 3 | One per VM; each org's complete state/workspace stays on its own filesystem. Management disk contains operational state, not a second membership authority. |
| Private Network | 1 | 2 | Separate Network per org, joined only by its runtime and management VM. No sibling route, forwarding or shared customer subnet. |
| Primary IPv4 + IPv6 | 2 | 3 | Public HTTPS only on broker; runtime public ingress denied, public addresses provide outbound IPv4 compatibility. IPv6 must receive the same restrictions. |
| Cloud/host firewalls | 2 | 3 | Public network filter plus host filtering of private interfaces; Gateway listens on loopback behind per-org mTLS ingress. |
| Private encrypted backup store | 1 account base, scoped objects | same | Controller uploads per-org encrypted archives to a private `hel1` bucket; runtime has no project-wide S3 key. Separate per-org keys and restore manifest. |

CX23 is 2 shared x86 vCPU, 4 GB RAM, 40 GB root NVMe; guest sizing remains unqualified.
Upstream baseline guidance recommends 1–2 vCPU/2 GB+; that is not sandbox/load proof.
[Gateway sizing guidance](https://docs.openclaw.ai/help/faq-first-run/providers-and-hosting).
Canary concurrency is one agent task per org; browser automation, embeddings and heavy builds stay disabled.
Stop on resource failure; no automatic resize/spend. CPX22 (2 shared vCPU, 4 GB/80 GB)
is a later quoted alternative; no evidence yet justifies its premium. Cost-optimized capacity is limited.
Public unauthenticated pages show unavailable labels; this does **not** prove account/global capacity.
Record the account's actual `nbg1` offer/quota before allocation; no silent size/region/architecture substitution.
[CPX facts](https://www.hetzner.com/cloud/regular-performance/),
[CX facts](https://www.hetzner.com/cloud/cost-optimized/).

The proposed Vercel BFF owns HTTP identity/admission with the proposed Supabase membership/operation store.
The broker verifies BFF-issued short-lived principal/org/instance/generation/scope-bound admission,
resolves endpoints server-side, and accepts no caller-supplied Gateway URL/token or duplicate membership policy.
Durable store, job fencing, revocation and secret bindings must precede worker connection; no free DB is assumed.

The worker alone holds the dedicated project's hosting credential and consumes reviewed, fenced operations.
Record provider IDs/actions before progress; reconcile uncertain creation rather than retry allocation blindly.
Broker processes/org VMs cannot read that credential. Guest Volume encryption needs separately approved
key delivery outside customer agent identities. Platform administrators/provider remain trusted infrastructure operators.
No secret enters image/cloud-init/log/export. Sandbox backend and tool access require qualification;
do not mount the host Docker socket into customer agent work or enable unsandboxed execution by default.

## Runtime artifact gate

Official GitHub `latest` resolved to [v2026.10.9](https://github.com/openclaw/openclaw/releases/tag/v2026.10.9)
(29 October); its signed tag/verified source commit does not qualify an OCI image.
The official registry is `ghcr.io/openclaw/openclaw`; Docker Hub is its mirror.
Version/dated tags are documented as immutable, whereas `latest/main` move.
[Docker source](https://docs.openclaw.ai/install/docker), [tag semantics](https://docs.openclaw.ai/install/docker/compose-operations).
Activation needs a Linux/amd64 manifest digest, release mapping, signature/attestation and dependency/license
review (record missing upstream attestations), OS/sandbox image identities, schema/transport compatibility
and backup/restore qualification. Those artifact identities/evidence were not retrieved or qualified here.
The old `8034bb1` architecture source pin is not that artifact; recheck its contracts against the release.
Use a prebuilt non-browser image: the documented 6 GB source-build prerequisite is not a Gateway RAM floor.

## Verified provider constraints and API surface

- Networks are private but not automatically encrypted; subnets within one
  Network are not isolation boundaries. A server has at most three Networks,
  so the proposed shared broker is deliberately bounded to these two orgs.
  Private ingress therefore uses mTLS and no cross-Network forwarding.
  [Network FAQ](https://docs.hetzner.com/networking/networks/faq/).
- Cloud Firewalls do not filter private Network traffic; existing established
  connections survive a rule change. Host policy and broker stream termination
  must enforce revocation. Metadata is not protected by the Cloud Firewall;
  sandbox egress must separately exclude management/metadata destinations.
  [Firewall FAQ](https://docs.hetzner.com/cloud/firewalls/faq/).
- Volumes attach to one VM, grow but do not shrink, and are excluded from server
  Backups/Snapshots. Triple replication is not a backup. Require quiesced/native
  application backup, encryption and an actual restore, not just an S3 upload.
  [Volume contract](https://docs.hetzner.com/cloud/volumes/overview/),
  [backup consistency](https://docs.hetzner.com/cloud/servers/backups-snapshots/faq/).
- The REST API provides server create/read/delete, power actions, image creation,
  backup enablement, Volume attach/detach/delete, Networks, Firewalls and Primary
  IP ownership. Changes can return asynchronous actions: poll the resource's
  action and reconcile the resource, then verify the serving Gateway separately.
  `GET /pricing` includes account currency/VAT and net/gross resource prices;
  schema examples containing `1.0000` are not quotes.
  [Official API reference](https://docs.hetzner.cloud/reference/cloud).
- API tokens are project-bound Read or Read & Write, not per-org grants. Use a
  dedicated Business Claw project, bounded worker capabilities and stored-ID plus
  label checks before mutation/deletion; labels alone confer no authority.
  [Token permissions](https://docs.hetzner.com/cloud/api/getting-started/generating-api-token/).

## Price formula, ceiling and ownership packet

All following list figures were read on **31 October 2026**, in EUR excluding VAT
and IPv4, for new Germany/Finland orders: CX23 **€0.0088/hour, €5.49/month**;
CPX22 **€0.0312/hour, €19.49/month**. [Official effective-15-June table](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/).
Primary IPv4 is **€0.50/month**, IPv6 free. [Server/IP overview](https://docs.hetzner.com/cloud/servers/overview/).
Server Backups add **20%** with seven rotating slots; stopped VMs and unattached
IPv4s continue billing until deleted. Hourly server usage rounds up, capped per
month. [Billing rules](https://docs.hetzner.com/cloud/billing/faq/).

For `N` orgs plus one controller, monthly net hosting is `(N+1) × (5.49 × 1.20 + 0.50 + 20 × V) + B + E + R`.
`V` = approved nbg1 Volume €/GB-month; `B` = incremental account Object Storage base;
`E` = storage/egress overages; `R` = restore resources. Known compute/backup/IP subtotals:
**€14.18** (N=1), **€21.26** (N=2), before those variables, tax and rounding.
For seven days use rounded hours and `min(hourly × hours, monthly cap)` per applicable resource,
plus backup/storage/IP/egress; do not blindly prorate the monthly subtotal or assume account credits.
Rendered primary pages did not expose numeric `V/B`; obtain actual quotes, not third-party substitutes.
Object Storage charges a base while any bucket exists, accrues storage/egress quotas and bills overages;
key pairs cover all project buckets by default.
[Storage billing/security](https://docs.hetzner.com/storage/object-storage/overview/).

Proposed ceilings: one org **€15 net total/seven days**, **€30 net monthly run-rate**;
two orgs **€20 net/seven days**, **€40 net monthly run-rate**. No spend or provider-enforced bill cap exists.
These ceilings remain unapproved. Activation requires separate approval of the complete quote within both;
otherwise return a revised packet. Maximum three persistent
VMs/Volumes/IPs, two org Networks, ≤10 GB encrypted backups; one additional restore VM/20 GB Volume/IP ≤4 hours.
Warn at 50 GB egress; at 100 GB/runtime close admission and stop agent/connector work, not just UI requests.
Keep a retirement deadline because off still bills; these controls are not a provider-enforced financial cap.
Model, DNS registration, email, Auth/DB, channels and other vendor costs are excluded and unapproved.
Require the actual billing account's net and gross quote, currency and applied tax before approval;
no account jurisdiction or tax treatment is inferred. [Vendor tax source](https://docs.hetzner.com/general/billing-and-account-management/billing-at-hetzner/value-added-tax/).

## Activation phases and retirement owner

1. **No-cost preparation:** approve account/legal billing owner and dedicated
   project, full quote/capacity, runtime artifact, dependency/install scope and
   separate identity/data policy. Proposed names are `claw.alvarovillalba.com`
   and `api.claw.alvarovillalba.com`; verified parent-domain availability is not
   DNS/TLS/production-change authorization. Store no credentials in this packet.
2. **One-org canary, separately approved:** bind private worker/broker and actual
   serving version; distinguish created, persisted, applied and ready. Exercise
   failed creation/lost acknowledgment, pause/resume and encrypted restore using
   authored data. Provider/model/Notion calls stay disabled without their budgets
   and consent; absence of those flows means full product acceptance is still open.
   Proposed retention is seven daily app-consistent encrypted archives per org,
   within the shared 10 GB cap; demonstrate restore before claiming any recovery objective.
3. **Two-org acceptance, separately approved:** adversarial owner/session/resource
   substitution, private reachability, secrets/backups/streams isolation and
   revocation; then upgrade/restore and exact deletion. A named execution plan
   must define actual cases, timeouts and provider/model limits before running.
4. **Rollback/deletion:** Alvaro is the billing/retention decision owner; the sole
   deployment worker executes only the approved manifest. Close admission, revoke
   org grants, drain/stop work, restore to a new fenced generation, verify before
   routing, and prevent duplicate active channel identities. On retirement delete
   exact owned VMs, detached Volumes, IPs, images and backup objects/versions/keys
   under explicit retention consent; poll receipts and reconcile remaining costs.
   Server deletion also removes bound Backups, while Snapshots survive; API
   acknowledgments are not proof of physical erasure. Do not delete the shared
   controller/store until every retained org's ownership is resolved.

Only this inactive proposal is authored here. No account, resource, permission,
DNS record, dependency, runtime, test or live adapter was created or executed.
Next source can define unbound compute/backup/transport ports and pure receipt
reconciliation over exact owned IDs. This source-only step does not activate Hetzner,
and no portable v1 review becomes a live grant.
