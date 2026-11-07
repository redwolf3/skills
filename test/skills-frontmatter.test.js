'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync, statSync } = require('fs');
const { join } = require('path');

function skillFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...skillFiles(p));
    else if (name === 'SKILL.md') out.push(p);
  }
  return out;
}

// Minimal YAML sanity check: an unquoted plain scalar must not contain ": " or " #".
test('SKILL.md frontmatter values are valid YAML plain/quoted scalars', () => {
  const files = skillFiles(join(__dirname, '..', 'skills'));
  assert.ok(files.length > 0);
  for (const f of files) {
    const m = readFileSync(f, 'utf8').match(/^---\n([\s\S]*?)\n---/);
    assert.ok(m, `${f}: missing frontmatter`);
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([A-Za-z][\w-]*):\s+(.*)$/);
      if (!kv) continue;
      const v = kv[2];
      if (/^["'|>]/.test(v)) continue;
      assert.ok(!/: |\s#/.test(v), `${f}: unquoted "${kv[1]}" contains ": " or " #" (invalid YAML)`);
    }
  }
});
