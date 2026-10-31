import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';

// Explicit approval for this exact published source is required before execution.
const approved = process.argv[2];
assert.equal(process.argv.length, 3, 'Pass only the exact approved published source');
assert.match(approved ?? '', /^[0-9a-f]{40}$/, 'Pass the exact approved published source');
const sealPath = 'docs/results/2026/10-31/runtime-source.json';
const testPath = 'tests/runtime-config.test.mjs', count = 18;
const git = (...args) => execFileSync('git', args, { maxBuffer: 4 * 1024 * 1024 });
const ordered = values => [...values].sort((a, b) => a.path.localeCompare(b.path));
const sourcePath = value => !value.startsWith('docs/results/');
let expected;

function regularFile(filePath) {
  const parts = filePath.split('/');
  assert.ok(!path.isAbsolute(filePath) && parts.every(part => part && part !== '.' && part !== '..'));
  for (let index = 1; index < parts.length; index++) {
    const stat = fs.lstatSync(parts.slice(0, index).join('/'));
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  }
  const stat = fs.lstatSync(filePath);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  return stat;
}

function sourceGuard() {
  assert.equal(git('rev-parse', 'HEAD').toString().trim(), approved);
  regularFile(sealPath);
  const sealBytes = fs.readFileSync(sealPath);
  assert.deepEqual(sealBytes, git('show', `${approved}:${sealPath}`));
  const seal = JSON.parse(sealBytes.toString('utf8'));
  assert.equal(seal.schemaVersion, 'business-claw.source.v1');
  assert.equal(seal.repository, 'alvarovillalbaa/business-claw');
  const committed = git('ls-tree', '-r', '--full-tree', '-z', approved).toString().split('\0').filter(Boolean).map(line => {
    const at = line.indexOf('\t'), [mode, type, gitSha] = line.slice(0, at).split(' '), filePath = line.slice(at + 1);
    if (!sourcePath(filePath)) return null;
    assert.equal(type, 'blob'); assert.ok(['100644', '100755'].includes(mode));
    return { path: filePath, mode, gitSha };
  }).filter(Boolean);
  const indexed = git('ls-files', '--stage', '-z').toString().split('\0').filter(Boolean).map(line => {
    const at = line.indexOf('\t'), [mode, gitSha, stage] = line.slice(0, at).split(' ');
    assert.equal(stage, '0'); return { path: line.slice(at + 1), mode, gitSha };
  }).filter(file => sourcePath(file.path));
  assert.ok(committed.length > 0);
  assert.deepEqual(ordered(indexed), ordered(committed));
  assert.deepEqual(ordered(seal.files), ordered(committed));
  assert.deepEqual(ordered(seal.selectedByteHashes).map(file => file.path), ordered(committed).map(file => file.path));
  for (const file of committed) {
    const stat = regularFile(file.path), bytes = fs.readFileSync(file.path);
    assert.equal(stat.mode & 0o111 ? '100755' : '100644', file.mode);
    assert.deepEqual(bytes, git('show', `${approved}:${file.path}`));
    const fingerprint = seal.selectedByteHashes.find(entry => entry.path === file.path);
    assert.equal(fingerprint.bytes, bytes.length);
    assert.equal(fingerprint.sha256, createHash('sha256').update(bytes).digest('hex'));
  }
  assert.deepEqual(seal.testFiles.map(file => file.path), [testPath]);
  expected = seal.testFiles[0].names;
  assert.equal(expected.length, count); assert.equal(new Set(expected).size, count);
  assert.ok(expected.every(name => typeof name === 'string' && name.length > 0));
}

