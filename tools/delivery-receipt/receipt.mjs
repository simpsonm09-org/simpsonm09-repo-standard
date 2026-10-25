import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { which } from '../../scripts/lib/proc.mjs';

const MAX_HASH_FILE_BYTES = 25 * 1024 * 1024;
const MAX_GIT_BUFFER_BYTES = MAX_HASH_FILE_BYTES + 1024 * 1024;
const MAX_METADATA_BUFFER_BYTES = 1024 * 1024;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const safeText = (value) => ({ present: typeof value === 'string' && value.length > 0, sha256: typeof value === 'string' && value.length > 0 ? sha256(Buffer.from(value, 'utf8')) : null });

function validatePathArray(paths, kind) {
  const messages = { source: ['proposed source paths must be an array', 'each proposed source path must be a valid string'], helper: ['installed helper paths must be an array', 'each installed helper path must be a valid string'] };
  if (!Array.isArray(paths)) throw new Error(messages[kind][0]);
  for (const item of paths) {
    const path = kind === 'source' && typeof item !== 'string' ? item?.path : item;
    if (typeof path !== 'string' || !path || path.length > 4096 || path.includes('\0')) throw new Error(messages[kind][1]);
  }
}

function validateToolInputs(tools) {
  if (!Array.isArray(tools)) throw new Error('tools must be an array');
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object' || (tool.name !== undefined && typeof tool.name !== 'string') || (tool.path !== undefined && typeof tool.path !== 'string')) throw new Error('each tool must have string name and path fields');
  }
}

function validatePathInputs(input) {
  validatePathArray(input.proposedSourcePaths ?? [], 'source');
  validatePathArray(input.installedHelperPaths ?? [], 'helper');
  validateToolInputs(input.tools ?? []);
}

function validateHashFields(input) {
  for (const [name, value] of Object.entries({
    'host observed input hash': input.hostObservedInputHash,
    'typed command hash': input.typedCommand?.sha256,
    'actual execution command hash': input.actualExecutionEvidence?.commandSha256,
    ...Object.fromEntries((input.proposedSourcePaths ?? []).map((item, index) => [`source ${index + 1} expected hash`, item.expectedCurrentHash])),
  })) {
    if (value !== undefined && value !== null && (typeof value !== 'string' || !/^[\da-f]{64}$/i.test(value))) throw new Error(`${name} must be a 64-character SHA-256 hex digest`);
  }
}

function validateExpectedHead(expectedHead) {
  if (expectedHead !== undefined && expectedHead !== null && expectedHead !== '' && (typeof expectedHead !== 'string' || !/^(?:[\da-f]{7,40})$/i.test(expectedHead))) throw new Error('expected head must be a 7 to 40 character hexadecimal Git object ID');
}

function validateTextFields(input) {
  for (const [name, value] of Object.entries({ expectedAccount: input.expectedAccount, account: input.observedAccountSnapshot?.account })) {
    if (value !== undefined && value !== null && typeof value !== 'string') throw new Error(`${name} must be a string`);
  }
  for (const value of [input.expectedRepository, input.expectedOrigin, input.expectedBranch, input.expectedAccount, input.plannedRoute, input.accountFolder, input.operation, input.actualExecutionEvidence?.route, input.actualExecutionEvidence?.provenance, input.observedAccountSnapshot?.provenance, input.externalDecision?.effectiveLevel, input.externalDecision?.level, input.externalDecision?.provenance, input.externalDecision?.scope]) {
    if (value !== undefined && value !== null && typeof value !== 'string') throw new Error('caller text fields must be strings');
  }
}

function validateInputBounds(input) {
  if ((input.proposedSourcePaths?.length ?? 0) > 50) throw new Error('at most 50 proposed source paths are allowed');
  if ((input.installedHelperPaths?.length ?? 0) > 20) throw new Error('at most 20 installed helper paths are allowed');
  if ((input.tools?.length ?? 0) > 30) throw new Error('at most 30 tools are allowed');
  if (input.typedCommand?.text !== undefined && typeof input.typedCommand.text !== 'string') throw new Error('typed command text must be a string');
  if ((input.typedCommand?.text?.length ?? 0) > 65536) throw new Error('typed command text exceeds 65536 characters');
}

function validateInput(input) {
  validatePathInputs(input);
  validateHashFields(input);
  validateExpectedHead(input.expectedHead);
  validateTextFields(input);
  validateInputBounds(input);
}

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

