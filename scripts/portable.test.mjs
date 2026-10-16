#!/usr/bin/env node
// The focused cross-platform regression behind `just test-portable`, the recipe
// the `test-windows` and `test-macos` jobs run. It drives the repository's own
// helpers over the paths that break a naive implementation: a temporary
// directory whose name holds a space and non-ASCII characters, PATH discovery
// against that directory on the real filesystem, and a real child process.
//
// The full suite stays in `just test`; this file is the extra-host probe, so it
// asserts the helper behavior and nothing about Node itself.
//
// Usage:
//   node scripts/portable.test.mjs
//
// Exits 0 when every assertion holds and 1 on the first failure.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capture, isMain, which } from './lib/proc.mjs';
import { listFiles, normalize, readText, toPosix } from './lib/tree.mjs';

const BOM = '\uFEFF';
const NESTED = 'ünïcode dir';
const BODY = 'café content with a space\n';

// A spaced, non-ASCII tree must survive listFiles, readText, and toPosix. The
// separators come from join, so the assertion is the same on every host.
function testSpacedUnicodePaths(check) {
  const root = mkdtempSync(join(tmpdir(), 'portable dir-'));
  try {
    const nested = join(root, NESTED);
    mkdirSync(nested, { recursive: true });
    const file = join(nested, 'café.txt');
    const other = join(nested, 'café.log');
    writeFileSync(file, `${BOM}${BODY}`, 'utf8');
    writeFileSync(other, 'log line\n', 'utf8');

    const found = listFiles(root, ['.txt']).map(toPosix);
    check(found.join(','), toPosix(file), 'listFiles finds a file under a spaced, non-ASCII directory');
    check(found.length, 1, 'listFiles returns only the requested extension');
    check(listFiles(root, ['.log']).map(toPosix).join(','), toPosix(other), 'listFiles selects the file for the requested extension');
    check(readText(file), `${BOM}${BODY}`, 'readText round-trips a spaced, non-ASCII path');
    check(normalize(readText(file)), BODY, 'normalize strips a leading byte-order mark');
    check(toPosix(join(root, 'sub', 'leaf')).includes('\\'), false, 'toPosix leaves no backslash separator');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// which reads the real filesystem through PATH. A real file is found; a
// directory named like the command is not.
function testPathDiscovery(check) {
  const root = mkdtempSync(join(tmpdir(), 'portable path-'));
  try {
    const command = 'portable-candidate';
    const onDisk = process.platform === 'win32' ? `${command}.exe` : command;
    const binDir = join(root, `${NESTED} bin`);
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, onDisk), '');
    const env = { PATH: binDir, PATHEXT: '.exe' };
    check(which(command, { env, platform: process.platform }), join(binDir, onDisk),
      'which finds a file under a spaced, non-ASCII PATH entry');

    const dirsOnly = join(root, 'directories only');
    mkdirSync(join(dirsOnly, onDisk), { recursive: true });
    check(which(command, { env: { PATH: dirsOnly, PATHEXT: '.exe' }, platform: process.platform }), null,
      'which rejects a directory named like the command');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// capture runs the real spawnProcess path: a status-bearing child, a child in a
// spaced non-ASCII working directory, and a command that cannot start.
function testRealSubprocess(check) {
  // Canonicalize the temp root before it is handed to the child as cwd. On
  // macOS os.tmpdir() is under /var/folders, a symlink to /private/var, and the
  // child's process.cwd() reports the resolved form. realpathSync resolves that
  // symlinked temp prefix, which is what the assertion needs. Expanding a
  // Windows 8.3 short name or normalizing case would take realpathSync.native.
  // The call creates no directory and needs no symlink privilege.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'portable proc-')));
  try {
    const nested = join(root, NESTED);
    mkdirSync(nested, { recursive: true });

    check(capture(process.execPath, ['-e', 'process.exit(3)']).status, 3, 'capture reports the child exit status');
    check(capture(process.execPath, ['-e', 'process.exit(0)']).status, 0, 'capture reports a successful child');

    const echoed = capture(process.execPath, ['-e', 'process.stdout.write(process.cwd())'], { cwd: nested });
    check(echoed.status, 0, 'capture runs the child in the requested directory');
    check(toPosix(echoed.stdout), toPosix(nested), 'the child sees the spaced, non-ASCII working directory');

    check(capture('portable-absent-command-9f3a').status, 127, 'capture reports 127 when the command cannot start');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function runTest() {
  let assertions = 0;
  const check = (...args) => {
    assertions += 1;
    assert.equal(...args);
  };

  try {
    testSpacedUnicodePaths(check);
    testPathDiscovery(check);
    testRealSubprocess(check);
    process.stdout.write(`portable.test: ok (${assertions} assertions; ${process.platform})\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`portable.test: failed: ${error.message}\n`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exit(runTest());
