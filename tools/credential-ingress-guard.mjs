/**
 * Fail-closed credential ingress guard. Never prints matched credential values.
 * Verifies committed files and every new commit since the supplied base.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SHA = /^[0-9a-f]{40}$/i;
const ZERO = /^0{40}$/;
const CREDENTIALS = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /github_pat_[A-Za-z0-9_]{40,}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /AIza[0-9A-Za-z_-]{35}/,
];

function git(args, encoding = 'utf8') {
  return execFileSync('git', args, { encoding, maxBuffer: 64 * 1024 * 1024 });
}
function lines(...args) {
  return git(args).trim().split('\n').filter(Boolean);
}
function paths(...args) {
  return git(args, 'buffer').toString('utf8').split('\0').filter(Boolean);
}
function getBase(head) {
  const specified = (process.env.SECURITY_BASE_SHA ?? '').trim();
  if (specified && !SHA.test(specified)) throw Error('Invalid SECURITY_BASE_SHA');
  if (specified && !ZERO.test(specified)) return lines('merge-base', head, specified)[0];
  try {
    const mainBase = lines('merge-base', head, 'refs/remotes/origin/main')[0];
    if (mainBase !== head) return mainBase;
  } catch {
    // No main tracking ref (e.g. a newly initialized local repository).
  }
  return lines('rev-parse', head + '^')[0];
}
function addedCredential(parent, commit, path) {
  const diff = git(['diff', '--no-ext-diff', '--unified=0', parent, commit, '--', path]);
  let insideHunk = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) { insideHunk = true; continue; }
    if (line.startsWith('diff --git ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      insideHunk = false;
      continue;
    }
    if (insideHunk && line.startsWith('+') && CREDENTIALS.some(rx => rx.test(line.slice(1)))) {
      return true;
    }
  }
  return false;
}
export function inspect() {
  const alerts = new Set();
  for (const path of paths('ls-files', '-z', '--', '.playwright-mcp')) {
    alerts.add('tracked browser snapshot: ' + path);
  }
  const head = lines('rev-parse', 'HEAD')[0];
  const base = getBase(head);
  const commits = lines('rev-list', '--reverse', base + '..' + head);
  for (const commit of commits) {
    const parents = lines('rev-list', '--parents', '-n', '1', commit)[0]?.split(' ').slice(1) ?? [];
    if (!parents.length) throw Error('Cannot inspect a parentless new commit');
    for (const path of paths('diff', '--name-only', '--diff-filter=ACMRT', '-z', parents[0], commit)) {
      if (path === '.playwright-mcp' || path.startsWith('.playwright-mcp/')) {
        alerts.add('newly committed browser snapshot: ' + path);
      } else if (addedCredential(parents[0], commit, path)) {
        alerts.add('credential-like added content: ' + path);
      }
    }
  }
  return { alerts: [...alerts], checkedCommits: commits.length };
}
export function run() {
  try {
    const { alerts, checkedCommits } = inspect();
    if (alerts.length) {
      for (const notice of alerts) console.error('SECURITY_BLOCK: ' + notice);
      console.error('Credential ingress blocked. No matched values displayed.');
      process.exitCode = 1;
    } else {
      console.log('Credential ingress PASS: no tracked browser snapshots or added credential patterns across ' + checkedCommits + ' commits.');
    }
  } catch {
    console.error('SECURITY_BLOCK: unable to verify tree or commit range; check checkout history/base.');
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
