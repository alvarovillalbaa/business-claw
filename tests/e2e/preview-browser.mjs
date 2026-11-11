// Actual hosted UI, chooser files and downloads. No account or raw storage API.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.env.BC_BROWSER_ROOT, PROOF = process.env.BC_BROWSER_PROOF;
const SOURCE = process.env.SOURCE_COMMIT, ORIGIN = 'https://business-claw-alvaro.vercel.app';
assert.match(SOURCE ?? '', /^[a-f0-9]{40}$/);
assert.equal(process.version, 'v24.22.2');
for (const p of [ROOT, PROOF]) assert.ok(p && path.isAbsolute(p));
assert.equal(await readFile(path.join(ROOT, '.owner'), 'utf8'), process.env.BC_BROWSER_NONCE);
assert.equal(await readFile(path.join(PROOF, '.owner'), 'utf8'), process.env.BC_BROWSER_NONCE);
const require = createRequire(path.join(ROOT, 'tools/package.json'));
const { chromium, expect } = require('playwright/test');
const hash = data => createHash('sha256').update(data).digest('hex');
const assets = new Map();
for (const [url, file] of [['/', 'index.html'], ['/app.mjs', 'app.mjs'], ['/domain.mjs', 'domain.mjs'],
  ['/server-client.mjs', 'server-client.mjs'], ['/styles.css', 'styles.css'], ['/favicon.svg', 'favicon.svg']]) {
  const bytes = await readFile(path.join(ROOT, 'source/web', file));
  assets.set(url, { path: `web/${file}`, sha256: hash(bytes), bytes: bytes.length });
}
const VALID = path.join(ROOT, 'source/docs/fixtures/workspace.json');
const INVALID = path.join(ROOT, 'source/docs/fixtures/invalid-workspace.json');
const valid = JSON.parse(await readFile(VALID, 'utf8'));
const selected = (process.env.BC_BROWSER_CASES || 'B01,B02,B03,B04').split(',');
assert.ok(selected.length && new Set(selected).size === selected.length && selected.every(x => /^B0[1-4]$/.test(x)));
const report = { schemaVersion: 'business-claw.hosted-preview-browser.v1', sourceCommit: SOURCE,
  target: ORIGIN, node: process.version, selection: selected, cases: [], errors: [], assetBindings: [], passed: false,
  applicationInputs: Object.fromEntries(assets),
  proofLimits: ['Separate CI Chromium profile; original manual Chrome attempt remains partial/unrun.',
    'Actual hosted browser-local preview only: no server-account/Auth/database/provider/runtime qualification.',
    'Narrow uses mouse/keyboard at390x844; no physical touch, native phone, screen-reader or pixel-perfect proof.',
    'Only authored records in fresh contexts. Storage is checked via UI/export/readback, never raw storage APIs.',
    'Static response-body bindings cover six served assets, not provider internals or continuous hosting identity.'] };
let browser, closing = false;
const contexts = new Set();

async function bindAssets(stage) {
  for(const [url,expected] of assets) {
    const response=await fetch(ORIGIN+url,{redirect:'error',signal:AbortSignal.timeout(30000)});
    const chunks=[];let length=0;
    for await(const chunk of response.body){length+=chunk.length;assert.ok(length<=512*1024);chunks.push(chunk);}
    const bytes=Buffer.concat(chunks),target=path.join(PROOF,`assets-${stage}`,path.basename(expected.path));
    await writeFile(target,bytes,{flag:'wx'});
    report.assetBindings.push({stage,url:ORIGIN+url,status:response.status,bytes:bytes.length,sha256:hash(bytes),original:`assets-${stage}/${path.basename(expected.path)}`});
    assert.equal(response.status,200);assert.equal(bytes.length,expected.bytes);assert.equal(hash(bytes),expected.sha256);
  }
}

