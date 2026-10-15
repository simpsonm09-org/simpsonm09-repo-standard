import { spawnSync } from 'node:child_process';
import * as nativeFs from 'node:fs';
import { constants } from 'node:fs';
import { posix, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';

const IS_WINDOWS = process.platform === 'win32';

export function isMain(metaUrl) {
  const entry = process.argv[1];
  return entry ? metaUrl === pathToFileURL(entry).href : false;
}

function isUsableCandidate(candidate, platform, fs) {
  try {
    return fs.statSync(candidate).isFile();
  } catch (error) {
    if (platform !== 'win32' || error.code !== 'EACCES') return false;
    try {
      if (!fs.lstatSync(candidate).isSymbolicLink()) return false;
      fs.accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      // A missing, inaccessible, or unusable alias is not on PATH.
      return false;
    }
  }
}

function findInDirectory(dir, command, extensions, platform, fs) {
  if (!dir) return null;
  const path = platform === 'win32' ? win32 : posix;
  for (const ext of extensions) {
    const candidate = path.join(dir, command + ext);
    if (isUsableCandidate(candidate, platform, fs)) return candidate;
  }
  return null;
}

export function which(command, options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const fs = options.fs ?? nativeFs;
  const pathExts = platform === 'win32'
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  const path = platform === 'win32' ? win32 : posix;
  const extensions = path.extname(command) ? [''] : pathExts;
  for (const dir of (env.PATH ?? '').split(platform === 'win32' ? ';' : ':')) {
    const candidate = findInDirectory(dir, command, extensions, platform, fs);
    if (candidate) return candidate;
  }
  return null;
}

// A .cmd or .bat shim cannot be spawned directly on Windows, so run it through
// cmd.exe. The bare command name is passed so cmd resolves it from PATH.
function spawnProcess(command, args, options) {
  const resolved = which(command);
  if (IS_WINDOWS && resolved && /\.(cmd|bat)$/i.test(resolved)) {
    const line = [command, ...args].join(' ');
    return spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
      ...options,
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
  }
  return spawnSync(resolved ?? command, args, { ...options, windowsHide: true, shell: false });
}

export function run(command, args = [], options = {}) {
  const result = spawnProcess(command, args, { cwd: options.cwd, stdio: 'inherit' });
  if (result.error) {
    process.stderr.write(`op: cannot run ${command}: ${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}

export function capture(command, args = [], options = {}) {
  const result = spawnProcess(command, args, { cwd: options.cwd, encoding: 'utf8' });
  return {
    status: result.error ? 127 : (result.status ?? 1),
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ?? null,
  };
}

export function skip(tool, hint) {
  process.stdout.write(`skip: ${tool} not found${hint ? ` (${hint})` : ''}\n`);
}
