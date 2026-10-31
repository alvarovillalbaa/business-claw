# Free capacity decision for Business Claw

31 October 2026. **Proposed operational change; not executed.** The approved
backend-policy source/check milestone is delivered separately. This packet asks
for the new availability tradeoff needed to provision a dedicated free database.

## Proposed action and cost

Pause only Dearweek's currently unused Supabase backend
`faftywddybmgamvseibe`, then create **Business Claw** in **Clous**
(`jnmtatndgpzawemtiukl`), region **eu-central-1 / Frankfurt**. The connected
Supabase provisioning quote is **$0/month**. Accept only that free quote; no
paid plan, upgrade, account, substitute region or additional project is authorized.

Still `wosqlzijmyiemueoittw` and its shared Kickoff service remain on their
existing project. No source data is moved, no project is deleted, and no
existing Auth setting, key, schema, environment variable or DNS record changes.
Creating the dedicated project does not itself activate the app's identity,
store, email, API or runtime adapters.

**Availability consequence:** Dearweek's database/Auth/cloud-photo features
will be offline while paused. Its published source is preserved. Once Still
and Business Claw occupy both free slots, restoring Dearweek requires freeing
capacity again; it cannot also remain active on this same two-project allowance.
This is the material owner decision, not another test approval.

## Read-only evidence

- The connected project listing reports Still and Dearweek active, three other
  projects inactive, and no Business Claw project. The free organization has
  no spare active-project slot.
- Actual SELECT counts at Dearweek report **zero Auth users, zero Storage
  objects and zero rows in all twelve application tables**: nine public family
  tables plus the three private invitation/deletion tables. This is a snapshot;
  repeat the checks immediately before any pause and stop if they are nonzero.
  No identities, password hashes, photo bytes or customer records were exported.
- A simple merge into Still is unsafe. Dearweek's existing account-delete code
  calls project-wide Auth deletion. Still's user references cascade into its
  documents/tokens; Kickoff's user/history references can restrict deletion.
  Dearweek also uses generic private-schema helpers and broad private-schema
  revokes that need namespacing before a shared-project migration. A safe
  consolidation needs a separate app-scoped deletion and migration change.

Source references: [Dearweek deletion](https://github.com/alvarovillalbaa/dearweek/blob/100a316bcb6576f83099b880235d93949a75a5df/supabase/functions/_shared/deletion.ts#L119),
[Still user references](https://github.com/alvarovillalbaa/still-markdown/blob/f5ba8e31b91c00c9bfcfa3506407f67b1559aaf5/supabase/schema.sql#L8),
[Kickoff consolidation guards](https://github.com/alvarovillalbaa/kickoff/blob/a5e4d8dc710cc3f5fa9ab24276b3d527ccf4a7b4/supabase/migrations/20261026183151_consolidate_kickoff_free_project.sql#L11).
Repository URLs identify inspected source; they do not prove live schema state.

## Bounded execution after the owner's decision

1. Re-read project/org/quote state and all twelve source-table/Auth/Storage
   counts. Require the exact unused Dearweek target and $0/month quote. If any
   count is nonzero or resource identity differs, stop and return a revised plan.
2. Pause only the named Dearweek project; poll that exact project's status and
   reconcile uncertain responses before any retry. Never pause Still or delete
   a project to make capacity.
3. Verify a free slot, then create exactly one Business Claw project in the
   selected organization/region. If the server requires a $0 confirmation ID,
   obtain it under this explicit cost approval; do not confirm a nonzero cost.
   An uncertain create response requires listing/readback before any retry.
4. Record the actual new project ID and poll it to healthy status. Do not
   claim Auth, schema, mail, tenant isolation or serving readiness from that status.
5. If provisioning fails, restore Dearweek when capacity permits. If a newly
   created, unbound Business Claw project occupies the slot, pause only that
   exact new resource before restoration. This compensating pause/restore is
   part of this packet; no deletion or customer-data migration is included.

## Retention and acceptance limits

Current direct Supabase docs describe a **one-year** one-click restore window;
older indexed content still says 90 days. Do not promise indefinite retention or
a spare free rollback slot. Restore can include a Postgres upgrade. The project
is retained, not deleted, but eventual restoration remains subject to platform
state/capacity. [Project pausing](https://supabase.com/docs/guides/platform/free-project-pausing),
[upgrade/restore behavior](https://supabase.com/docs/guides/platform/upgrading),
[free-project allowance](https://supabase.com/docs/guides/platform/billing-faq).

If the owner keeps Dearweek online, this pause/create path stays unexecuted.
The alternative is to prepare and approve the larger shared-Auth/app-deletion
consolidation; an environment-only swap is not a safe substitute. The full
Business Claw service and all-project objective remain unfinished in either case.