function permitted(request) {
  const u = new URL(request.url());
  if (u.protocol === 'blob:') return u.origin === ORIGIN && request.method() === 'GET';
  return u.origin === ORIGIN && !u.username && !u.password && !u.search && !u.hash
    && ['GET', 'HEAD'].includes(request.method()) && assets.has(u.pathname);
}
async function settle(state) {
  for (let round = 0; round < 4 && state.jobs.size; round++) await Promise.allSettled([...state.jobs]);
  assert.equal(state.jobs.size, 0, 'response_observers_remaining');
  await expect.poll(() => [...state.requests.values()].filter(r => !r.finished && !r.failed).length).toBe(0);
}
async function fresh(result, narrow = false) {
  const context = await browser.newContext({ viewport: narrow ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    hasTouch: false, isMobile: false, serviceWorkers: 'block', acceptDownloads: true, reducedMotion: 'reduce' });
  contexts.add(context);
  const state = { context, result, narrow, pages: [], jobs: new Set(), requests: new Map(), dialogs: new Map(), closed: false };
  result.profile = narrow ? '390x844_mouse_keyboard' : '1440x1000';
  result.boundary = { requests: [], violations: [], pageErrors: [], consoleErrors: [], dialogs: [], websockets: 0 };
  result.downloads = []; result.stages = []; result.cleanup = { contextClosed: false, pagesClosed: false, networkDrained: false };
  context.on('close', () => { state.closed = true; });
  context.on('page', page => {
    state.pages.push(page);
    if (state.pages.length > (result.id === 'B04' ? 2 : 1)) result.boundary.violations.push('extra_page');
    page.setDefaultTimeout(15000);
    page.on('pageerror', e => result.boundary.pageErrors.push(e.message.slice(0,3000)));
    page.on('console', m => { if (m.type() === 'error') result.boundary.consoleErrors.push(m.text().slice(0,3000)); });
    page.on('websocket', () => { result.boundary.websockets++; });
    page.on('dialog', async d => {
      const pending = state.dialogs.get(page); state.dialogs.delete(page);
      result.boundary.dialogs.push({ type: d.type(), message: d.message(), expected: Boolean(pending) });
      try {
        assert.ok(pending, 'unexpected_native_dialog'); assert.equal(d.type(), pending.type); assert.match(d.message(), pending.pattern);
        await d.accept(); pending.resolve();
      } catch (e) { result.boundary.violations.push('native_dialog_mismatch'); await d.dismiss().catch(()=>{}); pending?.reject(e); }
    });
  });
  await context.route('**/*', async route => {
    if (permitted(route.request())) await route.continue();
    else { result.boundary.violations.push('request_outside_static_preview'); await route.abort(); }
  });
  await context.routeWebSocket('**/*', socket => {
    result.boundary.violations.push('websocket_not_allowed');void socket.close();
  });
  context.on('request', request => {
    const u = new URL(request.url());
    if (u.protocol === 'blob:') return;
    const row = { method: request.method(), path: u.pathname, status: null, finished: false, failed: false, bodyBound: false };
    if (state.requests.size >= 200) { result.boundary.violations.push('request_count_bound'); return; }
    state.requests.set(request, row); result.boundary.requests.push(row);
    if (!permitted(request)) result.boundary.violations.push('unexpected_request');
  });
  context.on('requestfinished', request => { const r = state.requests.get(request); if (r) r.finished = true; });
  context.on('requestfailed', request => { const r = state.requests.get(request); if (r) r.failed = true; result.boundary.violations.push('request_failed'); });
  context.on('response', response => {
    if (new URL(response.url()).protocol === 'blob:') return;
    const row = state.requests.get(response.request());
    const job = (async () => {
      assert.ok(row, 'response_without_request'); row.status = response.status(); assert.equal(row.status, 200);
      let timer;
      try {
        assert.equal(await Promise.race([response.finished(), new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('response_deadline')),15000);})]),null);
      } finally { clearTimeout(timer); }
      const bytes = await response.body(), expected = assets.get(row.path);
      assert.ok(expected && bytes.length <= 512*1024); assert.equal(bytes.length, expected.bytes); assert.equal(hash(bytes), expected.sha256);
      Object.assign(row, { bodyBound: true, bytes: bytes.length, sha256: hash(bytes) });
    })().catch(e => { result.boundary.violations.push(e.message.slice(0,1000)); });
    state.jobs.add(job); void job.finally(()=>state.jobs.delete(job));
  });
  try {
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/#overview`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page.locator('#environment-title')).toHaveText('Local preview — no hosted runtime connected.');
    await nav(state, page, 'workspace'); await expect(page.locator('#device-status')).toContainText('No saved device copy.');
    await nav(state, page, 'overview');
    return { state, page };
  } catch(e) {
    result.primaryError={name:e.name,message:e.message.slice(0,6000)};
    await context.close();contexts.delete(context);result.cleanup.contextClosed=state.closed;result.cleanup.pagesClosed=state.pages.every(p=>p.isClosed());
    throw e;
  }
}
async function nav(state, page, view) {
  if (state.narrow) { await page.locator('#menu-toggle').click(); await expect(page.locator('#menu-toggle')).toHaveAttribute('aria-expanded','true'); }
  const link = page.locator(`#primary-nav a[data-view="${view}"]`);
  if (state.narrow) { await link.focus(); await page.keyboard.press('Enter'); }
  else await link.click();
  await expect(link).toHaveAttribute('aria-current','page');
  if (state.narrow) { await expect(page.locator('#menu-toggle')).toHaveAttribute('aria-expanded','false'); await expect(page.locator('#main')).toBeFocused(); }
}
async function create(page, name, purpose = 'BC_BROWSER authored planning') {
  await page.locator('#create-name').fill(name); await page.locator('#create-purpose').fill(purpose);
  await page.locator('#create-form button[type=submit]').click(); await expect(page.locator('#organization-name')).toHaveText(name);
  await expect(page.locator('#setup-revision')).toHaveText('Revision 1');
}
async function native(state, page, pattern, action) {
  assert.ok(!state.dialogs.has(page)); let timer;
  const pending = new Promise((resolve,reject)=>{state.dialogs.set(page,{type:'confirm',pattern,resolve,reject});timer=setTimeout(()=>reject(Error('native_dialog_deadline')),15000);});
  try { await Promise.all([action(),pending]); } finally { clearTimeout(timer); state.dialogs.delete(page); }
}
async function exported(state, page, tag) {
  await nav(state,page,'workspace');
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }),page.locator('#export-workspace').click()]);
  const file = path.join(PROOF,'downloads',`${tag}.json`);
  await assert.rejects(lstat(file), { code: 'ENOENT' });
  await download.saveAs(file); assert.equal(await download.failure(),null);
  const bytes = await readFile(file); assert.ok(bytes.length > 0 && bytes.length <= 256*1024);
  const value = JSON.parse(bytes); assert.equal(value.schemaVersion,'business-claw.workspace.v1'); assert.ok(Number.isSafeInteger(value.revision));
  assert.match(value.organization.id,/^[a-f0-9-]{36}$/); assert.equal(value.instance.orgId,value.organization.id);
  state.result.downloads.push({path:`downloads/${tag}.json`,bytes:bytes.length,sha256:hash(bytes),suggestedFilename:download.suggestedFilename()});
  return { file, value };
}
async function choose(state,page,file,replacement=false) {
  await nav(state,page,'workspace');
  const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.getByText('Choose JSON file',{exact:true}).click()]);
  if(replacement) await native(state,page,/Replace this tab's workspace and form edits\?/,()=>chooser.setFiles(file));
  else await chooser.setFiles(file);
}
async function screenshot(state,page,id) {
  await settle(state);
  await page.screenshot({path:path.join(PROOF,`${id}.png`),fullPage:true,animations:'disabled',timeout:15000});
  state.result.screenshot=`${id}.png`;
}
async function finish(state) {
  try {
    await settle(state); state.result.cleanup.networkDrained = true;
    assert.equal(state.dialogs.size,0);
    assert.deepEqual(state.result.boundary.violations,[]); assert.deepEqual(state.result.boundary.pageErrors,[]);
    assert.deepEqual(state.result.boundary.consoleErrors,[]); assert.equal(state.result.boundary.websockets,0);
    for(const name of ['/','/app.mjs','/domain.mjs','/server-client.mjs','/styles.css']) assert.ok(state.result.boundary.requests.some(r=>r.path===name&&r.bodyBound));
  } finally {
    await state.context.close(); contexts.delete(state.context);
    state.result.cleanup.contextClosed=state.closed; state.result.cleanup.pagesClosed=state.pages.every(p=>p.isClosed());
    assert.ok(state.result.cleanup.contextClosed&&state.result.cleanup.pagesClosed);
  }
}

