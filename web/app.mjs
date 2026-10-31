import {
  limits, defaultIntent, createWorkspace, parseWorkspace, serializeWorkspace,
  updateIntent, requestOperation, reviewOperation, confirmOperation,
  cancelOperation, proposedCommands, workspaceStatus,
} from "./domain.mjs";

const $ = id => document.getElementById(id);
const STORAGE_KEY = "business-claw.workspace.v1";
const viewNames = { overview: "Overview", configuration: "Desired setup", operations: "Operation ledger", workspace: "Workspace data" };
const kinds = { provision: "Provision instance", configure: "Configure instance", pause: "Pause instance", resume: "Resume instance", delete: "Delete instance" };
const states = { requested: "Awaiting review", reviewed: "Reviewed locally", confirmed: "Confirmed locally", rejected: "Rejected locally", cancelled: "Cancelled locally", superseded: "Superseded" };
const choices = {
  provider: [["unselected", "Choose later"], ["organization-owned", "Organization-owned provider · unconnected"]],
  channel: [["web-chat", "Web chat · unconnected"]],
  notion: [["off", "Not requested"], ["requested", "Request a Notion connection"]],
  memory: [["off", "Off"], ["workspace", "Organization workspace memory"]],
  selfBuilding: [["off", "Off"], ["review-required", "Require review before activation"]],
};
const fieldNames = { purpose: "Assistant purpose", provider: "Model provider intent", channel: "Team channel", notion: "Notion", memory: "Memory preference", selfBuilding: "Self-building preference" };
let workspace = null, currentView = "overview", creating = false;
let intentDirty = false, createDirty = false, workspaceDirty = false, actorId = null;
let savedRaw = null, storageAvailable = true, savedInvalid = false, storageChanged = false;
let reviewContext = null, importSequence = 0, menuOpen = false;
const downloads = new Set();
const mobile = matchMedia("(max-width: 720px)");

