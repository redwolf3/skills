'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const { join } = require('path');

const CLI = join(__dirname, '..', 'bin', 'cli.js');

function run(...args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

test('--version prints package version', () => {
  const pkg = require('../package.json');
  const result = run('--version');
  assert.equal(result.status, 0);
  assert.match(result.stdout, new RegExp(pkg.version));
});

test('--help prints usage', () => {
  const result = run('--help');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /redwolf3-skills/);
  assert.match(result.stdout, /--help/);
  assert.match(result.stdout, /--version/);
});

test('no args prints usage with exit 0', () => {
  const result = run();
  assert.equal(result.status, 0);
  assert.match(result.stdout, /redwolf3-skills/);
});

test('unknown command exits non-zero', () => {
  const result = run('unknown-command-xyz');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown command/);
});

test('list command exits 0', () => {
  const result = run('list');
  assert.equal(result.status, 0);
});
