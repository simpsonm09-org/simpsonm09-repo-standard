#!/usr/bin/env node
// Prove the subprocess group. A node:child_process call must pass a literal
// windowsHide: true, or a GUI-hosted Node process opens an empty console window
// on Windows. The scanner cases run over source text, one per import style and
// options shape. The integration cases run the real check-standard and check-repo
// CLIs over throwaway fixture repositories. The checker reads files only and never
// runs repository code.
//
// Usage:
//   node --test scripts/subprocess.test.mjs
//
// Exits 0 when every assertion holds and 1 on the first failure.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/proc.mjs';
import { findSubprocessGaps } from './lib/subprocess.mjs';

const CHECK_STANDARD = fileURLToPath(new URL('./check-standard.mjs', import.meta.url));
const CHECK_REPO = fileURLToPath(new URL('./check-repo.mjs', import.meta.url));
const IMPORT = "import { spawnSync, exec, execFile, execFileSync, fork } from 'node:child_process';";
const BAD = "'git', ['status'], { encoding: 'utf8' }";
const GOOD = "'git', ['status'], { windowsHide: true, encoding: 'utf8' }";
const NO_OPTIONS = "'git', ['status']";
// The matrix pads every cell to this width, so a cell is read by its column offset.
const CELL_WIDTH = 11;

const lines = (...parts) => parts.join('\n');

function makeAsserter() {
  let count = 0;
  const assert = (condition, message) => {
    count += 1;
    if (!condition) throw new Error(message);
  };
  return { assert, total: () => count };
}

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'subprocess-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, ...rel.split('/'));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function expectGap(assert, label, source, fragment) {
  const gaps = findSubprocessGaps(source);
  assert(
    gaps.length === 1 && gaps[0].reason.includes(fragment),
    `${label}: expected one gap mentioning "${fragment}", got ${JSON.stringify(gaps)}`,
  );
}

function expectClean(assert, label, source) {
  const gaps = findSubprocessGaps(source);
  assert(gaps.length === 0, `${label}: expected no gaps, got ${JSON.stringify(gaps)}`);
}

// One way a module can reach child_process. Each takes the call's argument list.
const STYLES = {
  'named import': (args) => lines("import { spawnSync } from 'node:child_process';", `spawnSync(${args});`),
  'renamed import': (args) => lines("import { spawnSync as run } from 'node:child_process';", `run(${args});`),
  'namespace import': (args) => lines("import * as cp from 'node:child_process';", `cp.spawnSync(${args});`),
  'default import': (args) => lines("import cp from 'child_process';", `cp.spawnSync(${args});`),
  'default bound by name': (args) => lines("import { default as cp } from 'node:child_process';", `cp.spawnSync(${args});`),
  'default member of a namespace': (args) => lines("import * as cp from 'node:child_process';", `cp.default.spawnSync(${args});`),
  'destructured require': (args) => lines("const { spawnSync } = require('node:child_process');", `spawnSync(${args});`),
  'renamed require': (args) => lines("const { spawnSync: run } = require('child_process');", `run(${args});`),
  'namespace require': (args) => lines("const cp = require('node:child_process');", `cp.spawnSync(${args});`),
  'dynamic import': (args) => lines("const { spawnSync } = await import('node:child_process');", `spawnSync(${args});`),
  'chained require': (args) => `require('node:child_process').spawnSync(${args});`,
  'injected default': (args) =>
    lines("import { spawnSync } from 'node:child_process';", 'export function go(spawn = spawnSync) {', `  return spawn(${args});`, '}'),
};

function testImportStyles(assert) {
  for (const [style, make] of Object.entries(STYLES)) {
    expectGap(assert, `${style} without the key`, make(BAD), 'no literal windowsHide: true');
    expectClean(assert, `${style} with the key`, make(GOOD));
    expectGap(assert, `${style} without options`, make(NO_OPTIONS), 'has no options');
  }
  expectClean(
    assert,
    'a same-named function from another module',
    lines("import { spawnSync } from 'my-lib';", "spawnSync('git', []);"),
  );
  expectClean(
    assert,
    'a child_process name imported from another builtin',
    lines("import { spawnSync } from 'node:fs';", "spawnSync('git', []);"),
  );
  expectClean(assert, 'a file that never imports child_process', 'const value = 1;\n');
}

function testOptionsShapes(assert) {
  const call = (args) => lines(IMPORT, `spawnSync(${args});`);
  expectGap(assert, 'windowsHide false', call("'git', [], { windowsHide: false }"), 'literal true');
  expectGap(assert, 'windowsHide from a variable', call("'git', [], { windowsHide: hide }"), 'literal true');
  expectGap(assert, 'shorthand windowsHide', call("'git', [], { windowsHide }"), 'literal true');
  expectGap(assert, 'a spread after the key', call("'git', [], { windowsHide: true, ...base }"), 'spread after');
  expectGap(assert, 'a spread without the key', call("'git', [], { ...base }"), 'no literal windowsHide');
  expectClean(assert, 'a spread before the key', call("'git', [], { ...base, windowsHide: true }"));
  expectGap(assert, 'options held in a variable', call("'git', [], opts"), 'variable');
  expectGap(assert, 'a spawn with argv only', call("'git', args"), 'has no options');
  expectGap(assert, 'exec with a callback and no options', lines(IMPORT, "exec('git status', () => {});"), 'has no options');
  expectClean(
    assert,
    'exec with options before the callback',
    lines(IMPORT, "exec('git status', { windowsHide: true }, () => {});"),
  );
  expectGap(
    assert,
    'execFile options without the key',
    lines(IMPORT, "execFile('git', ['x'], { encoding: 'utf8' }, () => {});"),
    'no literal windowsHide',
  );
  expectClean(assert, 'fork with options in the second slot', lines(IMPORT, "fork('worker.mjs', { windowsHide: true });"));
  expectGap(assert, 'execFileSync with no options', lines(IMPORT, "execFileSync('git', ['x']);"), 'has no options');
}

