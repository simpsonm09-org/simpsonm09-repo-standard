import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { which } from '../../scripts/lib/proc.mjs';
import { MAX_GIT_BUFFER_BYTES, MAX_HASH_FILE_BYTES, validateInput } from './receipt-validation.mjs';
import { describeCommittedBlob, describeWorkingTree } from './receipt-codec.mjs';

const MAX_METADATA_BUFFER_BYTES = 1024 * 1024;

function runGit(root, args, options = {}) {
  return spawnSync('git', args, {
    cwd: root,
    encoding: options.encoding ?? 'utf8',
    maxBuffer: options.maxBuffer ?? MAX_METADATA_BUFFER_BYTES,
    shell: false,
    windowsHide: true,
  });
}

function gitText(root, args, runner = runGit) {
  const result = runner(root, args);
  if (result.error || result.status !== 0) return { status: 'unreadable', value: null };
  return { status: 'read', value: result.stdout.trimEnd() };
}

function canonicalRepository(value) {
  const source = value.trim();
  try {
    const scp = source.match(/^(?:[^@/:]+@)?([^/:]+):(.+)$/);
    const url = new URL(source.includes('://') ? source : scp ? `https://${scp[1]}/${scp[2]}` : `https://${source}`);
    if (!url.hostname || url.protocol === 'file:' || url.search || url.hash) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    parts[parts.length - 1] = parts.at(-1).replace(/\.git$/i, '');
    const host = `${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ''}`;
    return `${host}/${parts.join('/')}`;
  } catch {
    return null;
  }
}

function repositorySnapshot(root, runner = runGit) {
  const top = gitText(root, ['rev-parse', '--show-toplevel'], runner);
  const head = gitText(root, ['rev-parse', 'HEAD'], runner);
  const branch = gitText(root, ['branch', '--show-current'], runner);
  const remoteNames = gitText(root, ['remote'], runner);
  if ([top, head, remoteNames].some((entry) => entry.status !== 'read') || !top.value || !head.value) {
    throw new Error('repo must be a readable Git working tree');
  }
  const canonicalRoot = resolve(top.value);
  if (!samePath(resolve(root), canonicalRoot)) throw new Error('--repo must name the Git working-tree root, not a subdirectory');
  const remotes = remoteNames.value.split(/\r?\n/).filter(Boolean).map((name) => {
    const result = gitText(root, ['remote', 'get-url', name], runner);
    const canonical = result.status === 'read' ? canonicalRepository(result.value) : null;
    return { name, canonical, status: canonical ? 'read' : 'unverified' };
  });
  const origin = remotes.find((remote) => remote.name === 'origin');
  return {
    root: canonicalRoot,
    repository: {
      identity: { name: origin?.canonical?.split('/').at(-1) ?? null, canonical: origin?.canonical ?? null },
      head: head.value,
      branch: branch.status === 'read' ? (branch.value || null) : null,
      remotes,
    },
  };
}

function samePath(left, right) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function pathInfo(path, repoRoot) {
  const absolute = resolve(repoRoot ?? process.cwd(), path);
  const relativePath = repoRoot ? relative(repoRoot, absolute) : null;
  const contained = relativePath !== null && relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
  const displayPath = contained ? relativePath.split(sep).join('/') : absolute.split(/[\\/]/).at(-1);
  return { absolute, relativePath, contained, displayPath };
}

function missingFile(scope, displayPath, expectedCurrentHash, committed, contained) {
  return { scope, path: displayPath, location: fileLocation(scope, contained), status: 'missing', workingTree: null, committedNormalizedBlob: committed, expectedCurrentHash: expectedCurrentHash ?? null };
}

function fileLocation(scope, contained) {
  if (scope !== 'proposed-source') return 'explicit-path';
  return contained ? 'within-repository' : 'outside-repository';
}

function fileState(path, statFile = statSync) {
  try {
    const stat = statFile(path);
    if (!stat.isFile()) return { status: 'missing' };
    return { status: stat.size > MAX_HASH_FILE_BYTES ? 'too-large' : 'present' };
  } catch (error) {
    return error?.code === 'ENOENT'
      ? { status: 'missing' }
      : { status: 'unreadable', reason: 'file-metadata-read-failed' };
  }
}

