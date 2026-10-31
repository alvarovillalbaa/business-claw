# Approved preview browser checks — partial result

31 October 2026, 18:18 UTC. **One scenario is PARTIAL; three remain UNRUN.**
The owner's “I approve everything” covers the existing
[four-scenario proposal](../../../proposals/browser-checks.md). That approval
remains valid. Only disposable authored records were used.

## Connection chronology

| Attempt | Observed result |
| --- | --- |
| 17:08 UTC, initial selection | `Browser is not available: chrome`; discovery `[]`. |
| 17:17 UTC, owner reported connected | Same selector error and empty discovery; no automatic recovery loop. |
| 17:19 UTC, prescribed diagnostics | Chrome installed/running, extension registered/enabled, native-host manifest correct; all four checks exited zero. |
| 17:22 UTC, approved recovery | One official `about:blank` window opened; after two seconds, one setup/selection retry returned the same error. |
| After owner-reported reinstall | Chrome connected; complete browser guidance was read, including the tool-truncated accessibility subsection. One canonical-preview task tab opened. |
| During cancellation | CDP click timed out; `getJsDialog()` then timed out and the tool automatically reset its kernel. |

The session name was “🔎 Business Claw preview checks.” Accessibility inspection
reported a missing packaged `browser-accessibility.wasm.br`; the same Chrome
tab's supported Playwright DOM/locator surface worked. No page evaluation, raw
storage access, profile/session-store access or alternate automation was used.

## Actual UI evidence

At 1440 × 1000, Workspace data reported **“No saved device copy.”** Then:

- Created `BC Browser Fixture 2026-10-31`.
- Changed purpose to `Équipe 🌊 · authored decisions`, selected organization-owned
  provider intent, requested Notion, and turned memory/self-building off.
  Reselected the sole supported `web-chat` channel. Saved setup reached revision 2.
- Prepared a provision proposal and inspected its exact organization, instance,
  generation and plan.
- Recorded local review and separate confirmation. The immutable reviewed plan
  matched the requested plan. The confirmed command showed `proposal-only`,
  `adapter: unbound`, and `executionAuthority: not-granted`.

| Approved scenario | Result |
| --- | --- |
| Setup and reviewed proposal | PARTIAL — verified through confirmation; cancellation unverified. |
| Stale intent and narrow navigation | UNRUN. |
| Import/export and rejection | UNRUN. |
| Explicit device retention | UNRUN; initial saved-copy status only. |

The cancellation click error was `Timed out after 2967ms waiting for CDP command
Input.dispatchMouseEvent`. No complete scenario pass or product failure is
established.

## Control interruption and cleanup

Fresh setup could not find the removed `chrome/26.1007.30912/scripts/browser-client.mjs`.
The owner verified the updated official Chrome package `26.1013.40934`; its
current troubleshooting guides were read. One setup attempt with that client
failed because the trusted worker still imported the removed
`browser/26.1007.30912/scripts/browser-service.mjs`. Recovery stopped. No extra
window, agent-requested reset, install, configuration repair or further retry occurred.

One unsaved fixture tab and its cancellation confirmation may remain open; its
tab ID was not captured before the reset. Fixture IDs are in the JSON receipt.
The desktop viewport override could not be explicitly reset. The earlier blank
recovery window may also remain. **No device copy, upload, import or download
was created.** No screenshot was captured. No alternate cleanup was attempted.

The public canonical preview was accessible. The task owner's fresh Vercel
readback binds `business-claw-alvaro.vercel.app` to READY production
`dpl_zyFoB714iqqj9UyuJpqA8DsETC4j`, source
`4342fd7813c737d91849516303feb099150f4181`. Its unchanged five-file web source
matches original approved preview `1b5dcc8b155012b1c9d1abaa327bfe5ecaeac477`;
the earlier local Git identity inspection is retained in
[the JSON receipt](browser-checks.json). This is provider metadata plus visible
public UI, not a browser-fetched byte comparison or live-service acceptance.
