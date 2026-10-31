# Approved preview browser checks — connection unavailable

31 October 2026, updated 17:22 UTC. **All four scenarios remain UNRUN.** The owner's
“I approve everything” covers the existing [four-scenario proposal](../../../proposals/browser-checks.md).
Approval is retained; this connection failure does not require a repeated request.

The approved surface is the currently connected Chrome browser, with at most
two task tabs and disposable authored local records/files. The
`chrome:control-chrome` skill was read before the initial 17:08 UTC attempt.
Setup completed,
but the supported `agent.browsers.get("chrome")` selection returned exactly:

```text
Browser is not available: chrome
```

The skill's required bootstrap guidance was read. Its single read-only
`agent.browsers.list()` diagnostic returned `[]`. Browser work stopped there.
No alternate automation, direct profile/session-store access, installation, recovery window,
configuration change or automatic retry occurred.

At 17:17 UTC, the owner replied “Chrome is connected.” One new selection was
then attempted using the same `agent` and browser runtime, without resetting or
reinstalling it. `agent.browsers.get("chrome")` again returned exactly
`Browser is not available: chrome`. The single read-only discovery diagnostic
again returned `[]`. This owner-triggered retry stopped before navigation;
there was no recovery loop or alternate control surface.

The Chrome-specific troubleshooting guidance was then read. All four prescribed
read-only diagnostics exited zero: Chrome is installed and running, the selected
extension is registered/enabled, and the Chrome native-host manifest is correct.
These checks establish the reported installation state; they do not establish
a working transport or identify why discovery remains empty. No raw profile
paths or session data are retained in this receipt.

The documented next step when all checks pass requires permission to open an
`about:blank` window in the extension-selected profile, then wait two seconds
and retry setup once. If that still fails, the guide directs the user to
reinstall the Browser plugin through the ChatGPT plugin UI. It documents no
separate client reconnect/transport-refresh API. No window, setup retry, reset,
installation or native-host repair was performed during these diagnostics.

The owner then authorized the documented minimal recovery step under the current
approval. At 17:22 UTC, `scripts/open-chrome-window.js --browser chrome` exited
zero with `status: opened`, requesting one `about:blank` window in the existing
extension-selected profile. After a two-second wait, one browser-runtime setup
and Chrome selection retry again returned `Browser is not available: chrome`.
No reset, runtime reimport, installation, configuration change, alternate
automation or further retry occurred. The guide's next action is for the user
to reinstall the Browser plugin through the ChatGPT plugin UI.

| Approved scenario | Result |
| --- | --- |
| Setup and reviewed proposal | UNRUN — no connected Chrome |
| Stale intent and narrow navigation | UNRUN — no connected Chrome |
| Import/export and rejection | UNRUN — no connected Chrome |
| Explicit device retention | UNRUN — no connected Chrome |

No preview task tab was created, no preview page navigated, and no desktop/narrow viewport,
DOM, dialog, file chooser, download, import/export or device-storage action was
exercised. No fixture or existing workspace was changed. The approved blank
window may remain open: no supported browser handle was obtained to close it.
There is no product failure or browser pass result from these attempts.

The intended target is `https://business-claw-alvaro.vercel.app`. Its served
source/deployment and public accessibility were **not verified by these browser
attempt**. Read-only local Git inspection confirmed that all five `web/` paths,
modes and blob identities at current source
`3b39c2b4cffc3a26787c729c9a675f3c0336289a` match the original approved preview
source `1b5dcc8b155012b1c9d1abaa327bfe5ecaeac477`. This establishes source
equivalence, not the identity or behavior of bytes served to a browser.

The [machine-readable receipt](browser-checks.json) records the exact connection
results and unchanged web identities. Browser acceptance remains open until the
supported connection is available. The separate domain/runtime check results
are owned by their own receipts; this report makes no claim about their runs or
about live Auth, organization isolation, Gateway/provider behavior or completion
of the managed service.
