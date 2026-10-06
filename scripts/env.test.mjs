#!/usr/bin/env node
// Prove each env convention rule against a throwaway fixture repository. Every
// rule gets a violating fixture that must report its named `env/<rule>` entry
// and a compliant fixture that must report nothing, so the assertions name the
// entry, not a count. The checker reads files only and never runs repo code.
//
// Usage:
//   node --test scripts/env.test.mjs
//
// Exits 0 when every assertion holds and 1 on the first failure.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkEnv } from './check-standard.mjs';
import { isMain } from './lib/proc.mjs';

function makeAsserter() {
  let count = 0;
  const assert = (condition, message) => {
    count += 1;
    if (!condition) throw new Error(message);
  };
  return { assert, total: () => count };
}

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'env-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, ...rel.split('/'));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function idsFor(files) {
  const root = fixture(files);
  try {
    const ids = [];
    checkEnv(root, (id) => ids.push(id));
    return ids;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function expectEntry(assert, label, files, id) {
  const ids = idsFor(files);
  assert(ids.includes(id), `${label}: expected ${id}, got [${ids.join(', ')}]`);
}

function expectClean(assert, label, files) {
  const ids = idsFor(files);
  assert(ids.length === 0, `${label}: expected no gaps, got [${ids.join(', ')}]`);
}

function testNoTrigger(assert) {
  expectClean(assert, 'a gitignore without .env and no .worktreeinclude', {
    '.gitignore': 'node_modules/\n',
  });
  expectClean(assert, 'a negated .env is not ignored', { '.gitignore': '.env\n!.env\n' });
}

function testWorktreeinclude(assert) {
  expectEntry(assert, 'ignored .env without a .worktreeinclude', { '.gitignore': '.env\n' }, 'env/worktreeinclude');
}

function testWorktreeincludePath(assert) {
  expectEntry(assert, 'a listed path .gitignore does not ignore', {
    '.gitignore': '.env\n',
    '.worktreeinclude': '.env\nother.txt\n',
  }, 'env/worktreeinclude-path');
  expectEntry(assert, 'a .worktreeinclude with no paths', {
    '.gitignore': '.env\n',
    '.worktreeinclude': '# the local env file\n',
  }, 'env/worktreeinclude-path');
}

function testExample(assert) {
  expectEntry(assert, 'listed .env without a sibling .env.example', {
    '.gitignore': '.env\n',
    '.worktreeinclude': '.env\n',
  }, 'env/example');
  expectEntry(assert, 'a sibling .env.example that .gitignore ignores', {
    '.gitignore': '.env*\n',
    '.worktreeinclude': '.env\n',
    '.env.example': 'KEY=value\n',
  }, 'env/example');
}

function testCompliant(assert) {
  expectClean(assert, 'an ignored .env with a committed .env.example', {
    '.gitignore': '.env\n',
    '.worktreeinclude': '.env\n',
    '.env.example': 'KEY=value\n',
  });
}

function testNested(assert) {
  expectClean(assert, 'a nested .env and its sibling example', {
    '.gitignore': '.env\n',
    '.worktreeinclude': 'settings/.env\n',
    'settings/.env.example': 'KEY=value\n',
  });
}

export function runTest() {
  const { assert, total } = makeAsserter();
  try {
    testNoTrigger(assert);
    testWorktreeinclude(assert);
    testWorktreeincludePath(assert);
    testExample(assert);
    testCompliant(assert);
    testNested(assert);
    process.stdout.write(`env.test: ok (${total()} assertions)\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`env.test: failed: ${error.message}\n`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exit(runTest());