export function readCommittedBlob(repoRoot, gitPath, runner = runGit) {
  const ref = `HEAD:${gitPath}`;
  const exists = runner(repoRoot, ['cat-file', '-e', ref]);
  if (exists.error) return { status: 'unreadable', reason: 'git-object-check-failed' };
  if (exists.status !== 0) return { status: 'missing' };
  const object = runner(repoRoot, ['rev-parse', '--verify', ref]);
  if (object.error || object.status !== 0 || !object.stdout) return { status: 'unreadable', reason: 'git-object-id-unavailable' };
  const objectId = object.stdout.toString('utf8').trim();
  const size = runner(repoRoot, ['cat-file', '-s', objectId]);
  if (size.error || size.status !== 0 || !/^\d+\s*$/.test(size.stdout.toString('utf8'))) return { status: 'unreadable', reason: 'git-blob-size-unavailable' };
  if (Number(size.stdout.toString('utf8').trim()) > MAX_HASH_FILE_BYTES) return { status: 'too-large', maxBytes: MAX_HASH_FILE_BYTES };
  const blob = runner(repoRoot, ['cat-file', 'blob', objectId], { encoding: 'buffer', maxBuffer: MAX_GIT_BUFFER_BYTES });
  if (blob.error || blob.status !== 0) {
    const truncated = ['ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'ENOBUFS'].includes(blob.error?.code)
      || /maxbuffer/i.test(blob.error?.message ?? '')
      || (blob.stdout?.length ?? 0) >= MAX_GIT_BUFFER_BYTES;
    return { status: 'unreadable', reason: truncated ? 'truncated-at-buffer-limit' : 'git-blob-read-failed' };
  }
  if (blob.stdout.length > MAX_HASH_FILE_BYTES) return { status: 'too-large', maxBytes: MAX_HASH_FILE_BYTES };
  return { status: 'read', ...describeCommittedBlob(blob.stdout, objectId) };
}

function hashFile(file) {
  const { absolute, relativePath, contained, displayPath } = pathInfo(file.path, file.repoRoot);
  const state = fileState(absolute, file.statFile);
  if (state.status !== 'present') return nonPresentFile(file, state, { displayPath, relativePath, contained });
  let bytes;
  try {
    bytes = readFileSync(absolute);
  } catch {
    return unreadableFile(file, { displayPath, contained }, 'file-content-read-failed');
  }
  const workingTree = describeWorkingTree(bytes);
  const committed = contained ? readCommittedBlob(file.repoRoot, relativePath.split(sep).join('/'), file.runner) : { status: 'not-in-repository' };
  return {
    scope: file.scope,
    path: displayPath,
    location: fileLocation(file.scope, contained),
    status: 'present',
    workingTree,
    committedNormalizedBlob: committed,
    expectedCurrentHash: file.expectedCurrentHash ?? null,
  };
}

function nonPresentFile(file, state, path) {
  if (state.status === 'missing') {
    const committed = path.contained ? readCommittedBlob(file.repoRoot, path.relativePath.split(sep).join('/'), file.runner) : { status: 'not-in-repository' };
    return missingFile(file.scope, path.displayPath, file.expectedCurrentHash, committed, path.contained);
  }
  if (state.status === 'too-large') return { scope: file.scope, path: path.displayPath, location: fileLocation(file.scope, path.contained), status: state.status, maxBytes: MAX_HASH_FILE_BYTES, workingTree: null, committedNormalizedBlob: { status: path.contained ? 'not-read' : 'not-in-repository' }, expectedCurrentHash: file.expectedCurrentHash ?? null };
  return unreadableFile(file, path, state.reason);
}

function unreadableFile(file, path, reason) {
  return { scope: file.scope, path: path.displayPath, location: fileLocation(file.scope, path.contained), status: 'unreadable', reason, workingTree: null, committedNormalizedBlob: { status: path.contained ? 'not-read' : 'not-in-repository' }, expectedCurrentHash: file.expectedCurrentHash ?? null };
}

function observeTool(tool) {
  let found = false;
  try {
    found = tool.path ? existsSync(tool.path) && statSync(tool.path).isFile() : Boolean(which(tool.name));
  } catch {
    found = false;
  }
  return { name: tool.name, status: found ? 'found' : 'missing', version: { status: 'not-probed', reason: 'version commands are not run by the read-only receipt' } };
}

export function collectReceiptSnapshot(input, root, options = {}) {
  validateInput(input);
  const repo = repositorySnapshot(resolve(root), options.runGit ?? runGit);
  const runner = options.runGit ?? runGit;
  const collectFile = (path, scope, expectedCurrentHash, repoRoot) => hashFile({
    path,
    scope,
    expectedCurrentHash,
    repoRoot,
    runner,
    statFile: options.statFile,
  });
  const sourceFiles = (input.proposedSourcePaths ?? []).map((item) => collectFile(item.path ?? item, 'proposed-source', item.expectedCurrentHash, repo.root));
  const installedHelpers = (input.installedHelperPaths ?? []).map((path) => collectFile(path, 'installed-helper', null, null));
  const tools = (input.tools ?? []).map(observeTool);
  return { generatedAt: options.generatedAt ?? new Date().toISOString(), repository: repo.repository, sourceFiles, installedHelpers, tools };
}

