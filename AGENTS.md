# Business Claw

- Own the managed Business Claw product: simpler OpenClaw setup and dashboard,
  with a separate isolated runtime boundary for each customer organization.
  The retained Notion brief and the owner's delegated product choice are in
  docs/spec.md. Do not redefine completion as a local config generator or demo.
- web/domain.mjs owns strict portable organization/instance/operation data and
  pure lifecycle transitions. The browser uses that contract without forking
  field names, validation, revisions or ownership checks. Keep it dependency-free.
- server/policy.mjs owns access/lifecycle decisions; access.mjs, membership.mjs
  and data.mjs share strict DTOs. postgres-store.mjs and db/schema.sql own the
  private transaction adapter; auth.mjs/http.mjs/api/v1.mjs own Auth and HTTP.
  Current principal/session/membership checks remain server-owned. The API fails
  closed while actual production connection/secret/Auth delivery bindings are
  unavailable. The older identity proposal's SQL is superseded source, not a
  migration to replay; use the tested schema owner and its activation receipt.
- Domain review/confirmation records are workflow data, not authentication or a
  grant of execution authority. Provider commands remain data until an approved
  server-side adapter authenticates, authorizes and binds the actual target.
- runtime/compute-provider.mjs owns the bounded provider protocol; artifact-admission.mjs
  qualifies exact metadata only through a trusted verifier. server/runtime-ledger.mjs
  owns worker reservations/CAS/history. None supplies a live authorizer, worker
  credential, paid manifest, provider token or running Gateway. Do not bind
  portable confirmations directly to these ports. Runtime tests use T2 mocks
  under tests/unit/ and T3 disposable Postgres under tests/integration/.
- The initial public preview is browser-local and uses authored/imported records.
  State clearly that no hosted runtime is connected. Never report a successful
  provision, chat, connector, model call or actual readiness from a local draft.
- User labels use textContent. Do not execute imported HTML, scripts, shell text
  or arbitrary URLs. Import/export contains bounded schema-validated data, never
  credentials. Local saving is explicit and requires a matching readback.
- The portfolio goal authorizes this original source and initial personal GitHub
  publication/static Vercel preview. It does not approve new Auth/access policy,
  live provider/account/DB/secret/infra bindings, installations or paid resources.
- Follow supplied AGENTS.md sections 7/14: newly authored Business Claw tests,
  browser checks, dependencies and CI need their own exact execution approval.
  Clero's 72-check approval does not authorize Business Claw execution.
- The owner's 31 October "I approve everything" clears the prepared 14-domain,
  18-runtime and four-browser scopes plus focused local fake-port verification
  of the approved backend-policy source. Exact source seals/receipts own those
  identities and limits; this is not authority for future external/paid bindings.
- The owner's later "Means 'Keep going'. Do all the work" approves the named
  free-capacity packet and necessary Auth/store/API/dashboard implementation,
  pinned pg dependency, focused checks and temporary public CI (20-minute cap).
  Dearweek may be paused only after the packet's empty-data recheck. Use the
  dedicated Business Claw project; do not spend money or activate customer
  runtime resources. Never bypass provider permissions or claim mail delivery
  or a working database connection before actual qualification.
- That same current all-work instruction also cleared the bounded compute,
  artifact and durable-journal source, 51 focused checks, temporary public CI,
  anonymous metadata-only registry probe and additive private journal DDL.
  Their actual immutable outcomes are in docs/results/2026/10-31/. No paid
  resource, provider account, trusted signer or live runtime is thereby bound.
- Do not run local builds/installs under a failed Storage Guard preflight. Syntax,
  static imports, JSON/link/HTML references and whitespace inspection are safe.
- Persist source, publication, checks and limits in docs/results/. Mark adapters
  and policies proposed until actually approved/bound. A successful static build
  does not prove hosted managed-service, organization isolation or full delivery.