let failed = false;
const result = { source: approved, started: false, exitCode: null, signal: null, interrupted: null, timedOut: false, stop: null, stdoutBytes: 0, stderrBytes: 0 };
let stopChild;
const interrupts = ['SIGINT', 'SIGTERM', 'SIGHUP'].map(name => {
  const handler = () => { result.interrupted ??= name; failed = true; stopChild?.(`interrupted ${name}`); };
  process.on(name, handler); return [name, handler];
});
try {
  sourceGuard();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.interrupted, null, 'Controller interrupted before child start');
  const output = [], errors = []; let escalation;
  await new Promise(resolve => {
    const child = spawn(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', '--test-timeout=10000', testPath], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { TZ: 'UTC' } });
    child.once('spawn', () => { result.started = true; });
    const signal = value => { try { if (child.pid) process.kill(-child.pid, value); } catch (error) { if (error.code !== 'ESRCH') result.controlError = error.message; } };
    const stop = reason => {
      if (result.stop) return;
      result.stop = reason; signal('SIGTERM');
      escalation = new Promise(done => setTimeout(() => { signal('SIGKILL'); done(); }, 3000));
    };
    stopChild = stop;
    if (result.interrupted) stop(`interrupted ${result.interrupted}`);
    const timer = setTimeout(() => { result.timedOut = true; stop('30-second deadline'); }, 30000);
    for (const [name, chunks, maximum] of [['stdout', output, 256 * 1024], ['stderr', errors, 64 * 1024]]) {
      child[name].on('data', bytes => { result[`${name}Bytes`] += bytes.length; if (result[`${name}Bytes`] > maximum) stop(`${name} cap`); else chunks.push(bytes); }).on('error', () => stop(`${name} error`));
    }
    child.on('error', error => { result.spawnError = error.message; });
    child.on('close', (code, signalName) => { clearTimeout(timer); result.exitCode = code; result.signal = signalName; resolve(); });
  });
  if (escalation) await escalation;
  stopChild = undefined;
  const lines = Buffer.concat(output).toString('utf8').split(/\r?\n/);
  const names = lines.filter(line => line.startsWith('# Subtest: ')).map(line => line.slice(11));
  const passed = lines.map(line => /^ok ([0-9]+) - (.+)$/.exec(line)).filter(Boolean);
  result.totals = {};
  for (const key of ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = lines.filter(line => line.startsWith(`# ${key} `));
    result.totals[key] = matches.length === 1 && new RegExp(`^# ${key} [0-9]+$`).test(matches[0]) ? Number(matches[0].split(' ').at(-1)) : null;
  }
  console.log(JSON.stringify({ cases: names, totals: result.totals }));
  const failureAt = lines.findIndex(line => /^not ok /.test(line));
  if (failureAt >= 0) console.log(`failure ${JSON.stringify(lines.slice(failureAt, failureAt + 48).join('\n').slice(0, 16384).split(`${process.cwd()}${path.sep}`).join(''))}`);
  if (result.exitCode !== 0 || result.stop || result.spawnError) console.error(`stderr ${JSON.stringify(Buffer.concat(errors).toString('utf8').slice(0, 4096).split(`${process.cwd()}${path.sep}`).join(''))}`);
  assert.equal(result.started, true); assert.equal(result.spawnError, undefined); assert.equal(result.controlError, undefined);
  assert.equal(result.interrupted, null); assert.equal(result.stop, null); assert.equal(result.timedOut, false); assert.equal(result.exitCode, 0); assert.equal(result.signal, null);
  assert.deepEqual(result.totals, { tests: count, suites: 0, pass: count, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  assert.deepEqual([...names].sort(), [...expected].sort());
  assert.deepEqual(passed.map(match => match[2]).sort(), [...expected].sort());
  assert.deepEqual(passed.map(match => Number(match[1])), Array.from({ length: count }, (_, index) => index + 1));
  assert.equal(lines.filter(line => line === `1..${count}`).length, 1);
} catch (error) { failed = true; console.error(`runtime checks failed: ${String(error.message).slice(0, 1000)}`); }
finally {
  try { sourceGuard(); result.sourceGuardPassed = true; } catch (error) { failed = true; result.sourceGuardPassed = false; console.error(`source guard failed: ${String(error.message).slice(0, 1000)}`); }
  for (const [name, handler] of interrupts) process.removeListener(name, handler);
  console.log(JSON.stringify({ ...result, failed })); process.exitCode = failed ? 1 : 0;
}
