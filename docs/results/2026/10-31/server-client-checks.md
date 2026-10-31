# Server client checks — 31 October 2026

The focused Node run passed all **12 cases** with zero failures, cancellations, skips or TODOs. It used an injected authored fetch transport: no browser, network, server, database, provider or real account.

Command: `node --test --test-concurrency=1 --test-reporter=tap --test-timeout=2000 tests/server-client.test.mjs` on Node v26.8.2. Exit 0; 0.241s. The controller capped the run at 20 seconds, stdout at 256 KiB and stderr at 64 KiB. All six owned source/doc/test inputs retained identical pre/post hashes and modes; [the JSON receipt](server-client-checks.json) records their identities and all case names.

Coverage includes same-origin credentials, in-memory CSRF rotation and stale-response fencing, required session refresh, explicit retry identities, finite timeout/cancellation, refused targets/actions, strict response decoding and byte limits, and fixed error redaction.

Syntax and static HTML/import/reference checks also passed. Browser layout, actual Auth/email delivery, live PostgreSQL, hosted bindings and customer runtime execution remain unverified by this scope. An earlier invocation's output was unavailable after tool-output truncation and is not used as pass evidence.
