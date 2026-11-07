'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const { join } = require('path');
const { mkdtempSync, writeFileSync, existsSync } = require('fs');
const { writeFileSync: wf } = require('fs');
const { tmpdir } = require('os');

const SCRIPT = join(__dirname, '..', 'skills', 'engineering', 'ai-review-loop', 'scripts', 'peer_review_watch.py');
const hasPython = spawnSync('python3', ['--version']).status === 0;
const opts = { skip: !hasPython && 'python3 not available' };

function setup() {
  return mkdtempSync(join(tmpdir(), 'prw-'));
}
function run(dir, ...args) {
  return spawnSync('python3', [SCRIPT, '--dir', dir, ...args], { encoding: 'utf8' });
}
function fb(dir, id, count, epoch, { eom = true, verdict = 'open-issues', commit = 'abc1234', response } = {}) {
  const name = `peer-review-feedback-${id}-${String(count).padStart(2, '0')}-${epoch}`;
  const body = `Reviewer: ${id}\nReviewed-commit: ${commit}\nVerdict: ${verdict}\n\n## F1\nsomething\n`;
  writeFileSync(join(dir, `${name}.md`), body + (eom ? '\n<eom>\n' : ''));
  if (response !== undefined) {
    writeFileSync(join(dir, `${name}-response.md`), '## F1\nDisposition: fixed\n' + (response ? '\n<eom>\n' : ''));
  }
  return join(dir, `${name}.md`);
}

test('next claims increasing 2-digit counts per identifier', opts, () => {
  const dir = setup();
  const a = run(dir, 'next', '--id', 'codex-gpt-sec');
  assert.equal(a.status, 0);
  assert.match(a.stdout.trim(), /peer-review-feedback-codex-gpt-sec-01-\d{10}\.md$/);
  assert.ok(existsSync(a.stdout.trim()));
  const b = run(dir, 'next', '--id', 'codex-gpt-sec');
  assert.match(b.stdout.trim(), /-02-\d{10}\.md$/);
  const c = run(dir, 'next', '--id', 'other');
  assert.match(c.stdout.trim(), /other-01-\d{10}\.md$/);
});

test('next rejects invalid identifiers', opts, () => {
  assert.notEqual(run(setup(), 'next', '--id', 'Bad_ID').status, 0);
});

test('pending returns oldest complete unanswered feedback by epoch', opts, () => {
  const dir = setup();
  fb(dir, 'b', 1, 1700000200);
  const older = fb(dir, 'a', 1, 1700000100);
  const r = run(dir, 'pending');
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), `pending\t${older}`);
});

test('pending skips answered, resumes in-progress, exit 1 when none', opts, () => {
  const dir = setup();
  fb(dir, 'a', 1, 1700000100, { response: true });
  assert.equal(run(dir, 'pending').status, 1);
  const ip = fb(dir, 'b', 1, 1700000200, { response: false });
  assert.equal(run(dir, 'pending').stdout.trim(), `in-progress\t${ip}`);
});

test('older unfinished feedback blocks newer; stale one does not', opts, () => {
  const dir = setup();
  fb(dir, 'a', 1, 1700000100, { eom: false });
  fb(dir, 'b', 1, 1700000200);
  assert.equal(run(dir, 'pending').status, 1);
  const r = run(dir, 'pending', '--stale-after', '0');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /pending\t.*-b-01-1700000200\.md/);
  assert.match(r.stderr, /stale/);
});

test('pending --wait times out with exit 2', opts, () => {
  const r = run(setup(), 'pending', '--wait', '--timeout', '1', '--interval', '0.2');
  assert.equal(r.status, 2);
});

test('wait-response returns once response has <eom>', opts, () => {
  const dir = setup();
  const f = fb(dir, 'a', 1, 1700000100, { response: true });
  const r = run(dir, 'wait-response', '--feedback', f, '--timeout', '2', '--interval', '0.2');
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), /-response\.md$/);
  const g = fb(dir, 'b', 1, 1700000200, { response: false });
  assert.equal(run(dir, 'wait-response', '--feedback', g, '--timeout', '1', '--interval', '0.2').status, 2);
});

