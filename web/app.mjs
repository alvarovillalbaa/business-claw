import {
  limits, defaultIntent, createWorkspace, normalizeWorkspace, parseWorkspace, serializeWorkspace,
  updateIntent, requestOperation, reviewOperation, confirmOperation,
  cancelOperation, proposedCommands, workspaceStatus,
} from "./domain.mjs";
import { createServerClient, ServerRequestError } from "./server-client.mjs";

const $ = id => document.getElementById(id);
const STORAGE_KEY = "business-claw.workspace.v1";
const viewNames = { server: "Server workspace", overview: "Local overview", configuration: "Local desired setup", operations: "Local operation ledger", workspace: "Local workspace data" };
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
const serverClient = createServerClient();
const live = { session: null, organizations: [], record: null, orgId: null, identityId: null, busy: false, attempted: false, connected: false, intentDirty: false, createDirty: false, authMode: "login", recovery: false, error: "", message: "", pending: null, review: null, epoch: 0, read: 0, controller: null, allowedKinds: "" };

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
  const hosted = currentView === "server";
  $("view-server").hidden = !hosted;
  $("environment-label").textContent = hosted ? "SERVER WORKSPACE" : "LOCAL PREVIEW";
  $("environment-title").textContent = hosted ? "Server workspace — runtime unconnected." : "Local preview — no hosted runtime connected.";
  $("environment-copy").textContent = hosted ? "Organization records use your signed-in account. Local preview records stay separate on this device." : "Records stay in this browser until you save or export them. Proposed commands do not run.";
  $("notice").hidden = hosted || !$("notice").textContent;
  $("error").hidden = hosted || !$("error").textContent;
  $("welcome").hidden = hosted || currentView === "workspace" || Boolean(workspace && !creating);
  $("organization-workspace").hidden = hosted || !workspace || creating || currentView === "workspace";
  $("view-workspace").hidden = currentView !== "workspace";
  $("cancel-create").hidden = !workspace;
  for (const view of ["overview", "configuration", "operations"]) $("view-" + view).hidden = currentView !== view;
  for (const link of $("primary-nav").querySelectorAll("a[data-view]")) {
    if (link.dataset.view === currentView) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  }
  $("breadcrumb").textContent = viewNames[currentView];
  renderServer();
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
  currentView = Object.hasOwn(viewNames, view) ? view : "server";
  if (creating && !["workspace", "server"].includes(currentView)) currentView = "overview";
  if (reviewContext) closeReview(false);
  if (live.review) closeServerReview(false);
  render(); setMenu(false);
  if (updateHash) history.replaceState(null, "", `#${currentView}`);
  if (currentView === "server" && !live.attempted && !live.busy) void refreshServerSession();
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