function node(tag, text = "", className = "") {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function notice(message) { $("notice").textContent = message; $("notice").hidden = !message; }
function error(message) {
  $("error").textContent = message; $("error").hidden = !message;
  if (message) $("error").focus();
}
function failure(cause) {
  const messages = {
    business_claw_text_invalid: "Use the supported single-line text limits. Your current workspace and form input have been kept.",
    business_claw_secret_like_text: "This field looks like it contains a credential. Keep credentials out of portable workspace records.",
    business_claw_limit_exceeded: "The workspace exceeds a supported record or file-size limit. Your current workspace has been kept.",
    business_claw_timestamp_order: "This record is newer than this device's clock. Check the device clock before changing it; the workspace is unchanged.",
    business_claw_revision_conflict: "The workspace changed after this action was prepared. Review its current revision before trying again.",
    business_claw_generation_conflict: "The target generation changed. Review the current instance before trying again.",
    business_claw_plan_stale: "This plan has been superseded. Prepare a new proposal from the current desired setup.",
    business_claw_transition_invalid: "This action does not apply to the operation's current state. The record has been kept.",
  };
  error(messages[cause?.message] || "The action could not be completed. Check the supported workspace format and field values. Your current workspace and input have been kept.");
}
function id() { return crypto.randomUUID(); }
function localActor() { return actorId ??= id(); }
function guard(value = workspace) { return { expectedRevision: value.revision, expectedGeneration: value.instance.generation, now: new Date().toISOString() }; }
function label(field, value) { return choices[field]?.find(([key]) => key === value)?.[1] ?? value; }
function formatTime(value) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function details(target, entries) {
  target.replaceChildren();
  for (const [name, value, mono = false] of entries) {
    const row = node("div"), term = node("dt", name), description = node("dd");
    description.append(node(mono ? "code" : "span", String(value)));
    row.append(term, description); target.append(row);
  }
}
function mutate(next, message) {
  workspace = next; workspaceDirty = true;
  render(); error(""); notice(message);
}
function canUseIntent() {
  if (!intentDirty) return true;
  error("Save the local intent or discard its form edits before preparing or reviewing an operation."); return false;
}
function confirmReplacement() {
  return (!workspace && !createDirty) || window.confirm("Replace this tab's workspace and form edits? Save or export the current workspace first if you want to keep it.");
}

function setupFields() {
  const container = $("configuration-fields");
  for (const field of Object.keys(fieldNames)) {
    const row = node("div", "", "form-field"), title = node("label", fieldNames[field]);
    title.htmlFor = `intent-${field}`;
    const control = node(field === "purpose" ? "input" : "select");
    control.id = `intent-${field}`; control.name = field;
    if (field === "purpose") { control.type = "text"; control.maxLength = 280; control.placeholder = "What should this assistant help your organization do?"; }
    else for (const [value, text] of choices[field]) { const option = node("option", text); option.value = value; control.append(option); }
    row.append(title, control);
    if (field === "purpose") row.append(node("p", "One line, up to 280 characters. Keep private credentials out of your purpose.", "field-note"));
    if (field === "channel") row.append(node("p", "Web chat is the initial proposed channel. No session is connected.", "field-note"));
    container.append(row);
  }
  for (const [value, text] of Object.entries(kinds)) { const option = node("option", text); option.value = value; $("operation-kind").append(option); }
  $("import-limit").textContent = `JSON only · at most ${limits.bytes / 1024} KiB per workspace.`;
}
function fillIntent() {
  const intent = workspace?.instance.desiredSetup ?? defaultIntent;
  for (const field of Object.keys(fieldNames)) $(`intent-${field}`).value = intent[field];
  intentDirty = false;
}
function render() {
  $("welcome").hidden = currentView === "workspace" || Boolean(workspace && !creating);
  $("organization-workspace").hidden = !workspace || creating || currentView === "workspace";
  $("view-workspace").hidden = currentView !== "workspace";
  $("cancel-create").hidden = !workspace;
  for (const view of ["overview", "configuration", "operations"]) $("view-" + view).hidden = currentView !== view;
  for (const link of $("primary-nav").querySelectorAll("a[data-view]")) {
    if (link.dataset.view === currentView) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  }
  $("breadcrumb").textContent = viewNames[currentView];
  $("operation-count").textContent = String(workspace?.operations.length ?? 0);
  $("export-workspace").disabled = !workspace || intentDirty;
  $("save-device").disabled = !workspace || intentDirty;
  $("load-device").disabled = !storageAvailable || (savedRaw === null && !storageChanged);
  $("clear-device").disabled = !storageAvailable || savedRaw === null;
  renderDevice();
  details($("workspace-details"), workspace ? [["Organization", workspace.organization.name], ["Organization ID", workspace.organization.id, true], ["Workspace revision", workspace.revision], ["Operation records", workspace.operations.length], ["Unverified observations", workspace.observations.length], ["Last record change", formatTime(workspace.updatedAt)]] : [["Contents", "No local organization created yet."]]);
  if (!workspace) return;
  const summary = workspaceStatus(workspace), intent = workspace.instance.desiredSetup;
  $("organization-name").textContent = workspace.organization.name;
  $("organization-purpose").textContent = intent.purpose || "Add an assistant purpose in Desired setup.";
  $("organization-short-id").textContent = workspace.organization.id.slice(0, 8);
  $("setup-revision").textContent = `Revision ${summary.desiredRevision}`;
  $("configuration-revision").textContent = `Revision ${summary.desiredRevision}`;
  $("overview-operation-count").textContent = String(workspace.operations.length);
  $("save-state").textContent = workspaceDirty || storageChanged || savedInvalid ? "In this tab" : savedRaw ? "Saved on device" : "In this tab";
  $("save-detail").textContent = savedInvalid ? "Saved copy needs attention" : storageChanged ? "Saved copy changed in another tab" : workspaceDirty ? "Changes need explicit save or export" : "No unsaved record changes";
  details($("instance-details"), [["Instance ID", workspace.instance.id, true], ["Organization ID", workspace.instance.orgId, true], ["Generation", summary.generation], ["Gateway adapter", summary.adapter], ["Readiness", `${summary.readiness} · no serving identity`], ["Applied setup", "Not observed"], ["Observations", `${summary.observationCount} unverified record${summary.observationCount === 1 ? "" : "s"}`]]);
  details($("setup-summary"), Object.entries(fieldNames).filter(([field]) => field !== "purpose").map(([field, name]) => [name, label(field, intent[field])]));
  $("configuration-state").textContent = intentDirty ? "Unapplied form edits. Save local intent to record a new revision." : "Showing the recorded desired setup. Device saving is explicit in Workspace data.";
  $("reset-setup").disabled = !intentDirty;
  $("apply-setup").disabled = !intentDirty;
  $("operation-target").textContent = `${workspace.organization.name} · generation ${summary.generation} · setup revision ${summary.desiredRevision}`;
  $("operation-form").querySelector("button[type=submit]").disabled = workspace.operations.length >= limits.operations || intentDirty;
  $("operation-hint").textContent = workspace.operations.length >= limits.operations ? `This portable workspace has reached its ${limits.operations}-operation record limit.` : intentDirty ? "Save or discard the setup form edits before preparing a proposal." : "Each proposal retains its exact target and desired setup revision for review.";
  $("ledger-summary").textContent = `${workspace.operations.length}/${limits.operations} records · ${summary.pendingOperations} active`;
  renderOperations();
}
function renderOperations() {
  const container = $("operation-list"); container.replaceChildren();
  if (!workspace.operations.length) {
    const empty = node("div", "", "empty-ledger"); empty.append(node("strong", "A clear ledger starts empty."), node("p", "Prepare a proposal to review its target and exact setup.")); container.append(empty); return;
  }
  for (const operation of [...workspace.operations].reverse()) {
    const entry = node("article", "", "operation-entry"), heading = node("div");
    heading.append(node("h4", kinds[operation.kind]), node("p", operation.plan.desiredSetup.purpose || "No assistant purpose recorded in this plan."));
    const metadata = node("div", "", "operation-meta");
    metadata.append(node("span", formatTime(operation.createdAt)), node("span", `GEN ${operation.generation} / SETUP ${operation.plan.instanceRevision}`), node("span", operation.id.slice(0, 8)));
    heading.append(metadata);
    const tone = operation.state === "requested" ? "pending" : ["reviewed", "confirmed"].includes(operation.state) ? "reviewed" : "cancelled";
    entry.append(heading, node("span", states[operation.state], `pill ${tone}`));
    const actions = node("div", "", "operation-actions");
    const mode = operation.state === "requested" ? "review" : operation.state === "reviewed" ? "confirm" : "inspect";
    const inspect = node("button", mode === "review" ? "Review plan" : mode === "confirm" ? "Confirm local proposal" : "Inspect record", "text-button");
    inspect.type = "button"; inspect.dataset.operation = operation.id; inspect.dataset.action = mode; actions.append(inspect);
    if (operation.state === "requested") { const reject = node("button", "Reject proposal", "text-button"); reject.type = "button"; reject.dataset.operation = operation.id; reject.dataset.action = "reject"; actions.append(reject); }
    if (["requested", "reviewed", "confirmed"].includes(operation.state)) { const cancel = node("button", "Cancel proposal", "text-button danger-text"); cancel.type = "button"; cancel.dataset.operation = operation.id; cancel.dataset.action = "cancel"; actions.append(cancel); }
    entry.append(actions); container.append(entry);
  }
}
function setMenu(open) {
  menuOpen = open; document.body.classList.toggle("menu-open", open);
  $("menu-toggle").setAttribute("aria-expanded", String(open));
  $("menu-toggle").setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
  $("sidebar").inert = mobile.matches && !open;
}
function showView(view, updateHash = true) {
  currentView = Object.hasOwn(viewNames, view) ? view : "overview";
  if (creating && currentView !== "workspace") currentView = "overview";
  if (reviewContext) closeReview(false);
  render(); setMenu(false);
  if (updateHash) history.replaceState(null, "", `#${currentView}`);
}
function openReview(operationId, mode, trigger) {
  if (!workspace || (mode !== "inspect" && !canUseIntent())) return;
  const operation = workspace.operations.find(item => item.id === operationId); if (!operation) return;
  reviewContext = { operationId, mode, revision: workspace.revision, orgId: workspace.organization.id, instanceId: workspace.instance.id, generation: workspace.instance.generation, trigger };
  $("review-title").textContent = mode === "confirm" ? "Confirm the proposal." : mode === "reject" ? "Reject the proposal." : mode === "inspect" ? "Inspect the record." : "Review the change.";
  $("review-description").textContent = `${kinds[operation.kind]} · ${states[operation.state]}`;
  details($("review-details"), [["Organization", workspace.organization.name], ["Organization ID", operation.orgId, true], ["Instance ID", operation.instanceId, true], ["Operation ID", operation.id, true], ["Generation", operation.generation], ["Setup revision", operation.plan.instanceRevision], ["Workflow actor", operation.actorId, true]]);
  const command = proposedCommands(workspace).find(item => item.operationId === operationId);
  $("review-plan-title").textContent = command ? "Proposed command data" : "Recorded operation plan";
  $("review-command").textContent = JSON.stringify(command || operation, null, 2);
  $("review-form").hidden = mode === "inspect";
  $("review-acknowledgment").checked = false;
  $("record-review").textContent = mode === "confirm" ? "Record local confirmation" : mode === "reject" ? "Record local rejection" : "Record local review";
  $("review-dialog").showModal();
}
function closeReview(returnFocus = true) {
  const trigger = reviewContext?.trigger; reviewContext = null; $("review-dialog").close();
  if (returnFocus) { if (trigger?.isConnected) trigger.focus(); else $("main").focus(); }
}

function renderDevice() {
  $("device-status").textContent = !storageAvailable ? "This browser could not read device storage. Your open workspace remains available for export." : storageChanged ? "Another tab changed the saved copy. Load it explicitly to inspect it; this tab's records were kept." : savedRaw === null ? "No saved device copy. Save explicitly to retain this workspace here." : savedInvalid ? "The saved copy could not be validated. It has been kept; export your current workspace before replacing or removing it." : "A saved copy is available on this device. Loading and replacing it are explicit actions.";
}
function inspectDevice() {
  try { savedRaw = localStorage.getItem(STORAGE_KEY); if (savedRaw !== null) { try { parseWorkspace(savedRaw); } catch { savedInvalid = true; } } }
  catch { storageAvailable = false; }
}
function saveDevice() {
  if (!workspace || intentDirty) return;
  try {
    const serialized = serializeWorkspace(workspace), previous = localStorage.getItem(STORAGE_KEY);
    if (previous !== savedRaw) { storageChanged = true; render(); error("Another tab changed the saved copy. Export this workspace or explicitly load that copy before replacing it."); return; }
    if (previous !== null && !window.confirm("Replace Business Claw's saved workspace on this device? Other browser data will be kept.")) return;
    if (localStorage.getItem(STORAGE_KEY) !== previous) { storageChanged = true; render(); error("The saved copy changed during confirmation. Your workspace was kept; load that copy before replacing it."); return; }
    localStorage.setItem(STORAGE_KEY, serialized);
    if (localStorage.getItem(STORAGE_KEY) !== serialized) throw new Error("storage_readback");
    savedRaw = serialized; savedInvalid = false; storageChanged = false; storageAvailable = true; workspaceDirty = false;
    error(""); render(); notice("Device copy saved and read back successfully.");
  } catch { error("The device save could not be confirmed. Your workspace is still open. Export JSON to keep a separate copy."); }
}
function loadDevice() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) { savedRaw = null; savedInvalid = false; storageChanged = false; if (workspace) workspaceDirty = true; render(); notice("No saved device copy is available. This tab's records have been kept."); return; }
    let next;
    try { next = parseWorkspace(raw); }
    catch {
      savedRaw = raw; savedInvalid = true; storageChanged = false; storageAvailable = true;
      render(); error("The saved device copy could not be validated. Your workspace and form edits were kept. You can explicitly replace or remove the saved copy."); return;
    }
    if (!confirmReplacement()) return;
    closeReview(false); workspace = next; workspaceDirty = false; intentDirty = false; createDirty = false; creating = false;
    savedRaw = raw; savedInvalid = false; storageChanged = false; storageAvailable = true;
    fillIntent(); showView("overview"); error(""); notice("Loaded the saved device workspace. Its runtime remains unconnected.");
  } catch { error("The saved device copy could not be loaded. Your current workspace and the saved data were kept."); }
}
function clearDevice() {
  if (!window.confirm("Remove only Business Claw's saved workspace on this device? This tab's current records will remain open.")) return;
  try {
    if (localStorage.getItem(STORAGE_KEY) !== savedRaw) { storageChanged = true; render(); error("Another tab changed the saved copy. Load it explicitly before removing it."); return; }
    localStorage.removeItem(STORAGE_KEY);
    if (localStorage.getItem(STORAGE_KEY) !== null) throw new Error("storage_readback");
    savedRaw = null; savedInvalid = false; storageChanged = false; if (workspace) workspaceDirty = true;
    error(""); render(); notice("The saved device copy was removed. This tab's records remain open for export or another explicit save.");
  } catch { error("Removal could not be confirmed. Your open workspace is unchanged."); }
}
function exportWorkspace() {
  if (!workspace || intentDirty) return;
  try {
    const serialized = serializeWorkspace(workspace), url = URL.createObjectURL(new Blob([serialized], { type: "application/json;charset=utf-8" }));
    downloads.add(url);
    const anchor = node("a"); anchor.href = url;
    anchor.download = `${workspace.organization.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "business-claw"}-workspace.json`;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 60_000);
    error(""); notice("Workspace JSON download requested. This does not save the device copy or run a command.");
  } catch (cause) { failure(cause); }
}
async function importWorkspace(file) {
  if (!file) return;
  const sequence = ++importSequence;
  try {
    if (file.size > limits.bytes) throw new TypeError("business_claw_limit_exceeded");
    const bytes = await file.arrayBuffer(); if (sequence !== importSequence) return;
    if (bytes.byteLength > limits.bytes) throw new TypeError("business_claw_limit_exceeded");
    const next = parseWorkspace(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!confirmReplacement()) return;
    closeReview(false); workspace = next; workspaceDirty = true; intentDirty = false; createDirty = false; creating = false;
    fillIntent(); showView("overview"); error(""); notice("Validated workspace imported into this tab. No operation was executed and the saved device copy is unchanged.");
  } catch (cause) { if (sequence === importSequence) failure(cause); }
  finally { if (sequence === importSequence) $("import-file").value = ""; }
}

