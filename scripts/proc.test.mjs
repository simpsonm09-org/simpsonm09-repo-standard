#!/usr/bin/env node
// Exercise PATH discovery without running any discovered command.

import assert from 'node:assert/strict';
import { accessSync, constants, lstatSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isMain, which } from './lib/proc.mjs';

function fakeFileSystem(entries) {
  const lookup = (candidate) => {
    if (!(candidate in entries)) {
      const error = new Error('not found');
      error.code = 'ENOENT';
      throw error;
    }
    const entry = entries[candidate];
    if (entry.statError) throw entry.statError;
    return { isFile: () => entry.file === true };
  };
  return {
    statSync: lookup,
    lstatSync(candidate) {
      const entry = entries[candidate];
      if (!entry) {
        const error = new Error('not found');
        error.code = 'ENOENT';
        throw error;
      }
      return { isSymbolicLink: () => entry.symlink === true };
    },
    accessSync(candidate, mode) {
      const entry = entries[candidate];
      if (!entry?.accessible || mode !== constants.X_OK) {
        const error = new Error('inaccessible');
        error.code = 'EACCES';
        throw error;
      }
    },
  };
}

function testLookupResults(check) {
  const fs = fakeFileSystem({
    '/first/tool': { file: true },
    '/second/tool': { file: true },
    '/second/tool.exe': { file: true },
  });
  const posix = { platform: 'linux', env: { PATH: '/first:/second' }, fs };
  check(which('tool', posix), '/first/tool', 'the first matching PATH entry wins');
  check(which('tool', { ...posix, env: { PATH: '' }, fs: fakeFileSystem({ tool: { file: true } }) }), null, 'an empty PATH entry is ignored');
  check(which('tool.exe', { ...posix, env: { PATH: '/first:/second' } }), '/second/tool.exe', 'an explicit extension is used as written');
}

function testWindowsAliasDecisions(check) {
  const alias = 'C:\\Apps\\pwsh.exe';
  const windows = { platform: 'win32', env: { PATH: 'C:\\Apps', PATHEXT: '.exe' } };
  check(which('pwsh.exe', { ...windows, fs: fakeFileSystem({ [alias]: { file: true } }) }), alias,
    'an explicit Windows extension is searched as written');
  check(which('pwsh', { ...windows, fs: fakeFileSystem({ [alias]: { statError: Object.assign(new Error('denied'), { code: 'EACCES' }), symlink: true, accessible: true } }) }), alias,
    'an accessible Windows symlink alias is discoverable after stat EACCES');
  check(which('pwsh', { ...windows, fs: fakeFileSystem({ [alias]: { statError: Object.assign(new Error('denied'), { code: 'EACCES' }), file: true, accessible: true } }) }), null,
    'a Windows EACCES regular file is not accepted as an alias');
  check(which('pwsh', { ...windows, fs: fakeFileSystem({ [alias]: { statError: Object.assign(new Error('denied'), { code: 'EACCES' }), symlink: true } }) }), null,
    'an inaccessible Windows symlink alias is not discoverable');
  check(which('pwsh', { ...windows, fs: fakeFileSystem({ [alias]: { statError: Object.assign(new Error('io'), { code: 'EIO' }), symlink: true, accessible: true } }) }), null,
    'a non-EACCES stat error does not use alias fallback');
}

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
    testLookupResults(check);
    testWindowsAliasDecisions(check);
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
