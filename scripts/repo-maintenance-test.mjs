#!/usr/bin/env node
// Thin dispatcher for the pure repository-maintenance planner tests.
//
// The planner under tools/repo-maintenance is a pure Python decision unit, not
// an operational executor: it has no CLI, no I/O, and no cleanup. It ships as a
// library plus a test suite, so the repository keeps one declared test entry
// point instead of a runtime command that would do nothing outside its tests.
//
// This dispatcher uses an existing Python 3.10 or newer interpreter. It installs
// nothing, never changes the machine interpreter, and takes no interpreter name
// from the environment: it searches a fixed list of names on PATH. When none is
// new enough it fails, so a successful check always means the suite ran.
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

// The interpreter candidates in preference order, as a fixed list of literal
// names. Nothing in the environment can add a command here, so the dispatcher
// only ever runs a name it ships. Windows tries the launcher second because
// `python` may be absent from a minimal install, and last the App Execution
// Alias, which prints a store prompt and fails when Python is missing. POSIX
// installs Python 3 as `python3`.
function candidateList(platform) {
  if (platform === 'win32') return [['python', []], ['py', ['-3']], ['python3', []]];
  return [['python3', []], ['python', []]];
}

// A fresh list per call, so one caller cannot change what another one receives.
export function candidates(platform = process.platform) {
  return candidateList(platform).map(([cmd, base]) => [cmd, [...base]]);
}

function versionOf(cmd, base) {
  const result = capture(cmd, [...base, '--version']);
  if (result.error || result.status !== 0) return null;
  // The version is read from the captured text. The module only ever runs the
  // interpreter candidate it selected, through capture() and run().
  const match = `${result.stdout}${result.stderr}`.match(/Python\s+(\d+)\.(\d+)/);
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
    process.stderr.write(
      `error: the repository-maintenance planner tests need Python ${MINIMUM.join('.')} or newer on PATH. ` +
        'Install it and put it on PATH.\n',
    );
    return EXIT.FAIL;
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
