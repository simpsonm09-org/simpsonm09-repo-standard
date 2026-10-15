#!/usr/bin/env node
// Exercise PATH discovery without running any discovered command.

import assert from 'node:assert/strict';
import { accessSync, constants, lstatSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { isMain, which } from './lib/proc.mjs';

export function runTest() {
  const originalPath = process.env.PATH;
  const originalPathExt = process.env.PATHEXT;
  const root = mkdtempSync(join(tmpdir(), 'proc-which-'));
  const executable = process.platform === 'win32' ? 'candidate.exe' : 'candidate';
  const unusable = join(root, executable);

  try {
    mkdirSync(unusable);
    process.env.PATH = root;
    assert.equal(which('candidate'), null, 'a directory is not an executable');

    const empty = mkdtempSync(join(tmpdir(), 'proc-empty-'));
    try {
      process.env.PATH = empty;
      assert.equal(which('candidate'), null, 'an absent candidate is not found');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }

    if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
      const aliasDir = join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps');
      const alias = join(aliasDir, 'pwsh.exe');
      try {
        if (lstatSync(alias).isSymbolicLink()) {
          accessSync(alias, constants.X_OK);
          process.env.PATH = aliasDir;
          process.env.PATHEXT = '.EXE';
          assert.equal(which('pwsh')?.toLowerCase(), alias.toLowerCase(), 'a launchable WindowsApps alias is discoverable');
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    process.stdout.write('proc.test: ok (3 assertions; Store alias checked when available)\n');
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
