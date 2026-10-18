#!/usr/bin/env node
// Prove the planner test dispatcher never takes the command it runs from the
// environment. The dispatcher executes an interpreter, so the interpreter name
// must come from a fixed, literal list. The override this file guards,
// REPO_MAINTENANCE_PYTHON, named an arbitrary command and was removed for that
// reason; these checks fail if it, or any other environment value, returns.
//
// The checks are cheap and run no interpreter: they read the candidate list,
// assert that setting the variable cannot change it, and spawn the dispatcher
// once with an empty PATH to confirm the absent-interpreter exit code. Nothing
// here executes a shell payload or removes anything outside its own temp dir.
//
// Usage:
//   node scripts/repo-maintenance.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from './lib/exit.mjs';
import { isMain } from './lib/proc.mjs';
import { candidates, findPython } from './repo-maintenance-test.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DISPATCHER = join(HERE, 'repo-maintenance-test.mjs');
const SOURCE = readFileSync(DISPATCHER, 'utf8');

// The removed override. It used to name an arbitrary interpreter for the
// dispatcher to run; the dispatcher now searches a fixed list of names.
const REMOVED_OVERRIDE = 'REPO_MAINTENANCE_PYTHON';
const ALLOWED_COMMANDS = new Set(['python', 'python3', 'py']);
const LITERAL_ARGUMENT = /^-?[A-Za-z0-9_]+$/;
const SHELL_CHARACTER = /[\s/\\;&|<>$`^%"']/;
const PLATFORMS = ['win32', 'linux'];
const OTHER_VALUES = ['python', join('nowhere', 'other-interpreter')];

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function withOverride(value, run) {
  const original = process.env[REMOVED_OVERRIDE];
  process.env[REMOVED_OVERRIDE] = value;
  try {
    return run();
  } finally {
    restoreEnv(REMOVED_OVERRIDE, original);
  }
}

function assertLiteralCandidates(check, platform) {
  const list = candidates(platform);
  check(list.length > 0, `${platform}: the candidate list is not empty`);
  for (const [cmd, base] of list) {
    check(ALLOWED_COMMANDS.has(cmd), `${platform}: ${cmd} is an allowlisted interpreter name`);
    check(!SHELL_CHARACTER.test(cmd), `${platform}: ${cmd} carries no shell or path character`);
    check(base.every((arg) => LITERAL_ARGUMENT.test(arg)), `${platform}: every ${cmd} argument is a literal`);
  }
}

function assertOverrideIsIgnored(check, marker) {
  for (const platform of PLATFORMS) {
    const baseline = JSON.stringify(candidates(platform));
    for (const value of [marker, ...OTHER_VALUES]) {
      const actual = withOverride(value, () => JSON.stringify(candidates(platform)));
      check(actual === baseline, `${platform}: ${REMOVED_OVERRIDE}=${value} does not change the candidates`);
    }
  }
  check(!SOURCE.includes(REMOVED_OVERRIDE), 'the dispatcher source names no interpreter environment variable');
}

function assertEmptyPathFindsNothing(check, marker, emptyDir) {
  const originalPath = process.env.PATH;
  const originalPathExt = process.env.PATHEXT;
  try {
    process.env.PATH = emptyDir;
    process.env.PATHEXT = '.EXE';
    check(withOverride(marker, () => findPython()) === null, 'an empty PATH finds no interpreter');
  } finally {
    restoreEnv('PATH', originalPath);
    restoreEnv('PATHEXT', originalPathExt);
  }
}

function assertDispatcherFailsWithoutInterpreter(check, marker, emptyDir) {
  const result = spawnSync(process.execPath, [DISPATCHER], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PATH: emptyDir, PATHEXT: '.EXE', [REMOVED_OVERRIDE]: marker },
  });
  check(result.error === undefined, 'the dispatcher child starts');
  check(result.status === EXIT.FAIL, 'the dispatcher exits FAIL when no interpreter is on PATH');
}

export function runTest() {
  let assertions = 0;
  const check = (condition, message) => {
    assertions += 1;
    assert.ok(condition, message);
  };

  const markerDir = mkdtempSync(join(tmpdir(), 'repo-maintenance-dispatcher-'));
  try {
    // An inert file the removed override would have named. The checks never run
    // it; its only role is to be a real path the environment value takes.
    const marker = join(markerDir, 'agent-marker-interpreter');
    writeFileSync(marker, 'inert marker; the dispatcher must never run this\n');

    for (const platform of PLATFORMS) assertLiteralCandidates(check, platform);
    assertOverrideIsIgnored(check, marker);
    assertEmptyPathFindsNothing(check, marker, markerDir);
    assertDispatcherFailsWithoutInterpreter(check, marker, markerDir);

    process.stdout.write(`repo-maintenance.test: ok (${assertions} assertions)\n`);
    return EXIT.OK;
  } catch (error) {
    process.stderr.write(`repo-maintenance.test: failed: ${error.message}\n`);
    return EXIT.FAIL;
  } finally {
    rmSync(markerDir, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) process.exit(runTest());