test('status gate: needs every reviewer clean at HEAD', opts, () => {
  const dir = setup();
  fb(dir, 'a', 1, 1700000100, { response: true });
  fb(dir, 'a', 2, 1700000300, { verdict: 'no-open-issues', commit: 'def5678abc' });
  fb(dir, 'b', 1, 1700000200, { verdict: 'no-open-issues', commit: 'def5678abc' });
  assert.equal(run(dir, 'status', '--head', 'def5678abc').status, 0);
  const stale = run(dir, 'status', '--head', '999aaaa');
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /blocked:stale-commit/);
  const missing = run(dir, 'status', '--head', 'def5678abc', '--expect', 'a,b,c');
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /c\tmissing/);
});

test('status flags open issues, cap, and in-progress reviews', opts, () => {
  const dir = setup();
  fb(dir, 'a', 5, 1700000100, { response: true });
  fb(dir, 'b', 1, 1700000200, { eom: false });
  const r = run(dir, 'status');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /blocked:cap-reached/);
  assert.match(r.stdout, /blocked:review-in-progress/);
  assert.equal(run(setup(), 'status').status, 1); // no reviewers => not ready
});

test('partial UTF-8 write is treated as incomplete, not a crash', opts, () => {
  const dir = setup();
  const name = join(dir, 'peer-review-feedback-a-01-1700000100.md');
  // "caf" + first byte of a 2-byte character, no <eom>
  wf(name, Buffer.concat([Buffer.from('Verdict: open-issues\n\ncaf'), Buffer.from([0xc3])]));
  const r = run(dir, 'pending');
  assert.equal(r.status, 1, r.stderr);
  assert.doesNotMatch(r.stderr, /Traceback/);
  wf(name, 'Verdict: open-issues\n\ncaf\u00e9\n\n<eom>\n');
  assert.equal(run(dir, 'pending').status, 0);
});

test('wait-head returns the new head once the branch moves; done ends the wait', opts, () => {
  const repo = setup();
  const git = (...a) => spawnSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'feat');
  git('commit', '-q', '--allow-empty', '-m', 'one');
  const one = git('rev-parse', 'HEAD').stdout.trim();
  const dir = join(repo, 'x');
  require('fs').mkdirSync(dir);
  const wait = () => run(dir, '--branch', 'feat', 'wait-head', '--since', one, '--timeout', '1', '--interval', '0.2');
  const cwdRun = (...a) => spawnSync('python3', [SCRIPT, '--dir', dir, '--branch', 'feat', ...a], { encoding: 'utf8', cwd: repo });
  assert.equal(cwdRun('wait-head', '--since', one, '--timeout', '1', '--interval', '0.2').status, 2);
  git('commit', '-q', '--allow-empty', '-m', 'two');
  const two = git('rev-parse', 'HEAD').stdout.trim();
  const moved = cwdRun('wait-head', '--since', one, '--timeout', '2', '--interval', '0.2');
  assert.equal(moved.status, 0);
  assert.equal(moved.stdout.trim(), two);
  assert.equal(cwdRun('done').status, 0);
  assert.equal(cwdRun('wait-head', '--since', two, '--timeout', '2', '--interval', '0.2').status, 3);
  void wait;
});

test('status: clean verdict at old commit at the cap is reported as cap-reached', opts, () => {
  const dir = setup();
  fb(dir, 'a', 5, 1700000100, { verdict: 'no-open-issues', commit: 'aaaaaaa' });
  const r = run(dir, 'status', '--head', 'bbbbbbb');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /blocked:cap-reached-stale/);
});