function testNonCalls(assert) {
  expectClean(assert, 'a call inside a comment', lines(IMPORT, "// spawnSync('git', ['status']);"));
  expectClean(assert, 'a call inside a string', lines(IMPORT, "const text = \"spawnSync('git')\";"));
  expectClean(assert, 'a property call on an object', lines(IMPORT, "const o = {}; o.spawnSync('git');"));
  expectClean(assert, 'a function declaration named like a child_process function', lines(IMPORT, 'function spawnSync(a) { return a; }'));
}

function testTokenizer(assert) {
  expectGap(
    assert,
    'a regex holding quotes before a call',
    lines(IMPORT, "const re = /['\"`]/g;", "spawnSync('git', []);"),
    'no options',
  );
  expectGap(
    assert,
    'a template holding braces before a call',
    lines(IMPORT, 'const t = `${ {a: 1}.a }`;', "spawnSync('git', []);"),
    'no options',
  );
  expectGap(
    assert,
    'a division and a slash in a string',
    lines(IMPORT, "const ratio = n / 2, slash = '/';", "spawnSync('git', []);"),
    'no options',
  );
  const gaps = findSubprocessGaps(lines(IMPORT, '', '', "spawnSync('git', [],", "  { encoding: 'utf8' });"));
  assert(gaps.length === 1 && gaps[0].line === 4, `line numbers: expected one gap on line 4, got ${JSON.stringify(gaps)}`);
}

function runCli(script, args) {
  return spawnSync(process.execPath, [script, ...args], { windowsHide: true, encoding: 'utf8' });
}

// The cell under a group header in a matrix printed by check-standard or check-repo.
function cell(output, group) {
  const [, header, row] = output.split('\n');
  const at = header.indexOf(group);
  return at < 0 ? 'missing' : row.slice(at, at + CELL_WIDTH).trim();
}

function testStandardCli(assert) {
  const bad = fixture({ 'scripts/tool.mjs': lines(IMPORT, `spawnSync(${BAD});`) });
  const good = fixture({ 'scripts/tool.mjs': lines(IMPORT, `spawnSync(${GOOD});`) });
  const excluded = fixture({
    'pstack.lock.json': '{}\n',
    'node_modules/pkg/index.mjs': lines(IMPORT, `spawnSync(${BAD});`),
    'vendor/tool.mjs': lines(IMPORT, `spawnSync(${BAD});`),
    'skills/tool.mjs': lines(IMPORT, `spawnSync(${BAD});`),
  });
  try {
    const failing = runCli(CHECK_STANDARD, [bad]);
    assert(failing.status === 1, `check-standard exits 1 on a bad call, got ${failing.status}`);
    assert(cell(failing.stdout, 'subprocess') === 'GAP(1)', `bad call: expected GAP(1), got ${cell(failing.stdout, 'subprocess')}`);
    assert(
      failing.stdout.includes('gap subprocess/windows-hide: scripts/tool.mjs:2 spawnSync()'),
      `bad call: expected file:line in the gap, got ${failing.stdout}`,
    );
    const passing = runCli(CHECK_STANDARD, [good]);
    assert(cell(passing.stdout, 'subprocess') === 'ok', `good call: expected ok, got ${cell(passing.stdout, 'subprocess')}`);
    const skipped = runCli(CHECK_STANDARD, [excluded]);
    assert(cell(skipped.stdout, 'subprocess') === 'ok', `excluded trees: expected ok, got ${cell(skipped.stdout, 'subprocess')}`);
  } finally {
    for (const root of [bad, good, excluded]) rmSync(root, { recursive: true, force: true });
  }
}

function testCheckRepoCli(assert) {
  const bad = fixture({ 'scripts/tool.mjs': lines(IMPORT, `spawnSync(${BAD});`) });
  try {
    const result = runCli(CHECK_REPO, [bad, '--repo', 'simpsonm09-org/fixture', '--no-api']);
    assert(cell(result.stdout, 'subprocess') === 'GAP(1)', `check-repo: expected GAP(1), got ${cell(result.stdout, 'subprocess')}`);
  } finally {
    rmSync(bad, { recursive: true, force: true });
  }
}

export function runTest() {
  const { assert, total } = makeAsserter();
  try {
    testImportStyles(assert);
    testOptionsShapes(assert);
    testNonCalls(assert);
    testTokenizer(assert);
    testStandardCli(assert);
    testCheckRepoCli(assert);
    process.stdout.write(`subprocess.test: ok (${total()} assertions)\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`subprocess.test: failed: ${error.message}\n`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exit(runTest());