const cases = {
  async B01(result) {
    const {state,page}=await fresh(result);
    try {
      const name='BC_BROWSER Review 2026-11-11'; await create(page,name); await nav(state,page,'configuration');
      const desired={purpose:'Équipe 🌊 · authored decisions',provider:'organization-owned',channel:'web-chat',notion:'requested',memory:'off',selfBuilding:'off'};
      await page.locator('#intent-purpose').fill('Équipe 🌊 · authored decisions');
      for(const [key,value] of Object.entries({provider:'organization-owned',channel:'web-chat',notion:'requested',memory:'off',selfBuilding:'off'})) await page.locator(`#intent-${key}`).selectOption(value);
      await page.locator('#apply-setup').click(); await expect(page.locator('#configuration-revision')).toHaveText('Revision 2');
      await nav(state,page,'operations'); await page.locator('#operation-kind').selectOption('provision'); await page.locator('#operation-form button[type=submit]').click();
      const entry=page.locator('#operation-list article'); await expect(entry).toHaveCount(1); await entry.getByRole('button',{name:'Review plan',exact:true}).click();
      await expect(page.locator('#review-dialog')).toBeVisible(); const plan=JSON.parse(await page.locator('#review-command').innerText());
      assert.equal(plan.state,'requested'); assert.equal(plan.plan.instanceRevision,2); assert.deepEqual(plan.plan.desiredSetup,desired);
      await expect(page.locator('#review-details')).toContainText(name); await expect(page.locator('#review-details')).toContainText(plan.orgId); await expect(page.locator('#review-details')).toContainText(plan.instanceId);
      await page.locator('#review-acknowledgment').check(); await page.locator('#record-review').click(); await expect(entry).toContainText('Reviewed locally');
      await entry.getByRole('button',{name:'Confirm local proposal',exact:true}).click(); await page.locator('#review-acknowledgment').check(); await page.locator('#record-review').click();
      await expect(entry).toContainText('Confirmed locally'); await entry.getByRole('button',{name:'Inspect record',exact:true}).click();
      const command=JSON.parse(await page.locator('#review-command').innerText());
      assert.equal(command.operationId,plan.id); assert.equal(command.orgId,plan.orgId); assert.equal(command.instanceId,plan.instanceId);
      assert.equal(command.generation,plan.generation);assert.deepEqual(command.desiredSetup,desired);
      assert.equal(command.instanceRevision,2); assert.equal(command.mode,'proposal-only'); assert.equal(command.adapter,'unbound'); assert.equal(command.executionAuthority,'not-granted');
      await page.locator('#close-review').click(); await native(state,page,/Cancel the local provision instance proposal/,()=>entry.getByRole('button',{name:'Cancel proposal',exact:true}).click());
      await expect(entry).toContainText('Cancelled locally');
      const {value}=await exported(state,page,'B01-cancelled'); const op=value.operations[0];
      assert.equal(op.state,'cancelled'); assert.equal(op.review.decision,'reviewed'); assert.ok(op.confirmation&&op.cancellation); assert.deepEqual(op.plan,plan.plan);
      assert.equal(value.revision,6); assert.equal(value.instance.revision,2);assert.equal(op.revision,3);assert.deepEqual(value.instance.desiredSetup,desired);
      assert.ok([op.review,op.confirmation,op.cancellation].every(r=>r.actorId===plan.actorId));
      const times=[op.createdAt,op.review.at,op.confirmation.at,op.cancellation.at,op.updatedAt].map(Date.parse);assert.ok(times.every((t,i)=>Number.isFinite(t)&&(!i||t>=times[i-1])));
      result.target={organization:plan.orgId,instance:plan.instanceId,operation:plan.id,generation:plan.generation,workspaceRevision:value.revision};
      result.stages.push('six_intent_fields_revision2','exact_review_and_confirmation','unbound_command_identity','actual_cancel_history_revision6');
      await nav(state,page,'operations'); await screenshot(state,page,'B01');
    } catch(e){result.primaryError={name:e.name,message:e.message.slice(0,6000)};throw e;} finally { await finish(state); }
  },
  async B02(result) {
    const {state,page}=await fresh(result,true);
    try {
      await create(page,'BC_BROWSER Narrow 2026-11-11'); await nav(state,page,'operations'); await page.locator('#operation-form button[type=submit]').click();
      const entry=page.locator('#operation-list article'); const trigger=entry.getByRole('button',{name:'Review plan',exact:true}); await trigger.click();
      await expect(page.locator('#review-dialog')).toBeVisible(); assert.equal(await page.locator('#review-dialog').evaluate(el=>el.contains(document.activeElement)),true);
      await page.keyboard.press('Tab'); assert.equal(await page.locator('#review-dialog').evaluate(el=>el.contains(document.activeElement)),true);
      const box=await page.locator('#review-dialog').boundingBox(); assert.ok(box&&box.x>=0&&box.x+box.width<=391);
      await page.keyboard.press('Escape'); await expect(page.locator('#review-dialog')).not.toBeVisible(); await expect(trigger).toBeFocused();
      await nav(state,page,'configuration'); const draft='BC_BROWSER retained narrow draft'; await page.locator('#intent-purpose').fill(draft);
      await nav(state,page,'overview'); await nav(state,page,'configuration'); await expect(page.locator('#intent-purpose')).toHaveValue(draft);
      await nav(state,page,'operations'); await expect(page.locator('#operation-form button[type=submit]')).toBeDisabled(); await nav(state,page,'configuration');
      await page.locator('#apply-setup').click(); await nav(state,page,'operations'); await expect(entry).toContainText('Superseded');
      await expect(entry.getByRole('button',{name:'Confirm local proposal',exact:true})).toHaveCount(0); await entry.getByRole('button',{name:'Inspect record',exact:true}).click();
      const old=JSON.parse(await page.locator('#review-command').innerText()); assert.equal(old.state,'superseded'); assert.equal(old.plan.instanceRevision,1);
      await expect(page.locator('#review-form')).not.toBeVisible(); await page.locator('#close-review').click();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
      result.stages.push('keyboard_navigation','dialog_focus_escape_restore','unapplied_draft_retained','superseded_plan_unconfirmable','no_horizontal_overflow');
      await screenshot(state,page,'B02');
    } catch(e){result.primaryError={name:e.name,message:e.message.slice(0,6000)};throw e;} finally { await finish(state); }
  },
  async B03(result) {
    const {state,page}=await fresh(result);
    try {
      await choose(state,page,VALID); await expect(page.locator('#organization-name')).toHaveText('Authored <workspace>'); await expect(page.locator('#organization-name workspace')).toHaveCount(0);
      const first=await exported(state,page,'B03-roundtrip'); assert.deepEqual(first.value,valid);
      await nav(state,page,'configuration'); await page.locator('#intent-purpose').fill('BC_BROWSER temporary replacement'); await page.locator('#apply-setup').click();
      await choose(state,page,first.file,true); await expect(page.locator('#organization-name')).toHaveText(valid.organization.name);
      await nav(state,page,'configuration'); await expect(page.locator('#intent-purpose')).toHaveValue(valid.instance.desiredSetup.purpose);
      const second=await exported(state,page,'B03-reimported'); assert.deepEqual(second.value,first.value);
      await nav(state,page,'configuration'); const draft='BC_BROWSER invalid import retains this draft'; await page.locator('#intent-purpose').fill(draft);
      await choose(state,page,INVALID); await expect(page.locator('#error')).toContainText('Your current workspace and input have been kept.');
      await nav(state,page,'configuration'); await expect(page.locator('#intent-purpose')).toHaveValue(draft); await expect(page.locator('#organization-name')).toHaveText(valid.organization.name);
      await expect(page.locator('#apply-setup')).toBeEnabled(); await expect(page.locator('#configuration-revision')).toHaveText('Revision 0');
      result.stages.push('actual_file_chooser','angle_bracket_label_literal','actual_download_reimport_identity','invalid_import_preserves_record_and_draft');
      await screenshot(state,page,'B03');
    } catch(e){result.primaryError={name:e.name,message:e.message.slice(0,6000)};throw e;} finally { await finish(state); }
  },
  async B04(result) {
    const {state,page}=await fresh(result);
    try {
      await create(page,'BC_BROWSER Retention 2026-11-11'); await nav(state,page,'operations'); await page.locator('#operation-form button[type=submit]').click();
      await page.locator('#operation-list article').getByRole('button',{name:'Review plan',exact:true}).click();await page.locator('#review-acknowledgment').check();await page.locator('#record-review').click();
      const original=await exported(state,page,'B04-original'); await page.locator('#save-device').click(); await expect(page.locator('#notice')).toHaveText('Device copy saved and read back successfully.');
      assert.equal(original.value.operations[0].review.decision,'reviewed');
      await page.reload({waitUntil:'domcontentloaded'}); await expect(page.locator('#load-device')).toBeEnabled(); await expect(page.locator('#organization-name')).not.toBeVisible();
      await page.locator('#load-device').click(); const reopened=await exported(state,page,'B04-reopened'); assert.deepEqual(reopened.value,original.value);
      await nav(state,page,'operations'); await expect(page.locator('#operation-list article')).toHaveCount(1); await page.locator('#operation-form button[type=submit]').click();
      const stale=await exported(state,page,'B04-first-tab-stale');
      const other=await state.context.newPage(); await other.goto(`${ORIGIN}/#workspace`,{waitUntil:'domcontentloaded'}); await other.locator('#load-device').click();
      await nav(state,other,'configuration'); const changed='BC_BROWSER second-tab recorded intent'; await other.locator('#intent-purpose').fill(changed); await other.locator('#apply-setup').click(); await nav(state,other,'workspace');
      await native(state,other,/Replace Business Claw's saved workspace on this device\?/,()=>other.locator('#save-device').click());
      await expect(page.locator('#device-status')).toContainText('Another tab changed the saved copy.');
      await page.locator('#save-device').click(); await expect(page.locator('#error')).toContainText('Another tab changed the saved copy.');
      const kept=await exported(state,page,'B04-guard-retained'); assert.deepEqual(kept.value,stale.value);
      await native(state,page,/Replace this tab's workspace and form edits\?/,()=>page.locator('#load-device').click());
      await expect(page.locator('#organization-purpose')).toHaveText(changed); const loaded=await exported(state,page,'B04-explicit-new-copy');
      assert.equal(loaded.value.organization.id,original.value.organization.id); assert.equal(loaded.value.operations.length,1); assert.equal(loaded.value.instance.desiredSetup.purpose,changed);
      await native(state,page,/Remove only Business Claw's saved workspace on this device\?/,()=>page.locator('#clear-device').click());
      await expect(page.locator('#device-status')).toContainText('No saved device copy.'); await expect(page.locator('#load-device')).toBeDisabled();
      await expect(other.locator('#device-status')).toContainText('Another tab changed the saved copy.'); await other.locator('#load-device').click();
      await expect(other.locator('#notice')).toContainText('No saved device copy is available.'); await expect(other.locator('#load-device')).toBeDisabled();
      result.stages.push('explicit_save_readback','reload_requires_explicit_load','ids_revisions_history_roundtrip','second_tab_conflict_guard','explicit_replacement','fixture_copy_removed_both_tabs');
      await screenshot(state,page,'B04');
    } catch(e){result.primaryError={name:e.name,message:e.message.slice(0,6000)};throw e;} finally { await finish(state); }
  },
};

try {
  await bindAssets('before');
  browser=await chromium.launch({headless:true,timeout:30000}); report.browser=browser.version();
  browser.on('disconnected',()=>{if(!closing)report.errors.push('unexpected_browser_disconnect');});
  for(const id of selected) {
    if(contexts.size){report.errors.push('prior_context_not_closed');break;}
    const result={id,passed:false}; report.cases.push(result);
    try { await cases[id](result); result.passed=true; }
    catch(e){ result.error={name:e.name,message:e.message.slice(0,6000)}; }
  }
  await bindAssets('after');
} catch(e) { report.errors.push(e.message.slice(0,6000)); }
finally {
  for(const context of contexts) await context.close().catch(e=>report.errors.push(e.message.slice(0,1000)));
  closing=true; if(browser)await browser.close().catch(e=>report.errors.push(e.message.slice(0,1000)));
  report.browserClosed=Boolean(browser&&!browser.isConnected());
  report.passed=report.errors.length===0&&report.cases.length===selected.length&&report.cases.every(c=>c.passed)&&report.browserClosed;
  const bytes=Buffer.from(JSON.stringify(report,null,2)+'\n'); assert.ok(bytes.length<=1024*1024);
  await writeFile(path.join(PROOF,'browser-results.json'),bytes,{flag:'wx'});
  process.stdout.write(JSON.stringify({passed:report.passed,selection:selected,cases:report.cases.map(c=>({id:c.id,passed:c.passed,error:c.error})),browserClosed:report.browserClosed})+'\n');
  process.exitCode=report.passed?0:1;
}
