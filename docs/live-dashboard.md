# Server workspace and local preview

The dashboard has two separate data paths. **Server workspace** uses the
[same-origin BFF contract](backend-http-contract.md) for accounts, current
organization memberships and acknowledged records. The existing **Local
preview** retains its explicit device save, file import/export and pure domain
workflow. Opening or importing a local workspace never creates a server
organization, grants membership or uploads that record.

`web/server-client.mjs` sends only fixed `/api/v1` requests with same-origin
credentials. CSRF comes from the session JSON response and remains in memory.
Login, logout and recovery-password completion refresh the session response.
Passwords are cleared from their form before awaiting the response; no provider
token, credential, CSRF value or server workspace is written to browser storage.
Callbacks and their PKCE/state checks belong to the BFF, not browser code.

The account screen handles sign-in, neutral signup/recovery requests, sign-out
and the authenticated `#server-recovery` password form. Email delivery can be
unavailable. Missing hosting/database bindings show a plain setup-pending
message while leaving the local preview usable. An account session alone does
not imply organization membership or a running assistant.

Organization creation uses a stable request UUID. Intent and lifecycle bodies
use the current server revision, instance generation and server-issued plan
hash; no caller role or actor field is sent. Role-based controls are a UI
ceiling only. The server rechecks current identity, membership, freshness,
ownership and compare-and-swap before changing a record.

Read responses are fenced by account/organization context and request sequence.
Refreshing an organization retains its unsent intent form. Changing account or
explicitly discarding a form clears its scoped draft. Server and local review
dialogs have separate targets; a local confirmation never reaches a server
operation endpoint.

There is no automatic mutation retry. A timeout, lost response or unsupported
success payload leaves the request visibly unconfirmed and blocks new writes.
The explicit retry retains the same payload and IDs. Checking reads current
server records; a matching recorded decision can recover the acknowledgment.
An advanced server revision is displayed for fresh review without claiming the
earlier write succeeded. Bootstrap uncertainty requires the exact same-request
retry because an organization name is not a unique request identity. Leaving
the page or aborting a client read does not undo a server write.

Runtime execution, chat, Notion and memory adapters remain unbound. A recorded
server review/confirmation or successful account request is not runtime
readiness. Source/static checks and fake transports cannot establish deployed
Auth, actual email delivery, database isolation or browser acceptance. The known
browser-plugin worker failure was not retried during this implementation.
