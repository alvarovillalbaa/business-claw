# Next backend source milestone

31 October 2026. **Inactive proposal; no live activation or spend is approved.**

The selected product is a managed service with one isolated Gateway boundary per
customer organization. The published preview at
[business-claw-alvaro.vercel.app](https://business-claw-alvaro.vercel.app) remains
browser-local. Source `1b5dcc8b155012b1c9d1abaa327bfe5ecaeac477` and its 21 sealed
inputs remain unchanged while its 14-domain/four-browser approval is pending.

## Smallest ready implementation

The next approval concerns **backend access-policy source only**, as specified
in [the identity/data proposal](identity-data-activation.md). It would add:

- A server-owned access module for confirmed principals, current application
  sessions and current Owner/Administrator/Member/Viewer memberships. Request
  JSON, portable records and cached JWT role claims cannot supply authority.
- A control-plane service over the existing domain owner: bind IDs beneath the
  admitted organization, enforce role/kind/fresh-auth rules, and perform revision
  checks, replay handling and audit writes through one transaction port.
- Bootstrap, invitation and membership decision rules, including exact recipient
  binding, issuer rechecks and last-Owner protection. A requested role change is
  data to validate; it is never proof that the caller holds that role.
- Explicit injected identity, transaction, clock and randomness ports. Missing
  live bindings deny access and execution. Portable confirmations cannot dispatch
  a job or admit a chat stream.
- Authored checks and owner documentation, left unrun until their exact new
  execution scope is approved. Existing preview checks do not cover this code.

This source step uses existing Node built-ins and the current domain module.
It does not add dependencies, a lockfile, CI, a deployed API route, an Auth
configuration, a migration or a provider adapter. Candidate future driver pins
are `@supabase/supabase-js@2.118.0`, `pg@8.23.1` and `ws@8.22.0`; they were read
from the registry, not installed, qualified together or approved for use.
Their installation and lock generation require a separate concrete scope.

Source review must retain the provider-session revocation limits described in
the identity proposal. A planned application-session check or broker lease is
not proof of external Supabase-session invalidation. New modules must not be
wired into production while their adapters and acceptance remain unbound.

## Live activation prerequisites

| Area | Current evidence | Required before activation |
| --- | --- | --- |
| Identity/data | Connected metadata reports Clous Free, two active projects, three inactive, no Business Claw project. The two-active-free-project allowance is occupied. | An explicitly approved capacity decision, dedicated project/region, actual login role/pool limits, reviewed migration, secret-store binding and Auth acceptance. No other app is paused, reused or upgraded by this proposal. |
| Email | Provider and sender ownership are unknown; Supabase's default sender does not provide public recipient delivery. | Approved SMTP/provider/sender DNS and real confirmation/recovery/invitation delivery. A contact form does not replace these messages. |
| Domain | Vercel owns `alvarovillalba.com`; nameservers are Vercel's. Six explicit records were returned with no next page and no `claw`, `api.claw` or `*.claw` entries. | Later exact DNS/project-domain/TLS/Auth-URL approval. Existing wildcard or inherited routing is not a bound Business Claw hostname. |
| Runtime | [The Hetzner proposal](runtime-activation.md) selects CX23/nbg1, separate customer VMs and a bounded canary. | Account/project ownership, full account net/gross quote, capacity, immutable runtime/sandbox artifacts and a separately approved resource manifest. Proposed ceilings are not spending authority. |
| Verification | Static source/publication proof exists. Fourteen domain cases and four preview browser scenarios are pending. | Their actual approval and execution; then separately frozen backend/Auth/two-org/runtime acceptance scopes. |

The Vercel integration-configuration read returned **403 forbidden**. Installed
database/email integrations remain unknown; no alternate surface was used to
evade that permission. No free DB slot, email integration, VM account, paid
plan or live service is inferred from the existing Vercel project.

## Approval and evidence boundaries

Supplied AGENTS.md section 14 requires approval for the proposed access policy.
The next question is limited to implementing that policy in inactive backend
source; the SQL and operational policies in the linked proposals stay proposals.
Section 7 still gates new backend/browser execution, and section 14 still gates
dependency, CI, live Auth/DB/DNS/infra and paid changes.

Keep the published source pin intact while its pending check question is open.
If later source is published, preserve the original pin and explicitly resolve
which immutable source any approved execution covers; never silently substitute
a different head. These local proposal files are not GitHub publication, deployed
backend behavior or completion of the managed service.

Current primary references: [Supabase free-project allowance](https://supabase.com/docs/guides/platform/billing-faq),
[SMTP contract](https://supabase.com/docs/guides/auth/auth-smtp), and the primary
Auth/runtime sources linked in the two detailed proposals. Account facts above
come from connected read-only metadata inspected on 31 October, not those public
documentation pages.