function fileState(path) {
  try {
    if (!existsSync(path)) return 'missing';
    const stat = statSync(path);
    if (!stat.isFile()) return 'missing';
    return stat.size > MAX_HASH_FILE_BYTES ? 'too-large' : 'present';
  } catch {
    return 'unreadable';
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

function hashFile(path, expectedCurrentHash, scope, repoRoot, runner = runGit) {
  const { absolute, relativePath, contained, displayPath } = pathInfo(path, repoRoot);
  const state = fileState(absolute);
  if (state !== 'present') return nonPresentFile(state, displayPath, relativePath, contained, expectedCurrentHash, scope, repoRoot, runner);
  let bytes;
  try {
    bytes = readFileSync(absolute);
  } catch {
    return unreadableFile(scope, displayPath, expectedCurrentHash, contained);
  }
  const workingTree = describeWorkingTree(bytes);
  const committed = contained ? readCommittedBlob(repoRoot, relativePath.split(sep).join('/'), runner) : { status: 'not-in-repository' };
  return {
    scope,
    path: displayPath,
    location: fileLocation(scope, contained),
    status: 'present',
    workingTree,
    committedNormalizedBlob: committed,
    expectedCurrentHash: expectedCurrentHash ?? null,
  };
}

function nonPresentFile(state, displayPath, relativePath, contained, expectedCurrentHash, scope, repoRoot, runner) {
  if (state === 'missing') {
    const committed = contained ? readCommittedBlob(repoRoot, relativePath.split(sep).join('/'), runner) : { status: 'not-in-repository' };
    return missingFile(scope, displayPath, expectedCurrentHash, committed, contained);
  }
  if (state === 'too-large') return { scope, path: displayPath, location: fileLocation(scope, contained), status: state, maxBytes: MAX_HASH_FILE_BYTES, workingTree: null, committedNormalizedBlob: { status: contained ? 'not-read' : 'not-in-repository' }, expectedCurrentHash: expectedCurrentHash ?? null };
  return unreadableFile(scope, displayPath, expectedCurrentHash, contained);
}

function unreadableFile(scope, displayPath, expectedCurrentHash, contained) {
  return { scope, path: displayPath, location: fileLocation(scope, contained), status: 'unreadable', workingTree: null, committedNormalizedBlob: { status: contained ? 'not-read' : 'not-in-repository' }, expectedCurrentHash: expectedCurrentHash ?? null };
}

export function describeWorkingTree(bytes) {
  const text = bytes.includes(0) ? null : decodeUtf8(bytes);
  const normalized = text === null ? null : Buffer.from(text.replace(/\r\n/g, '\n'));
  return { sha256: sha256(bytes), lfNormalizedSha256: normalized ? sha256(normalized) : null, lineEndings: lineEndings(bytes) };
}

function lineEndings(bytes) {
  if (bytes.includes(0)) return 'binary';
  const text = decodeUtf8(bytes);
  if (text === null) return 'non-utf8';
  if (!text.includes('\n')) return text.includes('\r') ? 'cr' : 'none';
  if (text.includes('\r\n')) return text.replace(/\r\n/g, '').includes('\n') ? 'mixed' : 'crlf';
  return text.includes('\r') ? 'mixed' : 'lf';
}

export function describeCommittedBlob(bytes, gitObjectId) {
  const text = bytes.includes(0) ? null : decodeUtf8(bytes);
  return {
    status: 'read',
    gitObjectId,
    sha256: sha256(bytes),
    lfNormalizedSha256: text === null ? null : sha256(Buffer.from(text.replace(/\r\n/g, '\n'))),
    lineEndings: lineEndings(bytes),
  };
}

function decodeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
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

function accountCheck(expected, observed) {
  if (!expected) return { status: 'unverified', reason: 'expected account was not supplied', expected: safeText(''), observed: safeText(observed?.account ?? ''), provenance: safeText(observed?.provenance ?? '') };
  if (!observed?.account || !observed?.provenance || observed.approved !== true || observed.sanitized !== true) return { status: 'unverified', reason: 'no approved sanitized native-auth snapshot was supplied', expected: safeText(expected), observed: safeText(observed?.account ?? ''), provenance: safeText(observed?.provenance ?? '') };
  return { status: expected.toLowerCase() === observed.account.toLowerCase() ? 'match' : 'mismatch', expected: safeText(expected), observed: safeText(observed.account), provenance: safeText(observed.provenance), source: 'caller-supplied' };
}

function commandEvidence(input) {
  const commandText = typeof input.typedCommand?.text === 'string' ? input.typedCommand.text : null;
  const computedHash = commandText === null ? null : sha256(Buffer.from(commandText, 'utf8'));
  const rawSuppliedHash = input.typedCommand?.sha256;
  const suppliedHash = typeof rawSuppliedHash === 'string' ? rawSuppliedHash.toLowerCase() : null;
  const typedHash = computedHash ?? suppliedHash;
  const suppliedHashMatchesText = rawSuppliedHash === undefined || rawSuppliedHash === null
    ? true
    : typeof rawSuppliedHash === 'string' && (computedHash === null || suppliedHash === computedHash);
  return { typedHash, suppliedHashMatchesText };
}

function observation(input, typedHash) {
  const hash = input.hostObservedInputHash ?? null;
  const status = !hash ? 'unobserved' : !typedHash ? 'unverified' : typedHash.toLowerCase() === hash.toLowerCase() ? 'match' : 'mismatch';
  return { status, sha256: hash, source: hash ? 'caller-supplied' : null };
}

function referenceCheck(expected, observed, caseInsensitive = false) {
  if (expected === undefined || expected === null || expected === '') return { status: 'not-requested' };
  if (!observed) return { status: 'unverified', expected: safeText(String(expected)), observed: safeText(observed ?? '') };
  const matches = caseInsensitive ? observed.toLowerCase().startsWith(String(expected).toLowerCase()) : observed === expected;
  return { status: matches ? 'match' : 'mismatch', expected: safeText(String(expected)), observed: safeText(String(observed)) };
}

function repositoryCheck(expected, expectedOrigin, repository) {
  if (!expected) return { status: 'unverified', reason: 'expected repository was not supplied' };
  const origin = repository.remotes.find((remote) => remote.name === 'origin');
  if (origin?.status !== 'read' || !origin.canonical) return { status: 'unverified', reason: 'origin identity is unavailable' };
  const target = String(expected).toLowerCase();
  const actualOrigin = origin.canonical.toLowerCase();
  const identifiers = { expected: safeText(String(expected)), expectedOrigin: safeText(expectedOrigin ?? ''), observedOrigin: safeText(origin.canonical) };
  if (expectedOrigin && actualOrigin !== String(expectedOrigin).toLowerCase()) return { status: 'mismatch', ...identifiers, matchedRemote: null };
  if (actualOrigin === target) return { status: 'match', ...identifiers, matchedRemote: 'origin', relationship: 'direct' };
  const upstream = repository.remotes.find((remote) => remote.name === 'upstream');
  if (expectedOrigin && upstream?.status === 'read' && upstream.canonical?.toLowerCase() === target) {
    return { status: 'match', ...identifiers, observedUpstream: safeText(upstream.canonical), matchedRemote: 'upstream', relationship: 'explicit-origin-upstream-pair' };
  }
  if (upstream?.status !== 'read' || !upstream.canonical) return { status: 'mismatch', ...identifiers, matchedRemote: null };
  return { status: 'mismatch', ...identifiers, observedUpstream: safeText(upstream.canonical), matchedRemote: null };
}

function decisionScopeMatch(decision, expectedRepository) {
  const supplied = typeof decision?.scope === 'string' ? decision.scope : null;
  if (!supplied || !expectedRepository) return { status: 'unverified', expected: safeText(expectedRepository ?? ''), supplied: safeText(supplied ?? '') };
  return { status: supplied.toLowerCase() === String(expectedRepository).toLowerCase() ? 'match' : 'mismatch', expected: safeText(String(expectedRepository)), supplied: safeText(supplied) };
}

function fullRequirementEvidenceStatus(standingOperation, scopeMatch, hasProvenance, reportedFull) {
  if (!standingOperation) return 'not-required';
  if (scopeMatch.status === 'mismatch') return 'mismatch';
  if (scopeMatch.status !== 'match' || !hasProvenance) return 'unverified';
  return reportedFull ? 'match' : 'mismatch';
}

function decisionEvidence(input, expectedRepository) {
  const decision = input.externalDecision ?? null;
  const standingOperation = ['publish', 'activate'].includes(String(input.operation ?? '').toLowerCase());
  const scopeMatch = decisionScopeMatch(decision, expectedRepository);
  const effectiveLevel = decision?.effectiveLevel ?? decision?.level ?? null;
  const reportedFull = effectiveLevel === 'full';
  const hasProvenance = typeof decision?.provenance === 'string' && decision.provenance.length > 0;
  return {
    effectiveLevel: effectiveLevel === null ? null : effectiveLevel === 'full' ? 'full' : 'other',
    provenance: safeText(typeof decision?.provenance === 'string' ? decision.provenance : ''),
    scope: safeText(typeof decision?.scope === 'string' ? decision.scope : ''),
    source: decision ? 'caller-supplied' : null,
    authority: 'unverified caller-supplied evidence; not an authorization decision',
    scopeMatch,
    standingPublishOrActivateRequiresFull: standingOperation,
    reportedFull,
    fullRequirementEvidenceStatus: fullRequirementEvidenceStatus(standingOperation, scopeMatch, hasProvenance, reportedFull),
  };
}

function actualExecutionEvidence(input, typedHash) {
  const supplied = input.actualExecutionEvidence;
  if (!supplied || typeof supplied !== 'object') return { status: 'unknown', route: safeText(''), commandSha256: null, provenance: safeText('') };
  const commandSha256 = typeof supplied.commandSha256 === 'string' ? supplied.commandSha256 : null;
  const provenance = typeof supplied.provenance === 'string' ? supplied.provenance : null;
  const commandMatch = !commandSha256 || !typedHash ? 'unverified' : commandSha256.toLowerCase() === typedHash.toLowerCase() ? 'match' : 'mismatch';
  return {
    status: provenance && commandMatch === 'match' ? 'caller-reported' : 'unverified',
    route: safeText(typeof supplied.route === 'string' ? supplied.route : ''),
    commandSha256,
    commandMatch,
    provenance: safeText(provenance ?? ''),
    source: 'caller-supplied',
  };
}

function collectStatus(name, status, mismatches, missing) {
  if (status === 'mismatch') mismatches.push(name);
  else if (['unverified', 'unobserved', 'missing', 'too-large', 'unreadable'].includes(status)) missing.push(name);
}

function collectOneSource(index, file, mismatches, missing) {
  const currentStatus = file.expectedHashStatus === 'mismatch' ? 'mismatch' : file.status === 'present' ? file.expectedHashStatus : file.status;
  collectStatus(`source-${index + 1}`, currentStatus, mismatches, missing);
  if (file.expectedHashStatus === 'not-provided') missing.push(`source-expected-hash-${index + 1}`);
  collectStatus(`source-blob-${index + 1}`, file.committedNormalizedBlob?.status ?? 'unverified', mismatches, missing);
}

function collectSourceStatuses(receipt, mismatches, missing) {
  for (const [index, file] of receipt.sourceFiles.entries()) collectOneSource(index, file, mismatches, missing);
  for (const [index, helper] of receipt.installedHelpers.entries()) collectStatus(`installed-helper-${index + 1}`, helper.status === 'present' ? helper.expectedHashStatus : helper.status, mismatches, missing);
  for (const [index, tool] of receipt.tools.entries()) collectStatus(`tool-${index + 1}`, tool.status === 'missing' ? 'mismatch' : tool.status === 'found' ? 'match' : 'unverified', mismatches, missing);
}

function assessEvidence(receipt) {
  const mismatches = [];
  const missing = [];
  const collect = (name, status) => collectStatus(name, status, mismatches, missing);
  collect('repository', receipt.repositoryMatch.status);
  collect('account', receipt.expectedAccount.status);
  collect('host-observation', receipt.hostObservation.status);
  collect('branch', receipt.expectedBranch.status);
  collect('head', receipt.expectedHead.status);
  if (!receipt.typedCommand.sha256) missing.push('typed-command-hash');
  if (!receipt.typedCommand.suppliedHashMatchesText) mismatches.push('typed-command-hash');
  if (receipt.execution.actual.status === 'unknown' || receipt.execution.actual.status === 'unverified') missing.push('actual-execution');
  if (receipt.execution.actual.commandMatch === 'mismatch') mismatches.push('actual-execution-command');
  if (receipt.externalDecision.standingPublishOrActivateRequiresFull) collect('external-decision', receipt.externalDecision.fullRequirementEvidenceStatus);
  collectSourceStatuses(receipt, mismatches, missing);
  const issues = [...new Set(mismatches)].slice(0, 100);
  const missingEvidence = [...new Set(missing)].slice(0, 100);
  const status = issues.length ? 'mismatch' : missingEvidence.length ? 'unverified' : 'consistent';
  return { evidenceStatus: status, consistency: { status, authority: 'caller-supplied evidence consistency only; no live verification or authorization', issues, missingEvidence, mismatchCount: mismatches.length, missingCount: missing.length } };
}

function evaluateHash(file) {
  const expectedHashStatus = !file.expectedCurrentHash ? 'not-provided'
    : file.status === 'too-large' ? 'unverified'
      : file.workingTree?.sha256?.toLowerCase() === file.expectedCurrentHash.toLowerCase() ? 'match' : 'mismatch';
  return { ...file, path: safeText(typeof file.path === 'string' ? file.path : ''), expectedCurrentHash: file.expectedCurrentHash ?? null, expectedHashStatus };
}

function safeTool(tool) {
  return { name: safeText(tool.name ?? ''), status: tool.status === 'found' ? 'found' : 'missing', version: { status: 'not-probed', reason: 'version commands are not run by the read-only receipt' } };
}

function safeRepository(repository) {
  return {
    identity: { name: safeText(repository.identity?.name ?? ''), canonical: safeText(repository.identity?.canonical ?? '') },
    head: safeText(repository.head ?? ''),
    branch: safeText(repository.branch ?? ''),
    remotes: repository.remotes.map((remote) => ({
      name: ['origin', 'upstream'].includes(remote.name) ? remote.name : 'other',
      canonical: safeText(remote.canonical ?? ''),
      status: remote.status === 'read' ? 'read' : 'unverified',
    })),
  };
}

// Pure evaluator: all Git, filesystem, and PATH reads happen in the collector below.
export function buildDeliveryReceipt(input, snapshot) {
  validateInput(input);
  const { typedHash, suppliedHashMatchesText } = commandEvidence(input);
  const expectedRepository = input.expectedRepository ?? null;
  const receipt = {
    schemaVersion: 1,
    kind: 'read-only-delivery-preflight-receipt',
    generatedAt: snapshot.generatedAt,
    repository: safeRepository(snapshot.repository),
    repositoryMatch: repositoryCheck(expectedRepository, input.expectedOrigin, snapshot.repository),
    expectedBranch: referenceCheck(input.expectedBranch, snapshot.repository.branch),
    expectedHead: referenceCheck(input.expectedHead, snapshot.repository.head, true),
    typedCommand: { sha256: typedHash, suppliedHashMatchesText },
    hostObservation: observation(input, typedHash),
    execution: {
      planned: { route: safeText(input.plannedRoute ?? ''), commandSha256: typedHash },
      actual: actualExecutionEvidence(input, typedHash),
    },
    expectedAccount: accountCheck(input.expectedAccount ?? (input.accountFolder ? String(input.accountFolder).split(/[\\/]/).filter(Boolean).at(-1) : null), input.observedAccountSnapshot ?? null),
    sourceFiles: (snapshot.sourceFiles ?? []).map(evaluateHash),
    installedHelpers: (snapshot.installedHelpers ?? []).map(evaluateHash),
    tools: (snapshot.tools ?? []).map(safeTool),
    externalDecision: decisionEvidence(input, expectedRepository),
    constraints: { typedCommandExecutedByReceipt: false, authenticationRead: false, secretsScanned: false, authorizationDecisionMade: false },
  };
  Object.assign(receipt, assessEvidence(receipt));
  return receipt;
}

export function collectReceiptSnapshot(input, root, options = {}) {
  validateInput(input);
  const absoluteRoot = resolve(root);
  const repo = repositorySnapshot(absoluteRoot, options.runGit ?? runGit);
  const sourceFiles = (input.proposedSourcePaths ?? []).map((item) => hashFile(item.path ?? item, item.expectedCurrentHash, 'proposed-source', repo.root, options.runGit ?? runGit));
  const installedHelpers = (input.installedHelperPaths ?? []).map((path) => hashFile(path, null, 'installed-helper', null, options.runGit ?? runGit));
  const tools = (input.tools ?? []).map(observeTool);
  return { generatedAt: options.generatedAt ?? new Date().toISOString(), repository: repo.repository, sourceFiles, installedHelpers, tools };
}

export function createReceipt(input, root, options = {}) {
  return buildDeliveryReceipt(input, collectReceiptSnapshot(input, root, options));
}

export function hashText(value) {
  return sha256(Buffer.from(value, 'utf8'));
}

export function gitBufferLimit() {
  return MAX_GIT_BUFFER_BYTES;
}
