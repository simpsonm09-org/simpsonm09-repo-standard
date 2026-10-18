#!/usr/bin/env node
// Thin dispatcher for the pure repository-maintenance planner tests.
//
// The planner under tools/repo-maintenance is a pure Python decision unit, not
// an operational executor: it has no CLI, no I/O, and no cleanup. It ships as a
// library plus a test suite, so the repository keeps one declared test entry
// point instead of a runtime command that would do nothing outside its tests.
//
// This dispatcher uses an existing Python 3.10 or newer interpreter. It installs
// nothing and never changes the machine interpreter; when none is new enough it
// prints a skip line and exits zero, like the other thin runners here. Set
// REPO_MAINTENANCE_PYTHON to point at a specific interpreter.
//
// Usage:
//   node scripts/repo-maintenance-test.mjs

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from './lib/exit.mjs';
import { capture, isMain, run, which } from './lib/proc.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MODULE_DIR = join('tools', 'repo-maintenance');
const MINIMUM = [3, 10];

// The interpreter candidates in preference order. Windows tries the launcher
// second because `python` may be absent from a minimal install, and last the
// App Execution Alias, which prints a store prompt and fails when Python is
// missing. POSIX installs Python 3 as `python3`.
function candidates() {
  const override = process.env.REPO_MAINTENANCE_PYTHON;
  if (override) return [[override, []]];
  if (process.platform === 'win32') return [['python', []], ['py', ['-3']], ['python3', []]];
  return [['python3', []], ['python', []]];
}

function versionOf(cmd, base) {
  const result = capture(cmd, [...base, '--version']);
  if (result.error || result.status !== 0) return null;
  const match = /Python\s+(\d+)\.(\d+)/.exec(`${result.stdout}${result.stderr}`);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

function isNewEnough([major, minor]) {
  return major > MINIMUM[0] || (major === MINIMUM[0] && minor >= MINIMUM[1]);
}

export function findPython() {
  for (const [cmd, base] of candidates()) {
    if (!which(cmd)) continue;
    const version = versionOf(cmd, base);
    if (version && isNewEnough(version)) return { cmd, base, version };
  }
  return null;
}

export function runTest() {
  const python = findPython();
  if (python === null) {
    process.stdout.write(
      `skip: the repository-maintenance planner tests need Python ${MINIMUM.join('.')} or newer on PATH. ` +
        'Install it, or set REPO_MAINTENANCE_PYTHON to the interpreter.\n',
    );
    return EXIT.OK;
  }
  process.stdout.write(
    `repository-maintenance planner tests: ${python.cmd} (Python ${python.version.join('.')})\n`,
  );
  const args = [
    ...python.base,
    '-B',
    '-m',
    'unittest',
    'discover',
    '-v',
    '-s',
    join(MODULE_DIR, 'tests'),
    '-t',
    MODULE_DIR,
  ];
  return run(python.cmd, args, { cwd: ROOT });
}

if (isMain(import.meta.url)) process.exit(runTest());