test('wait-response exits 3 when the session is marked done', opts, () => {
  const dir = setup();
  const f = fb(dir, 'a', 1, 1700000100, { response: false });
  assert.equal(run(dir, 'done').status, 0);
  const r = run(dir, 'wait-response', '--feedback', f, '--timeout', '2', '--interval', '0.2');
  assert.equal(r.status, 3);
});

test('init archives a previous session (feedback and done marker)', opts, () => {
  const dir = setup();
  fb(dir, 'a', 3, 1700000100, { verdict: 'no-open-issues', response: true });
  run(dir, 'done');
  const r = run(dir, 'init');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /archived=3/);
  assert.equal(run(dir, 'pending').status, 1);
  assert.match(run(dir, 'status').stdout, /GATE not-ready/);
  assert.equal(existsSync(join(dir, 'session-done')), false);
  assert.match(run(dir, 'next', '--id', 'a').stdout.trim(), /-a-01-\d{10}\.md$/); // counts restart
});

test('--branch is accepted after the subcommand', opts, () => {
  const r = spawnSync('python3', [SCRIPT, '--dir', setup(), 'wait-head', '--branch', 'nope', '--since', 'abc1234', '--timeout', '1'], { encoding: 'utf8' });
  assert.doesNotMatch(r.stderr, /unrecognized arguments/);
});

test('verdict is read only from the leading metadata block', opts, () => {
  const dir = setup();
  const name = join(dir, 'peer-review-feedback-a-01-1700000100.md');
  wf(name, 'Reviewer: a\nReviewed-commit: def5678abc\nVerdict: open-issues\n\n## F1\n```\nVerdict: no-open-issues\nReviewed-commit: def5678abc\n```\n\n<eom>\n');
  const r = run(dir, 'status', '--head', 'def5678abc');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /verdict=open-issues/);
});

test('status without --head resolves the branch head, or refuses', opts, () => {
  const repo = setup();
  const git = (...a) => spawnSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'feat');
  git('commit', '-q', '--allow-empty', '-m', 'one');
  const head = git('rev-parse', 'HEAD').stdout.trim();
  const dir = join(repo, 'x');
  require('fs').mkdirSync(dir);
  fb(dir, 'a', 1, 1700000100, { verdict: 'no-open-issues', commit: head });
  const inRepo = (...a) => spawnSync('python3', [SCRIPT, '--dir', dir, ...a], { encoding: 'utf8', cwd: repo });
  assert.equal(inRepo('status').status, 0);
  fb(dir, 'b', 1, 1700000200, { verdict: 'no-open-issues', commit: 'deadbee' });
  assert.match(inRepo('status').stdout, /blocked:stale-commit/);
  // not a git repo and no --head: refuse rather than accept any commit
  const other = setup();
  fb(other, 'a', 1, 1700000100, { verdict: 'no-open-issues', commit: 'deadbee' });
  const r = spawnSync('python3', [SCRIPT, '--dir', other, 'status'], { encoding: 'utf8', cwd: setup() });
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /--head/);
});

test('done marker wins over a completed response; dir comes from the feedback path', opts, () => {
  const dir = setup();
  const f = fb(dir, 'a', 1, 1700000100, { response: true });
  run(dir, 'done');
  // no --dir/--branch, cwd is not a git repo: must derive the session dir from --feedback
  const r = spawnSync('python3', [SCRIPT, 'wait-response', '--feedback', f, '--timeout', '2', '--interval', '0.2'],
    { encoding: 'utf8', cwd: setup() });
  assert.equal(r.status, 3, r.stderr);
});

test('branch names that differ only by "/" vs "__" get distinct folders', opts, () => {
  const a = spawnSync('python3', [SCRIPT, '--branch', 'feature/foo', 'dir'], { encoding: 'utf8' }).stdout.trim();
  const b = spawnSync('python3', [SCRIPT, '--branch', 'feature__foo', 'dir'], { encoding: 'utf8' }).stdout.trim();
  assert.ok(a && b && a !== b);
});
