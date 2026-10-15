#!/usr/bin/env node
// Exercise PATH discovery without running any discovered command.

import assert from 'node:assert/strict';
import { accessSync, constants, lstatSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isMain, which } from './lib/proc.mjs';

function testPathCandidates(check, root) {
  const executable = process.platform === 'win32' ? 'candidate.exe' : 'candidate';
  mkdirSync(join(root, executable));
  process.env.PATH = root;
  check(which('candidate'), null, 'a directory is not an executable');

  const empty = mkdtempSync(join(tmpdir(), 'proc-empty-'));
  try {
    process.env.PATH = empty;
    check(which('candidate'), null, 'an absent candidate is not found');
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
}

function testStoreAlias(check) {
  if (process.platform !== 'win32') return 'skipped (Windows only)';
  if (!process.env.LOCALAPPDATA) return 'skipped (LOCALAPPDATA is unset)';

  const aliasDir = join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps');
  const alias = join(aliasDir, 'pwsh.exe');
  try {
    if (!lstatSync(alias).isSymbolicLink()) return 'skipped (pwsh.exe is not a symlink)';
    accessSync(alias, constants.X_OK);
  } catch (error) {
    if (error.code === 'ENOENT') return 'skipped (pwsh.exe alias is absent)';
    if (error.code === 'EACCES') return 'skipped (pwsh.exe alias lacks X_OK access)';
    throw error;
  }

  process.env.PATH = aliasDir;
  process.env.PATHEXT = '.EXE';
  check(which('pwsh')?.toLowerCase(), alias.toLowerCase(), 'a launchable WindowsApps alias is discoverable');
  return 'checked';
}

export function runTest() {
  const originalPath = process.env.PATH;
  const originalPathExt = process.env.PATHEXT;
  const root = mkdtempSync(join(tmpdir(), 'proc-which-'));
  let assertions = 0;
  const check = (...args) => {
    assertions += 1;
    assert.equal(...args);
  };

  try {
    testPathCandidates(check, root);
    const aliasStatus = testStoreAlias(check);
    process.stdout.write(`proc.test: ok (${assertions} assertions; Store alias ${aliasStatus})\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`proc.test: failed: ${error.message}\n`);
    return 1;
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalPathExt === undefined) delete process.env.PATHEXT;
    else process.env.PATHEXT = originalPathExt;
    rmSync(root, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) process.exit(runTest());