$("create-form").addEventListener("input", () => { createDirty = true; });
$("create-form").addEventListener("submit", event => {
  event.preventDefault();
  try {
    let next = createWorkspace({ orgId: id(), instanceId: id(), name: $("create-name").value, now: new Date().toISOString() });
    next = updateIntent(next, { ...defaultIntent, purpose: $("create-purpose").value }, guard(next));
    if (workspace && !confirmReplacement()) return;
    workspace = next; workspaceDirty = true; intentDirty = false; createDirty = false; creating = false;
    $("create-form").reset(); fillIntent(); showView("overview"); error(""); notice("Local organization workspace created. Refine its desired setup or prepare a proposal.");
  } catch (cause) { failure(cause); }
});
$("new-organization").addEventListener("click", () => { creating = true; showView("overview"); $("create-name").focus(); });
$("cancel-create").addEventListener("click", () => {
  if (createDirty && !window.confirm("Discard this new organization form and return to the current workspace?")) return;
  creating = false; createDirty = false; $("create-form").reset(); showView("overview");
});
$("configuration-form").addEventListener("input", () => { intentDirty = true; error(""); render(); });
$("configuration-form").addEventListener("submit", event => {
  event.preventDefault(); if (!workspace) return;
  try {
    const intent = Object.fromEntries(Object.keys(fieldNames).map(field => [field, $(`intent-${field}`).value]));
    const next = updateIntent(workspace, intent, guard()), changed = next.revision !== workspace.revision;
    intentDirty = false;
    if (changed) mutate(next, "Local intent recorded. Active proposals for the previous setup are superseded.");
    else { error(""); notice("The recorded intent already matches these values. No revision changed."); }
    fillIntent(); render();
  } catch (cause) { failure(cause); }
});
$("reset-setup").addEventListener("click", () => { if (!intentDirty || window.confirm("Discard unapplied setup form edits? The recorded intent will be kept.")) { fillIntent(); render(); error(""); } });
$("operation-form").addEventListener("submit", event => {
  event.preventDefault(); if (!workspace || !canUseIntent()) return;
  try { mutate(requestOperation(workspace, { id: id(), kind: $("operation-kind").value, actorId: localActor() }, guard()), "Operation proposal recorded. Review its exact plan in the ledger."); }
  catch (cause) { failure(cause); }
});
$("operation-list").addEventListener("click", event => {
  const target = event.target instanceof Element ? event.target.closest("button[data-operation]") : null;
  if (!target || !workspace) return;
  if (target.dataset.action !== "cancel") { openReview(target.dataset.operation, target.dataset.action, target); return; }
  if (!canUseIntent()) return;
  const operation = workspace.operations.find(item => item.id === target.dataset.operation);
  if (!operation || !window.confirm(`Cancel the local ${kinds[operation.kind].toLowerCase()} proposal ${operation.id}? Its history will be retained. No runtime action is performed.`)) return;
  try { mutate(cancelOperation(workspace, operation.id, { actorId: localActor() }, guard()), "Local proposal cancelled. Its plan and workflow history remain in the ledger."); $("main").focus(); }
  catch (cause) { failure(cause); }
});
$("review-form").addEventListener("submit", event => {
  event.preventDefault(); if (!workspace || !reviewContext || !$("review-acknowledgment").checked) return;
  try {
    const context = reviewContext;
    if (context.revision !== workspace.revision || context.orgId !== workspace.organization.id || context.instanceId !== workspace.instance.id || context.generation !== workspace.instance.generation) throw new TypeError("business_claw_revision_conflict");
    const next = context.mode === "confirm" ? confirmOperation(workspace, context.operationId, { actorId: localActor() }, guard()) : reviewOperation(workspace, context.operationId, { decision: context.mode === "reject" ? "rejected" : "reviewed", actorId: localActor() }, guard());
    closeReview(false); mutate(next, context.mode === "confirm" ? "Local confirmation recorded. The proposed command remains unbound and was not executed." : context.mode === "reject" ? "Local rejection recorded. The proposal history is retained." : "Local review recorded. You can inspect and confirm the proposal separately."); $("main").focus();
  } catch (cause) { closeReview(false); failure(cause); }
});
for (const name of ["close-review", "cancel-review"]) $(name).addEventListener("click", () => closeReview());
$("review-dialog").addEventListener("cancel", event => { event.preventDefault(); closeReview(); });
$("menu-toggle").addEventListener("click", () => { setMenu(!menuOpen); if (menuOpen) $("primary-nav").querySelector("a[aria-current]").focus(); });
document.addEventListener("keydown", event => { if (event.key === "Escape" && menuOpen) { setMenu(false); $("menu-toggle").focus(); } });
document.addEventListener("click", event => {
  const target = event.target instanceof Element ? event.target : null;
  const go = target?.closest("button[data-go]"); if (go) { showView(go.dataset.go); $("main").focus(); }
  const link = target?.closest("a[data-view]"); if (link) { event.preventDefault(); showView(link.dataset.view); $("main").focus(); }
});
$("welcome-import").addEventListener("click", () => { showView("workspace"); $("import-file").click(); });
$("import-file").addEventListener("change", event => void importWorkspace(event.target.files?.[0]));
$("save-device").addEventListener("click", saveDevice);
$("load-device").addEventListener("click", loadDevice);
$("clear-device").addEventListener("click", clearDevice);
$("export-workspace").addEventListener("click", exportWorkspace);
mobile.addEventListener("change", () => setMenu(false));
window.addEventListener("hashchange", () => { const view = location.hash.slice(1); if (Object.hasOwn(viewNames, view)) showView(view, false); });
window.addEventListener("beforeunload", event => { if (workspaceDirty || intentDirty || createDirty) { event.preventDefault(); event.returnValue = ""; } });
window.addEventListener("storage", event => { if (event.key === STORAGE_KEY) { storageChanged = true; render(); notice("The saved copy changed in another tab. This tab's workspace and form edits were kept."); } });
window.addEventListener("pagehide", () => { for (const url of downloads) URL.revokeObjectURL(url); downloads.clear(); });

setupFields(); fillIntent(); inspectDevice(); showView(location.hash.slice(1), false); setMenu(false);
