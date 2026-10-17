import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const scanner = fileURLToPath(new URL('./credential-ingress-guard.mjs', import.meta.url));
function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); }
function createFixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'quiz-security-'));
  try {
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.name', 'test');
    git(dir, 'config', 'user.email', 'test@example.invalid');
    writeFileSync(join(dir, '.gitignore'), '.playwright-mcp/\n');
    writeFileSync(join(dir, 'baseline.txt'), 'safe\n');
    git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'baseline');
    const base = git(dir, 'rev-parse', 'HEAD');
    const write = (path, data) => {
      mkdirSync(join(dir, dirname(path)), { recursive: true });
      writeFileSync(join(dir, path), data);
      git(dir, 'add', '-f', path);
    };
    const commit = () => git(dir, 'commit', '-qm', 'candidate');
    const scan = () => spawnSync(process.execPath, [scanner], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, SECURITY_BASE_SHA: base },
    });
    fn({ dir, write, commit, scan });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function assertRedaction(result, secret) {
  assert.equal(result.stdout.includes(secret), false);
  assert.equal(result.stderr.includes(secret), false);
}
test('safe addition allowed', () => createFixture(({ write, commit, scan }) => {
  write('new.txt', 'harmless content'); commit();
  assert.equal(scan().status, 0);
}));
test('new credential blocks without logging the credential', () => createFixture(({ write, commit, scan }) => {
  const secret = 'sk-' + 'A'.repeat(32);
  write('new.txt', 'private = "' + secret + '"'); commit();
  const result = scan(); assert.equal(result.status, 1); assertRedaction(result, secret);
}));
test('previously recorded credential still blocks if later removed', () => createFixture(({ write, commit, scan }) => {
  const secret = 'sk-' + 'B'.repeat(32);
  write('private.txt', secret); commit();
  write('private.txt', 'safe now'); commit();
  const result = scan(); assert.equal(result.status, 1); assertRedaction(result, secret);
}));
test('snapshot is blocked even when force-added through gitignore', () => createFixture(({ write, commit, scan }) => {
  write('.playwright-mcp/page-1.yml', 'screen text'); commit();
  assert.equal(scan().status, 1);
}));
test('snapshot remains blocked when not changed in new commits', () => createFixture(({ dir, write, commit }) => {
  write('.playwright-mcp/page-1.yml', 'screen text'); commit();
  const base = git(dir, 'rev-parse', 'HEAD');
  write('new.txt', 'safe'); commit();
  const result = spawnSync(process.execPath, [scanner], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, SECURITY_BASE_SHA: base },
  });
  assert.equal(result.status, 1);
}));
test('unchanged synthetic fixture token does not count as newly introduced', () => createFixture(({ dir, write, commit }) => {
  const fake = 'sk-' + 'C'.repeat(30);
  write('fixture.test.ts', fake + '\n'); commit();
  const base = git(dir, 'rev-parse', 'HEAD');
  write('fixture.test.ts', fake + '\n// unrelated edit\n'); commit();
  const result = spawnSync(process.execPath, [scanner], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, SECURITY_BASE_SHA: base },
  });
  assert.equal(result.status, 0, result.stderr);
  assertRedaction(result, fake);
}));
test('invalid explicit base fails closed', () => createFixture(({ dir, write, commit }) => {
  write('new.txt', 'safe'); commit();
  const result = spawnSync(process.execPath, [scanner], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, SECURITY_BASE_SHA: 'not-a-sha' },
  });
  assert.equal(result.status, 1);
}));