function serverError(cause) {
  const messages = {
    backend_unconfigured: "Hosted workspace setup is still pending. The local preview remains available.",
    database_unconfigured: "Hosted workspace setup is still pending. The local preview remains available.",
    mail_unavailable: "Public account email delivery is not available yet. Existing confirmed accounts can still sign in.",
    unauthenticated: "Sign in again to continue. Your local preview is unchanged.",
    email_unconfirmed: "Confirm your email before using the server workspace.",
    fresh_auth_required: "Sign in again before reviewing this sensitive operation.",
    request_integrity: "Refresh your sign-in session before trying this action again.",
    csrf_invalid: "Refresh your sign-in session before trying this action again.",
    session_required: "Check sign-in to refresh this page's request protection.",
    not_found: "This organization or record is unavailable to your current account. Refresh your organizations.",
    forbidden: "Your current organization role does not allow this action.",
    revision_conflict: "The server record changed. Refresh it before submitting again; your form edits are retained.",
    generation_conflict: "The target generation changed. Refresh the server record and review the new target.",
    plan_conflict: "The reviewed plan changed. Refresh the server ledger before making another decision.",
    domain_conflict: "The proposal or setup changed. Refresh the server record and review its current state.",
    domain_input_invalid: "Check the purpose and setup choices. Your form edits have been retained.",
    invalid_response: "The account service returned an unsupported response. No successful change is claimed.",
    network_unavailable: "The account service could not be reached. The local preview remains available.",
    request_timeout: "The account service did not respond in time. Check the server record before repeating a change.",
  };
  live.error = messages[cause?.code] || "The server could not complete this action. Check sign-in or refresh the record before trying again.";
  if (cause?.status === 401) { live.session = null; live.record = null; live.connected = false; }
  renderServer(); if (currentView === "server") $("server-error").focus();
}
function assertExecution(value) {
  if (!value || value.adapter !== "unbound" || value.dispatchAllowed !== false || value.chatAdmissionAllowed !== false || value.ready !== false || value.readiness !== "unproven") throw new ServerRequestError("invalid_response");
}
function organizationList(value) {
  if (!Array.isArray(value) || value.length > 1000 || new Set(value.map(item => item?.id)).size !== value.length) throw new ServerRequestError("invalid_response");
  for (const item of value) if (!item || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(item.id) || typeof item.name !== "string" || !item.name || !["owner", "administrator", "member", "viewer"].includes(item.role) || !Number.isSafeInteger(item.serverRevision) || item.serverRevision < 0) throw new ServerRequestError("invalid_response");
  return value;
}
function acceptServerSession(value) {
  assertExecution(value.execution);
  const organizations = organizationList(value.organizations), nextIdentity = value.user?.id ?? null;
  if (nextIdentity && nextIdentity !== live.identityId) {
    live.epoch++; live.record = null; live.orgId = null; live.intentDirty = false; live.createDirty = false; live.pending = null;
    $("server-create-form").reset();
  }
  if (nextIdentity) live.identityId = nextIdentity;
  live.session = value; live.organizations = organizations; live.connected = true;
  if (!value.authenticated) { live.record = null; return; }
  if (!organizations.some(item => item.id === live.orgId)) { live.orgId = organizations[0]?.id ?? null; live.record = null; live.intentDirty = false; }
}
function acceptServerRecord(value, expectedOrg = live.orgId, fill = false) {
  assertExecution(value.execution);
  const canonical = normalizeWorkspace(value.workspace);
  if (expectedOrg && canonical.organization.id !== expectedOrg || !Number.isSafeInteger(value.serverRevision) || value.serverRevision < canonical.revision || value.organizationState !== "active"
    || !["owner", "administrator", "member", "viewer"].includes(value.role) || !Array.isArray(value.capabilities) || value.capabilities.some(item => typeof item !== "string")
    || !Array.isArray(value.operationPreviews) || value.operationPreviews.length !== canonical.operations.length) throw new ServerRequestError("invalid_response");
  const previews = new Map(value.operationPreviews.map(item => [item.operationId, item]));
  if (previews.size !== canonical.operations.length || canonical.operations.some(item => !previews.has(item.id) || previews.get(item.id).kind !== item.kind || previews.get(item.id).state !== item.state || !/^[a-f0-9]{64}$/.test(previews.get(item.id).planHash))) throw new ServerRequestError("invalid_response");
  live.record = Object.freeze({ ...value, workspace: canonical }); live.orgId = canonical.organization.id;
  const entry = { id: canonical.organization.id, name: canonical.organization.name, role: value.role, serverRevision: value.serverRevision };
  live.organizations = live.organizations.some(item => item.id === entry.id) ? live.organizations.map(item => item.id === entry.id ? entry : item) : [...live.organizations, entry];
  if (fill || !live.intentDirty) fillServerIntent();
}
function fillServerIntent() {
  const intent = live.record?.workspace.instance.desiredSetup ?? defaultIntent;
  for (const field of Object.keys(fieldNames)) $(`server-intent-${field}`).value = intent[field];
  live.intentDirty = false;
}
function serverCapability(capability, kind = null) {
  if (!live.record?.capabilities.includes(capability)) return false;
  return !kind || live.record.role === "owner" || live.record.role === "administrator" && ["configure", "pause", "resume"].includes(kind);
}
function setupServerFields() {
  for (const field of Object.keys(fieldNames)) {
    const row = node("div", "", "form-field"), title = node("label", fieldNames[field]); title.htmlFor = `server-intent-${field}`;
    const control = node(field === "purpose" ? "input" : "select"); control.id = `server-intent-${field}`; control.name = field;
    if (field === "purpose") { control.type = "text"; control.maxLength = 280; }
    else for (const [value, text] of choices[field]) { const option = node("option", text); option.value = value; control.append(option); }
    row.append(title, control); $("server-configuration-fields").append(row);
  }
  fillServerIntent();
}
function renderServer() {
  const authenticated = live.session?.authenticated === true, locked = live.busy || Boolean(live.pending);
  $("server-connection-status").textContent = live.busy ? "Contacting server" : authenticated ? "Signed in" : live.connected ? "Account service available" : live.attempted ? "Service unavailable" : "Checking connection";
  $("server-error").textContent = live.error; $("server-error").hidden = !live.error;
  $("server-message").textContent = live.message;
  $("server-loading").hidden = !live.busy;
  $("server-loading").textContent = live.pending ? "Waiting for the server acknowledgment…" : "Checking the account service…";
  $("server-auth-panel").hidden = !live.session || authenticated;
  $("server-authenticated").hidden = !authenticated;
  $("server-recovery-panel").hidden = !authenticated || !live.recovery;
  $("server-logout").hidden = !authenticated;
  $("server-user").textContent = authenticated ? `Signed in as ${live.session.user.email}` : "";
  $("server-refresh-session").disabled = live.busy; $("server-logout").disabled = live.busy;
  for (const control of $("server-auth-form").querySelectorAll("input,button")) control.disabled = live.busy;
  $("server-new-password").disabled = live.busy; $("server-password-submit").disabled = live.busy;
  for (const button of document.querySelectorAll("button[data-auth-mode]")) { button.disabled = live.busy; button.setAttribute("aria-pressed", String(button.dataset.authMode === live.authMode)); }
  $("server-auth-title").textContent = live.authMode === "signup" ? "Create an account." : live.authMode === "recover" ? "Recover access." : "Sign in.";
  $("server-auth-help").textContent = live.authMode === "login" ? "Use an existing confirmed-email account. Signing in does not automatically join an organization." : "Public confirmation and recovery email require verified delivery. The server reports availability when you submit.";
  $("server-password-field").hidden = live.authMode === "recover";
  $("server-password").required = live.authMode !== "recover"; $("server-password").disabled = live.busy || live.authMode === "recover";
  $("server-password").autocomplete = live.authMode === "signup" ? "new-password" : "current-password";
  $("server-auth-submit").textContent = live.authMode === "signup" ? "Request account creation" : live.authMode === "recover" ? "Request recovery email" : "Sign in to server";
  $("server-pending").hidden = !live.pending;
  $("server-pending-text").textContent = live.pending ? `Keep request ${live.pending.body.operationId || live.pending.body.requestId || live.pending.kind}. Retrying keeps the same identifiers and payload; checking reads the current server record.` : "";
  $("server-retry").disabled = live.busy;
  $("server-check-request").disabled = live.busy;
  const selector = $("server-organization"); selector.replaceChildren();
  for (const organization of live.organizations) { const option = node("option", organization.name); option.value = organization.id; selector.append(option); }
  selector.value = live.orgId || ""; selector.disabled = locked || !live.organizations.length;
  $("server-org-empty").hidden = live.organizations.length > 0;
  $("server-reload-record").disabled = live.busy || !live.orgId;
  $("server-create-name").disabled = locked; $("server-create-submit").disabled = locked;
  if (!live.organizations.length) $("server-create-details").open = true;
  $("server-record").hidden = !authenticated || !live.record;
  if (!live.record) return;
  const record = live.record, value = record.workspace, canEdit = serverCapability("intent:write");
  $("server-organization-name").textContent = value.organization.name; $("server-role").textContent = record.role;
  details($("server-record-details"), [["Organization ID", value.organization.id, true], ["Instance ID", value.instance.id, true], ["Generation", value.instance.generation], ["Server revision", record.serverRevision], ["Desired setup revision", value.instance.revision], ["Runtime", "Unconnected; application unverified"]]);
  $("server-intent-fields").disabled = locked || !canEdit;
  $("server-save-intent").disabled = locked || !canEdit || !live.intentDirty;
  $("server-reset-intent").disabled = locked || !live.intentDirty;
  $("server-intent-state").textContent = !canEdit ? "Your current role can read this setup. Server authorization is checked on every request." : live.intentDirty ? "Unsubmitted form edits are retained in this tab." : "Showing the acknowledged server intent. No runtime application is claimed.";
  const available = Object.keys(kinds).filter(kind => serverCapability("operation:request", kind));
  if (available.join() !== live.allowedKinds) {
    const previous = $("server-operation-kind").value; $("server-operation-kind").replaceChildren();
    for (const kind of available) { const option = node("option", kinds[kind]); option.value = kind; $("server-operation-kind").append(option); }
    if (available.includes(previous)) $("server-operation-kind").value = previous;
    live.allowedKinds = available.join();
  }
  $("server-operation-kind").disabled = locked || !available.length || live.intentDirty;
  $("server-request-operation").disabled = locked || !available.length || live.intentDirty || value.operations.length >= limits.operations;
  $("server-operation-target").textContent = `${value.organization.name} · generation ${value.instance.generation} · server revision ${record.serverRevision}`;
  $("server-operation-help").textContent = !available.length ? "Your current role does not allow lifecycle decisions." : live.intentDirty ? "Save or discard the setup form edits first." : "Provision and delete require a recent sign-in. All commands remain unbound.";
  renderServerOperations();
}
function renderServerOperations() {
  const list = $("server-operation-list"); list.replaceChildren();
  if (!live.record.workspace.operations.length) { const empty = node("div", "", "empty-ledger"); empty.append(node("strong", "No server proposals yet."), node("p", "Prepare a proposal for the current organization revision.")); list.append(empty); return; }
  const statusNames = { requested: "Awaiting review", reviewed: "Reviewed", confirmed: "Confirmed · execution unbound", rejected: "Rejected", cancelled: "Cancelled", superseded: "Superseded" };
  for (const operation of [...live.record.workspace.operations].reverse()) {
    const entry = node("article", "", "operation-entry"), copy = node("div");
    copy.append(node("h4", kinds[operation.kind]), node("p", operation.plan.desiredSetup.purpose || "No purpose recorded in this plan."));
    const meta = node("div", "", "operation-meta"); meta.append(node("span", formatTime(operation.createdAt)), node("span", operation.id)); copy.append(meta);
    entry.append(copy, node("span", statusNames[operation.state], "pill neutral"));
    const actions = node("div", "", "operation-actions"), add = (action, text) => { const button = node("button", text, "text-button"); button.type = "button"; button.dataset.serverOperation = operation.id; button.dataset.serverAction = action; button.disabled = live.busy || Boolean(live.pending); actions.append(button); };
    add("inspect", "Inspect server plan");
    if (!live.intentDirty && operation.state === "requested" && serverCapability("operation:review", operation.kind)) { add("review", "Review proposal"); add("reject", "Reject proposal"); }
    if (!live.intentDirty && operation.state === "reviewed" && serverCapability("operation:confirm", operation.kind)) add("confirm", "Confirm proposal");
    if (!live.intentDirty && ["requested", "reviewed", "confirmed"].includes(operation.state) && serverCapability("operation:cancel", operation.kind)) add("cancel", "Cancel proposal");
    entry.append(actions); list.append(entry);
  }
}
async function readSelectedServerRecord(sequence = live.read, epoch = live.epoch) {
  const orgId = live.orgId; if (!orgId) return;
  const result = await serverClient.workspace(orgId, { signal: live.controller?.signal });
  if (sequence !== live.read || epoch !== live.epoch || orgId !== live.orgId) return;
  acceptServerRecord(result); reconcileServerPending();
}
async function refreshServerSession() {
  if (live.busy) return;
  live.attempted = true; live.busy = true; live.error = "";
  const sequence = ++live.read, epoch = live.epoch; live.controller?.abort(); live.controller = new AbortController(); renderServer();
  try {
    const result = await serverClient.session({ signal: live.controller.signal });
    if (sequence !== live.read || epoch !== live.epoch) return;
    acceptServerSession(result);
    if (result.authenticated) await readSelectedServerRecord(sequence, live.epoch);
  } catch (cause) { if (sequence === live.read) serverError(cause); }
  finally { if (sequence === live.read) { live.busy = false; renderServer(); } }
}
async function refreshServerRecord() {
  if (live.busy || !live.session?.authenticated) return;
  live.busy = true; live.error = "";
  const sequence = ++live.read, epoch = live.epoch; live.controller?.abort(); live.controller = new AbortController(); renderServer();
  try {
    if (live.orgId) await readSelectedServerRecord(sequence, epoch);
    else { const result = await serverClient.organizations({ signal: live.controller.signal }); if (sequence === live.read && epoch === live.epoch) live.organizations = organizationList(result.organizations); }
    if (sequence === live.read && epoch === live.epoch && !live.pending) live.message = live.intentDirty ? "Server record refreshed. Your form edits were retained." : "Current server record loaded.";
  } catch (cause) { if (sequence === live.read && epoch === live.epoch) serverError(cause); }
  finally { if (sequence === live.read) { live.busy = false; renderServer(); } }
}
function serverTarget(extra = {}) {
  const record = live.record;
  return { orgId: record.workspace.organization.id, instanceId: record.workspace.instance.id, expectedRevision: record.serverRevision, expectedGeneration: record.workspace.instance.generation, ...extra };
}
function reconcileServerPending() {
  const pending = live.pending, record = live.record;
  if (!pending || pending.kind === "bootstrap" || !record || pending.body.orgId !== record.workspace.organization.id || pending.body.instanceId !== record.workspace.instance.id || pending.body.expectedGeneration !== record.workspace.instance.generation) return;
  const operation = record.workspace.operations.find(item => item.id === pending.body.operationId), preview = record.operationPreviews.find(item => item.operationId === pending.body.operationId);
  const samePlan = preview?.planHash === pending.body.planHash;
  const observed = pending.kind === "intent" ? JSON.stringify(record.workspace.instance.desiredSetup) === JSON.stringify(pending.body.intent)
    : pending.action === "request" ? operation?.actorId === pending.userId && operation.kind === pending.body.kind && operation.plan.instanceRevision === pending.instanceRevision && JSON.stringify(operation.plan.desiredSetup) === JSON.stringify(pending.intent)
    : samePlan && (pending.action === "review" ? operation?.review?.actorId === pending.userId && operation.review.decision === pending.body.decision : pending.action === "confirm" ? operation?.confirmation?.actorId === pending.userId : operation?.cancellation?.actorId === pending.userId);
  if (observed || record.serverRevision > pending.body.expectedRevision) {
    live.pending = null;
    live.message = observed ? "The current server record contains the requested values or decision. No runtime execution is claimed." : "The server revision advanced. The earlier request outcome remains unconfirmed; review the current record before submitting another change.";
    if (pending.kind === "intent" && observed) fillServerIntent();
  }
}
async function sendServerPending() {
  const pending = live.pending; if (!pending || live.busy || live.session?.user?.id !== pending.userId) return;
  const epoch = live.epoch; live.busy = true; live.error = ""; renderServer();
  let responseReceived = false;
  try {
    const result = pending.kind === "bootstrap" ? await serverClient.bootstrap(pending.body) : pending.kind === "intent" ? await serverClient.intent(pending.body.orgId, pending.body) : await serverClient.operation(pending.body.orgId, pending.body.operationId, pending.action, pending.body);
    responseReceived = true;
    if (epoch !== live.epoch || live.session?.user?.id !== pending.userId) return;
    acceptServerRecord(result, pending.kind === "bootstrap" ? null : pending.body.orgId, pending.kind !== "operation");
    live.pending = null; live.message = result.replayed ? "The existing server record was recovered without creating another decision." : "Server record acknowledged. Runtime, chat and connectors remain unconnected.";
    if (pending.kind === "bootstrap") { live.createDirty = false; $("server-create-form").reset(); $("server-create-details").open = false; }
  } catch (cause) {
    if (epoch !== live.epoch) return;
    if (!cause?.uncertain && !responseReceived) live.pending = null;
    serverError(responseReceived ? new ServerRequestError("invalid_response", 0, true) : cause);
  } finally { if (epoch === live.epoch) { live.busy = false; renderServer(); } }
}
function prepareServerMutation(kind, body, action = null) {
  if (live.busy || live.pending || !live.session?.authenticated) return;
  live.pending = Object.freeze({ kind, action, body: structuredClone(body), userId: live.session.user.id, instanceRevision: live.record?.workspace.instance.revision, intent: live.record?.workspace.instance.desiredSetup });
  void sendServerPending();
}
function openServerReview(operationId, mode, trigger) {
  if (!live.record || live.busy || live.pending || mode !== "inspect" && live.intentDirty) return;
  const operation = live.record.workspace.operations.find(item => item.id === operationId), preview = live.record.operationPreviews.find(item => item.operationId === operationId);
  if (!operation || !preview) return;
  live.review = { operationId, mode, planHash: preview.planHash, epoch: live.epoch, serverRevision: live.record.serverRevision, orgId: live.orgId, trigger };
  $("server-review-title").textContent = mode === "inspect" ? "Server operation record." : mode === "confirm" ? "Confirm the server proposal." : mode === "cancel" ? "Cancel the server proposal." : mode === "reject" ? "Reject the server proposal." : "Review the server proposal.";
  details($("server-review-details"), [["Organization", live.record.workspace.organization.name], ["Organization ID", operation.orgId, true], ["Instance ID", operation.instanceId, true], ["Operation ID", operation.id, true], ["Generation", operation.generation], ["Server revision", live.record.serverRevision], ["Plan hash", preview.planHash, true]]);
  $("server-review-plan").textContent = JSON.stringify({ kind: operation.kind, state: operation.state, plan: operation.plan }, null, 2);
  $("server-review-form").hidden = mode === "inspect"; $("server-review-ack").checked = false;
  $("server-submit-review").textContent = mode === "confirm" ? "Confirm proposal" : mode === "cancel" ? "Cancel proposal" : mode === "reject" ? "Record rejection" : "Record review";
  $("server-review-dialog").showModal();
}
function closeServerReview(returnFocus = true) {
  const trigger = live.review?.trigger; live.review = null; $("server-review-dialog").close();
  if (returnFocus) { if (trigger?.isConnected) trigger.focus(); else $("main").focus(); }
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
for (const button of document.querySelectorAll("button[data-auth-mode]")) button.addEventListener("click", () => {
  if (live.busy) return; live.authMode = button.dataset.authMode; $("server-password").value = ""; live.error = ""; live.message = ""; renderServer();
});
$("server-auth-form").addEventListener("submit", async event => {
  event.preventDefault(); if (live.busy || !live.session) return;
  const mode = live.authMode, body = mode === "recover" ? { email: $("server-email").value } : { email: $("server-email").value, password: $("server-password").value };
  $("server-password").value = ""; live.busy = true; live.error = ""; live.message = ""; renderServer();
  const epoch = live.epoch;
  try {
    const result = await serverClient[mode](body);
    if (epoch !== live.epoch) return;
    if (mode === "login") {
      acceptServerSession(result); acceptServerSession(await serverClient.session());
      await readSelectedServerRecord(live.read, live.epoch); live.message = "Signed in. Organization access comes from current server membership.";
    } else {
      if (result.accepted !== true || result.delivery !== "unverified") throw new ServerRequestError("invalid_response");
      live.message = "Request accepted. If eligible, use the email link in this browser. Delivery remains unverified.";
    }
  } catch (cause) { serverError(cause); }
  finally { live.busy = false; renderServer(); }
});
$("server-password-form").addEventListener("submit", async event => {
  event.preventDefault(); if (live.busy || !live.session?.authenticated || !live.recovery) return;
  const body = { password: $("server-new-password").value }; $("server-new-password").value = "";
  live.busy = true; live.error = ""; renderServer();
  try {
    acceptServerSession(await serverClient.password(body)); acceptServerSession(await serverClient.session());
    live.recovery = false; history.replaceState(null, "", "#server");
    await readSelectedServerRecord(live.read, live.epoch); live.message = "Password update acknowledged. The account session was refreshed.";
  } catch (cause) { serverError(cause); }
  finally { live.busy = false; renderServer(); }
});
$("server-logout").addEventListener("click", async () => {
  if (live.busy) return;
  if ((live.intentDirty || live.createDirty || live.pending) && !window.confirm("Sign out and discard this tab's server form drafts? An unconfirmed request may still finish on the server; keep its identifier before leaving.")) return;
  live.epoch++; live.read++; live.controller?.abort(); closeServerReview(false);
  live.record = null; live.session = null; live.identityId = null; live.orgId = null; live.organizations = []; live.pending = null; live.intentDirty = false; live.createDirty = false;
  $("server-create-form").reset(); $("server-auth-form").reset(); fillServerIntent();
  live.busy = true; live.error = ""; live.message = "Confirming sign-out…"; renderServer();
  try {
    const result = await serverClient.logout(); acceptServerSession(result); acceptServerSession(await serverClient.session());
    live.message = result.providerSignout === "confirmed" ? "Signed out of Business Claw and the current provider session." : "Signed out of Business Claw. Provider-session sign-out was not verified.";
  } catch (cause) { live.message = "Sign-out could not be confirmed. Check sign-in before assuming the session ended."; serverError(cause); }
  finally { live.busy = false; renderServer(); }
});
$("server-refresh-session").addEventListener("click", () => void refreshServerSession());
$("server-reload-record").addEventListener("click", () => void refreshServerRecord());
$("server-check-request").addEventListener("click", () => void refreshServerRecord());
$("server-retry").addEventListener("click", () => void sendServerPending());
$("server-organization").addEventListener("change", event => {
  if (live.busy || live.pending) { event.target.value = live.orgId || ""; return; }
  if (live.intentDirty && !window.confirm("Discard the current organization's unsubmitted setup form and open another organization?")) { event.target.value = live.orgId || ""; return; }
  live.epoch++; live.orgId = event.target.value; live.record = null; live.intentDirty = false; live.error = ""; live.message = "";
  void refreshServerRecord();
});
$("server-create-form").addEventListener("input", () => { live.createDirty = true; });
$("server-create-form").addEventListener("submit", event => {
  event.preventDefault(); if (live.intentDirty) { live.error = "Save or discard the current setup form before creating another organization."; renderServer(); return; }
  prepareServerMutation("bootstrap", { requestId: id(), name: $("server-create-name").value });
});
$("server-intent-form").addEventListener("input", () => { live.intentDirty = true; live.error = ""; renderServer(); });
$("server-intent-form").addEventListener("submit", event => {
  event.preventDefault(); if (!live.record || !serverCapability("intent:write")) return;
  const intent = Object.fromEntries(Object.keys(fieldNames).map(field => [field, $(`server-intent-${field}`).value]));
  prepareServerMutation("intent", serverTarget({ intent }));
});
$("server-reset-intent").addEventListener("click", () => {
  if (!live.intentDirty || window.confirm("Discard this unsubmitted server setup form and restore the last loaded record?")) { fillServerIntent(); renderServer(); }
});
$("server-operation-form").addEventListener("submit", event => {
  event.preventDefault(); const kind = $("server-operation-kind").value;
  if (!live.record || live.intentDirty || !serverCapability("operation:request", kind)) return;
  prepareServerMutation("operation", serverTarget({ operationId: id(), kind }), "request");
});
$("server-operation-list").addEventListener("click", event => {
  const button = event.target instanceof Element ? event.target.closest("button[data-server-operation]") : null;
  if (button) openServerReview(button.dataset.serverOperation, button.dataset.serverAction, button);
});
$("server-review-form").addEventListener("submit", event => {
  event.preventDefault(); const context = live.review;
  if (!context || !live.record || !$("server-review-ack").checked || live.busy || live.pending) return;
  if (context.epoch !== live.epoch || context.orgId !== live.orgId || context.serverRevision !== live.record.serverRevision || live.intentDirty) { closeServerReview(false); live.error = "The server view changed. Refresh and review the current proposal."; renderServer(); return; }
  const action = ["review", "reject"].includes(context.mode) ? "review" : context.mode;
  if (!["review", "confirm", "cancel"].includes(action)) return;
  const body = serverTarget({ operationId: context.operationId, planHash: context.planHash, ...(action === "review" ? { decision: context.mode === "reject" ? "rejected" : "reviewed" } : {}) });
  closeServerReview(false); prepareServerMutation("operation", body, action);
});
for (const name of ["server-close-review", "server-cancel-review"]) $(name).addEventListener("click", () => closeServerReview());
$("server-review-dialog").addEventListener("cancel", event => { event.preventDefault(); closeServerReview(); });
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
window.addEventListener("hashchange", () => { const view = location.hash.slice(1); if (view === "server-recovery") { live.recovery = true; showView("server", false); } else if (Object.hasOwn(viewNames, view)) showView(view, false); });
window.addEventListener("beforeunload", event => { if (workspaceDirty || intentDirty || createDirty || live.intentDirty || live.createDirty || live.pending) { event.preventDefault(); event.returnValue = ""; } });
window.addEventListener("storage", event => { if (event.key === STORAGE_KEY) { storageChanged = true; render(); notice("The saved copy changed in another tab. This tab's workspace and form edits were kept."); } });
window.addEventListener("pagehide", () => { live.controller?.abort(); for (const url of downloads) URL.revokeObjectURL(url); downloads.clear(); });

setupFields(); setupServerFields(); fillIntent(); inspectDevice(); live.recovery = location.hash === "#server-recovery"; showView(live.recovery ? "server" : location.hash.slice(1), false); setMenu(false);
