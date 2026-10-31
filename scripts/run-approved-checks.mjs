import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';

// Explicit, separately approved execution only. The static build never calls this.
const approved = process.argv[2];
assert.match(approved ?? '', /^[0-9a-f]{40}$/, 'Pass the exact approved published source');
const sealPath = 'docs/results/2026/10-31/source.json';
const git = (...args) => execFileSync('git', args, { maxBuffer: 4 * 1024 * 1024 });
const ordered = values => [...values].sort((a, b) => a.path.localeCompare(b.path));
let expected;
function sourceGuard() {
  assert.equal(git('rev-parse', 'HEAD').toString().trim(), approved);
  assert.deepEqual(fs.readFileSync(sealPath), git('show', `${approved}:${sealPath}`));
  const seal = JSON.parse(fs.readFileSync(sealPath, 'utf8'));
  const indexed = git('ls-files', '--stage', '-z').toString().split('\0').filter(Boolean).map(line => {
    const at = line.indexOf('\t'), [mode, gitSha, stage] = line.slice(0, at).split(' ');
    assert.equal(stage, '0'); return { path: line.slice(at + 1), mode, gitSha };
  }).filter(file => !file.path.startsWith('docs/results/'));
  assert.deepEqual(ordered(indexed), ordered(seal.files));
  for (const file of indexed) {
    const parts = file.path.split('/');
    assert.ok(!path.isAbsolute(file.path) && parts.every(part => part && part !== '.' && part !== '..'));
    for (let n = 1; n < parts.length; n++) { const stat = fs.lstatSync(parts.slice(0, n).join('/')); assert.ok(stat.isDirectory() && !stat.isSymbolicLink()); }
    const stat = fs.lstatSync(file.path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(stat.mode & 0o111 ? '100755' : '100644', file.mode);
    assert.deepEqual(fs.readFileSync(file.path), git('show', `${approved}:${file.path}`));
  }
  assert.deepEqual(seal.testFiles.map(file => file.path), ['tests/domain.test.mjs']);
  expected = seal.testFiles[0].names;
  assert.equal(expected.length, 14); assert.equal(new Set(expected).size, 14);
}

let failed = false;
const result = { source: approved, started: false, exitCode: null, signal: null, stop: null, stdoutBytes: 0, stderrBytes: 0 };
try {
  sourceGuard();
  const output = [], errors = []; let escalation;
  await new Promise(resolve => {
    const child = spawn(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', '--test-timeout=10000', 'tests/domain.test.mjs'], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { TZ: 'UTC' } });
    result.started = true;
    const signal = value => { try { if (child.pid) process.kill(-child.pid, value); } catch (error) { if (error.code !== 'ESRCH') result.controlError = error.message; } };
    const stop = reason => { if (result.stop) return; result.stop = reason; signal('SIGTERM'); escalation = new Promise(done => setTimeout(() => { signal('SIGKILL'); done(); }, 3000)); };
    const timer = setTimeout(() => stop('30-second deadline'), 30000);
    for (const [name, chunks, maximum] of [['stdout', output, 256 * 1024], ['stderr', errors, 64 * 1024]]) child[name].on('data', bytes => { result[`${name}Bytes`] += bytes.length; if (result[`${name}Bytes`] > maximum) stop(`${name} cap`); else chunks.push(bytes); }).on('error', () => stop(`${name} error`));
    child.on('error', error => { result.spawnError = error.message; });
    child.on('close', (code, signalName) => { clearTimeout(timer); result.exitCode = code; result.signal = signalName; resolve(); });
  });
  if (escalation) await escalation;
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
  assert.equal(result.spawnError, undefined); assert.equal(result.controlError, undefined);
  assert.equal(result.stop, null); assert.equal(result.exitCode, 0); assert.equal(result.signal, null);
  assert.deepEqual(result.totals, { tests: 14, suites: 0, pass: 14, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  assert.deepEqual([...names].sort(), [...expected].sort());
  assert.deepEqual(passed.map(match => match[2]).sort(), [...expected].sort());
  assert.deepEqual(passed.map(match => Number(match[1])), Array.from({ length: 14 }, (_, index) => index + 1));
  assert.equal(lines.filter(line => line === '1..14').length, 1);
} catch (error) { failed = true; console.error(`checks failed: ${String(error.message).slice(0, 1000)}`); }
finally {
  try { sourceGuard(); result.sourceGuardPassed = true; } catch (error) { failed = true; result.sourceGuardPassed = false; console.error(`source guard failed: ${String(error.message).slice(0, 1000)}`); }
  console.log(JSON.stringify({ ...result, failed })); process.exitCode = failed ? 1 : 0;
}
