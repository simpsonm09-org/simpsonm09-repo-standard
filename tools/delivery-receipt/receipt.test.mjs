#!/usr/bin/env node
// Focused read-only receipt contract and CLI fixtures; no proposed command is executed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildDeliveryReceipt, collectReceiptSnapshot, describeCommittedBlob, describeWorkingTree, hashText, readCommittedBlob } from './receipt.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = resolve(ROOT, 'tools/delivery-receipt/cli.mjs');
const repository = {
  identity: { name: 'repo-standard', canonical: 'github.com/simpsonm09/repo-standard' },
  head: 'c036a58763dec27e597871abff9ae9804f2c3f3a',
  branch: 'feat/delivery-preflight-receipt',
  remotes: [
    { name: 'origin', canonical: 'github.com/simpsonm09/repo-standard', url: 'https://github.com/simpsonm09/repo-standard.git', status: 'read' },
    { name: 'upstream', canonical: 'github.com/simpsonm09-org/repo-standard', url: 'https://github.com/simpsonm09-org/repo-standard.git', status: 'read' },
  ],
};
const fixtureBytes = readFileSync(resolve(ROOT, 'docs/definition-of-done.md'));
const fixtureHash = hashText(fixtureBytes.toString('utf8'));
const sourceEvidence = [{
  scope: 'proposed-source', path: 'docs/definition-of-done.md', location: 'within-repository', status: 'present',
  workingTree: describeWorkingTree(fixtureBytes),
  committedNormalizedBlob: { ...describeCommittedBlob(fixtureBytes, 'fixture-blob'), status: 'read' },
  expectedCurrentHash: fixtureHash,
}];
const snapshot = { generatedAt: '2026-10-25T00:00:00.000Z', repository, sourceFiles: sourceEvidence, installedHelpers: [], tools: [] };

function check(condition, message) {
  assert.ok(condition, message);
}

function makeInput(overrides = {}) {
  return {
    expectedRepository: 'github.com/simpsonm09-org/repo-standard',
    expectedOrigin: 'github.com/simpsonm09/repo-standard',
    expectedBranch: 'feat/delivery-preflight-receipt',
    expectedHead: 'c036a587',
    expectedAccount: 'simpsonm09',
    observedAccountSnapshot: { account: 'simpsonm09', approved: true, sanitized: true, provenance: 'fixture-native-auth-snapshot' },
    typedCommand: { text: 'publisher --source docs/definition-of-done.md' },
    hostObservedInputHash: hashText('publisher --source docs/definition-of-done.md'),
    actualExecutionEvidence: { route: 'release', commandSha256: hashText('publisher --source docs/definition-of-done.md'), provenance: 'fixture-reported-execution' },
    operation: 'publish',
    externalDecision: { effectiveLevel: 'full', provenance: 'fixture-resolver', scope: 'github.com/simpsonm09-org/repo-standard' },
    ...overrides,
  };
}

function runCli(input, repo = ROOT, options = []) {
  return spawnSync(process.execPath, [CLI, '--input', '-', '--repo', repo, ...options], {
    cwd: ROOT,
    input: JSON.stringify(input),
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
}

function testPureEvaluation() {
  const receipt = buildDeliveryReceipt(makeInput(), snapshot);
  check(receipt.sourceFiles[0].expectedHashStatus === 'match', 'a fresh source hash matches');
  check(receipt.sourceFiles[0].committedNormalizedBlob.gitObjectId === 'fixture-blob', 'committed blob identity stays separate from working-tree hash');
  check(receipt.repositoryMatch.status === 'match' && receipt.repositoryMatch.relationship === 'explicit-origin-upstream-pair', 'an explicit origin/upstream pair matches');
  check(receipt.expectedBranch.status === 'match' && receipt.expectedHead.status === 'match', 'expected branch and head are checked');
  check(receipt.externalDecision.reportedFull && receipt.externalDecision.scopeMatch.status === 'match', 'caller-reported full level is scoped to the expected repository');
  check(receipt.externalDecision.authority.includes('unverified caller-supplied'), 'external decision is not represented as observed authority');
  check(receipt.execution.actual.status === 'caller-reported', 'explicit actual-execution evidence keeps its caller provenance');
  check(receipt.evidenceStatus === 'consistent' && receipt.consistency.status === 'consistent', 'complete matching fixture evidence is summarized as consistent');
  check(receipt.constraints.typedCommandExecutedByReceipt === false && receipt.constraints.authorizationDecisionMade === false, 'evaluation makes no execution or authorization decision');

  const stale = buildDeliveryReceipt(makeInput(), { ...snapshot, sourceFiles: [{ ...sourceEvidence[0], expectedCurrentHash: '0'.repeat(64) }] });
  check(stale.evidenceStatus === 'mismatch' && stale.consistency.issues.includes('source-1'), 'stale source evidence affects the consistency summary');
  const wrongBranch = buildDeliveryReceipt(makeInput({ expectedBranch: 'main', expectedHead: 'badcafe' }), snapshot);
  check(wrongBranch.expectedBranch.status === 'mismatch' && wrongBranch.expectedHead.status === 'mismatch', 'wrong expected branch and head are mismatches');
  check(wrongBranch.evidenceStatus === 'mismatch', 'reference mismatches affect evidence status');

  const noOrigin = { ...repository, identity: { name: null, canonical: null }, remotes: [{ name: 'upstream', canonical: 'github.com/simpsonm09-org/repo-standard', status: 'read' }] };
  const folderNameCannotPass = buildDeliveryReceipt(makeInput({ expectedRepository: 'github.com/repo-standard', expectedOrigin: null }), { ...snapshot, repository: noOrigin });
  check(folderNameCannotPass.repositoryMatch.status === 'unverified', 'missing origin remains unverified despite a matching folder-like name');
  const wrongOriginGoodUpstream = { ...repository, remotes: [
    { name: 'origin', canonical: 'github.com/someone-else/fork', status: 'read' },
    { name: 'upstream', canonical: 'github.com/simpsonm09-org/repo-standard', status: 'read' },
  ] };
  const originMismatch = buildDeliveryReceipt(makeInput({ expectedOrigin: 'github.com/simpsonm09/expected-fork' }), { ...snapshot, repository: wrongOriginGoodUpstream });
  check(originMismatch.repositoryMatch.status === 'mismatch', 'a matching upstream cannot hide a mismatched origin');
  const unpairedUpstream = buildDeliveryReceipt(makeInput({ expectedOrigin: null }), { ...snapshot, repository: wrongOriginGoodUpstream });
  check(unpairedUpstream.repositoryMatch.status === 'mismatch', 'upstream is not accepted without the explicit expected-origin pair');

  const wrongDecisionScope = buildDeliveryReceipt(makeInput({ externalDecision: { effectiveLevel: 'full', provenance: 'fixture', scope: 'elsewhere/repo' } }), snapshot);
  check(wrongDecisionScope.externalDecision.reportedFull && wrongDecisionScope.externalDecision.scopeMatch.status === 'mismatch', 'full level with wrong scope is only caller-reported and mismatched');
  check(wrongDecisionScope.externalDecision.fullRequirementEvidenceStatus === 'mismatch' && wrongDecisionScope.evidenceStatus === 'mismatch', 'wrong decision scope fails evidence consistency');
  const noHost = buildDeliveryReceipt(makeInput({ hostObservedInputHash: null }), snapshot);
  check(noHost.hostObservation.status === 'unobserved' && noHost.evidenceStatus === 'unverified', 'missing host evidence remains unverified');
  const unknownExecution = buildDeliveryReceipt(makeInput({ actualExecutionEvidence: null }), snapshot);
  check(unknownExecution.execution.actual.status === 'unknown', 'actual execution remains unknown without external evidence');
  const hashCase = buildDeliveryReceipt(makeInput({ hostObservedInputHash: hashText('publisher --source docs/definition-of-done.md').toUpperCase() }), snapshot);
  check(hashCase.hostObservation.status === 'match', 'host hashes compare case-insensitively');
  const wrongTypedHash = buildDeliveryReceipt(makeInput({ typedCommand: { text: 'publisher', sha256: '0'.repeat(64) } }), snapshot);
  check(!wrongTypedHash.typedCommand.suppliedHashMatchesText && wrongTypedHash.evidenceStatus === 'mismatch', 'typed text/hash disagreement affects overall evidence status');
  check(receipt.consistency.authority.includes('caller-supplied'), 'consistency is explicitly labeled caller-supplied rather than live verification');
  assert.throws(() => buildDeliveryReceipt(makeInput({ hostObservedInputHash: 'publisher --token ghp_fixture' }), snapshot), /64-character SHA-256/);
  assert.throws(() => buildDeliveryReceipt(makeInput({ actualExecutionEvidence: { commandSha256: 12345 } }), snapshot), /64-character SHA-256/);
  assert.throws(() => buildDeliveryReceipt(makeInput({ expectedHead: 'c' }), snapshot), /7 to 40 character/);
  const gitlabIdentity = { ...repository, remotes: [{ name: 'origin', canonical: 'gitlab.example.net/simpsonm09/repo-standard', status: 'read' }] };
  const wrongHost = buildDeliveryReceipt(makeInput({ expectedRepository: 'github.com/simpsonm09/repo-standard', expectedOrigin: null }), { ...snapshot, repository: gitlabIdentity });
  check(wrongHost.repositoryMatch.status === 'mismatch', 'repository identity includes the remote host');
}

function testLargeBlobRead() {
  const content = Buffer.from('large-blob-fixture\n'.repeat(90000));
  const expected = createHash('sha256').update(content).digest('hex');
  let seenMaxBuffer = 0;
  const runner = (_root, args, options = {}) => {
    if (args[0] === 'cat-file' && args[1] === '-e') return { status: 0, stdout: '' };
    if (args[0] === 'rev-parse') return { status: 0, stdout: Buffer.from('fixture-large-blob\n') };
    if (args[0] === 'cat-file' && args[1] === '-s') return { status: 0, stdout: Buffer.from(String(content.length)) };
    if (args[0] === 'cat-file' && args[1] === 'blob') {
      seenMaxBuffer = options.maxBuffer;
      return { status: 0, stdout: content };
    }
    throw new Error(`unexpected git request: ${args.join(' ')}`);
  };
  const working = describeWorkingTree(content);
  const committed = readCommittedBlob('fixture-root', 'large.txt', runner);
  check(content.length > 1024 * 1024, 'large fixture exceeds the default one MiB process buffer');
  check(seenMaxBuffer >= content.length && seenMaxBuffer > 1024 * 1024, 'Git blob read uses an explicit bounded buffer above one MiB');
  check(working.sha256 === expected && committed.status === 'read' && committed.sha256 === expected, 'working-tree and committed blob hashes match the actual large fixture bytes');
  const missing = readCommittedBlob('fixture-root', 'missing.txt', () => ({ status: 1, stdout: '' }));
  check(missing.status === 'missing', 'a missing committed blob is distinct from a read error');
  const unreadable = readCommittedBlob('fixture-root', 'large.txt', (_root, args) => {
    if (args[0] === 'cat-file' && args[1] === '-e') return { status: 0, stdout: '' };
    if (args[0] === 'rev-parse') return { status: 0, stdout: Buffer.from('fixture-large-blob') };
    if (args[0] === 'cat-file' && args[1] === '-s') return { status: 0, stdout: Buffer.from('100') };
    return { status: 1, stdout: Buffer.alloc(0), error: Object.assign(new Error('buffer exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }) };
  });
  check(unreadable.status === 'unreadable' && unreadable.reason === 'truncated-at-buffer-limit', 'truncated Git blob output is reported as unreadable');
  const readError = readCommittedBlob('fixture-root', 'large.txt', (_root, args) => {
    if (args[0] === 'cat-file' && args[1] === '-e') return { status: 0, stdout: '' };
    if (args[0] === 'rev-parse') return { status: 0, stdout: Buffer.from('fixture-large-blob') };
    if (args[0] === 'cat-file' && args[1] === '-s') return { status: 0, stdout: Buffer.from('100') };
    return { status: 1, stdout: Buffer.alloc(0), error: Object.assign(new Error('read failed'), { code: 'EIO' }) };
  });
  check(readError.status === 'unreadable' && readError.reason === 'git-blob-read-failed', 'Git read errors remain distinct from missing blobs and truncation');
  for (const size of [25.5, 26, 30].map((value) => Math.floor(value * 1024 * 1024))) {
    let blobRead = false;
    const oversized = readCommittedBlob('fixture-root', 'oversized.bin', (_root, args) => {
      if (args[0] === 'cat-file' && args[1] === '-e') return { status: 0, stdout: '' };
      if (args[0] === 'rev-parse') return { status: 0, stdout: Buffer.from('fixture-oversized-blob') };
      if (args[0] === 'cat-file' && args[1] === '-s') return { status: 0, stdout: Buffer.from(String(size)) };
      if (args[0] === 'cat-file' && args[1] === 'blob') blobRead = true;
      throw new Error('oversized blob must not be read');
    });
    check(oversized.status === 'too-large' && !blobRead, `${size} byte committed blob is classified before reading`);
  }
}

function testFileMetadataFailures() {
  const inaccessiblePath = resolve(ROOT, 'docs/definition-of-done.md');
  const missingPath = '__delivery-receipt-metadata-control-missing__.md';
  const statFile = (path) => {
    if (path === inaccessiblePath) {
      const error = new Error('fixture path and operating-system detail must not escape');
      error.code = 'EACCES';
      throw error;
    }
    return statSync(path);
  };
  const input = { proposedSourcePaths: [inaccessiblePath, missingPath] };
  const collected = collectReceiptSnapshot(input, ROOT, { statFile, generatedAt: '2026-10-25T00:00:00.000Z' });
  const receipt = buildDeliveryReceipt(makeInput(input), collected);
  check(collected.sourceFiles[0].status === 'unreadable', 'metadata read failures remain explicitly unreadable');
  check(collected.sourceFiles[0].reason === 'file-metadata-read-failed', 'metadata failure exposes its fixed reason');
  check(!JSON.stringify(collected.sourceFiles[0]).includes('fixture path'), 'metadata failure omits raw errors and paths');
  check(receipt.sourceFiles[0].reason === 'file-metadata-read-failed' && !JSON.stringify(receipt.sourceFiles[0]).includes(inaccessiblePath), 'receipt preserves the fixed reason and hashes the requested path');
  check(receipt.evidenceStatus !== 'consistent', 'unreadable source evidence cannot produce a consistent receipt');
  check(collected.sourceFiles[1].status === 'missing' && collected.sourceFiles[1].reason === undefined, 'ENOENT remains a legitimate missing-file result');
}

function testCollectorAndCli() {
  const outsidePath = resolve(ROOT, '../../__delivery-receipt-outside-fixture__.txt');
  const input = makeInput({
    expectedRepository: null,
    expectedOrigin: null,
    expectedBranch: 'feat/delivery-preflight-receipt',
    expectedHead: 'c036a587',
    typedCommand: { text: 'publisher --token ghp_CredentialFixtureNeverPrint_123456789' },
    hostObservedInputBody: 'host-input-body-fixture-never-print',
    proposedSourcePaths: [
      { path: 'docs/definition-of-done.md', expectedCurrentHash: fixtureHash },
      { path: '__delivery-receipt-missing-fixture__.txt' },
      { path: outsidePath },
    ],
    tools: [{ name: 'missing-delivery-receipt-fixture' }],
    externalDecision: null,
  });
  const cli = runCli(input);
  check(cli.status === 0, 'CLI accepts valid stdin JSON');
  const output = JSON.parse(cli.stdout);
  check(output.repositoryMatch.status === 'unverified', 'CLI fixture does not depend on a particular origin remote');
  check(output.sourceFiles[0].workingTree.sha256 === fixtureHash && output.sourceFiles[0].committedNormalizedBlob.status === 'read', 'CLI hashes working-tree and committed source evidence');
  check(output.sourceFiles[1].status === 'missing', 'a missing explicit path is recorded');
  check(output.sourceFiles[2].location === 'outside-repository' && output.sourceFiles[2].committedNormalizedBlob.status === 'not-in-repository', 'an uncontained path is marked outside without committed lookup');
  check(output.tools[0].status === 'missing' && output.evidenceStatus === 'mismatch', 'missing tool and file affect consistency');
  check(!cli.stdout.includes('ghp_CredentialFixtureNeverPrint_123456789') && !cli.stdout.includes('host-input-body-fixture-never-print'), 'CLI output never includes command or host-input bodies');
  check(!JSON.stringify(output).includes('ghp_CredentialFixtureNeverPrint_123456789'), 'receipt contains only typed command hash');

  const subdirectory = runCli({ typedCommand: { text: 'data' } }, resolve(ROOT, 'tools'));
  check(subdirectory.status === 2 && subdirectory.stderr.includes('must name the Git working-tree root'), '--repo subdirectories are rejected clearly');
  const invalidOption = runCli({}, ROOT, ['--unsupported']);
  check(invalidOption.status === 2 && invalidOption.stderr.includes('unknown option'), 'CLI reports unsupported arguments with exit 2');
  const secretArg = runCli({}, ROOT, ['ghp_ArgumentFixtureNeverEchoed_123456789']);
  check(secretArg.status === 2 && !secretArg.stderr.includes('ghp_ArgumentFixtureNeverEchoed_123456789'), 'unknown argv contents are never echoed');
  const malformed = spawnSync(process.execPath, [CLI, '--input', '-', '--repo', ROOT], { cwd: ROOT, input: '{"typedCommand":{"text": ghp_MalformedFixtureNeverEchoed_123456789}}', encoding: 'utf8', shell: false, windowsHide: true });
  check(malformed.status === 2 && malformed.stderr.includes('input is not valid JSON') && !malformed.stderr.includes('ghp_MalformedFixtureNeverEchoed_123456789'), 'malformed JSON body text is never echoed');
  const arbitraryHash = runCli({ hostObservedInputHash: 'publisher --token ghp_HashFixtureNeverEchoed_123456789' });
  check(arbitraryHash.status === 2 && !arbitraryHash.stderr.includes('ghp_HashFixtureNeverEchoed_123456789'), 'invalid caller hash fields are rejected without echoing their values');
  const sourceMismatch = runCli({ proposedSourcePaths: [{ path: 'docs/definition-of-done.md', expectedCurrentHash: '0'.repeat(64) }] });
  check(sourceMismatch.status === 0 && JSON.parse(sourceMismatch.stdout).sourceFiles[0].expectedHashStatus === 'mismatch', 'CLI evaluates expected source hashes in the pure receipt evaluator');

  const markers = [
    'marker-expected-repository', 'marker-expected-origin', 'marker-expected-branch', 'marker-expected-account',
    'marker-account-folder', 'marker-observed-account', 'marker-account-provenance', 'marker-planned-route',
    'marker-actual-route', 'marker-actual-provenance', 'marker-decision-level', 'marker-decision-scope',
    'marker-decision-provenance', 'marker-operation', 'marker-source-path', 'marker-helper-path',
    'marker-tool-name', 'marker-tool-path', 'marker-command-body', 'marker-host-body',
  ];
  const markerText = (name) => markers.find((marker) => marker === name);
  const freeTextInput = makeInput({
    expectedRepository: markerText('marker-expected-repository'),
    expectedOrigin: markerText('marker-expected-origin'),
    expectedBranch: markerText('marker-expected-branch'),
    expectedAccount: markerText('marker-expected-account'),
    accountFolder: markerText('marker-account-folder'),
    observedAccountSnapshot: { account: markerText('marker-observed-account'), approved: true, sanitized: true, provenance: markerText('marker-account-provenance') },
    plannedRoute: markerText('marker-planned-route'),
    typedCommand: { text: markerText('marker-command-body') },
    hostObservedInputBody: markerText('marker-host-body'),
    actualExecutionEvidence: { route: markerText('marker-actual-route'), commandSha256: hashText(markerText('marker-command-body')), provenance: markerText('marker-actual-provenance') },
    externalDecision: { effectiveLevel: markerText('marker-decision-level'), scope: markerText('marker-decision-scope'), provenance: markerText('marker-decision-provenance') },
    operation: markerText('marker-operation'),
    proposedSourcePaths: [{ path: markerText('marker-source-path') }],
    installedHelperPaths: [markerText('marker-helper-path')],
    tools: [{ name: markerText('marker-tool-name'), path: markerText('marker-tool-path') }, { name: 'node', path: process.execPath }],
  });
  const freeTextCli = runCli(freeTextInput);
  check(freeTextCli.status === 0, 'CLI accepts synthetic caller free-text fields');
  const freeTextOutput = `${freeTextCli.stdout}\n${freeTextCli.stderr}`;
  check(markers.every((marker) => !freeTextOutput.includes(marker)), 'no caller free-text marker appears in CLI stdout or stderr');
  check(!freeTextOutput.includes(process.execPath), 'tool output omits absolute local paths');
  const outputSchema = JSON.parse(freeTextCli.stdout);
  check(outputSchema.execution.planned.route.sha256 && outputSchema.execution.actual.route.sha256, 'route values are represented by presence and SHA-256');
  check(outputSchema.externalDecision.effectiveLevel === 'other' && outputSchema.externalDecision.scope.sha256, 'decision level is closed and scope is hashed');

  const missingInput = spawnSync(process.execPath, [CLI, '--input', '__delivery-receipt-no-such-input-r4.json', '--repo', ROOT], { cwd: ROOT, encoding: 'utf8', shell: false, windowsHide: true });
  check(missingInput.status === 2 && missingInput.stderr.includes('input file could not be read') && !missingInput.stderr.includes(ROOT), 'input-file read failures use a fixed message without a local path');
  const badPath = runCli({ proposedSourcePaths: [12345] });
  check(badPath.status === 2 && badPath.stderr.includes('each proposed source path must be a valid string') && !badPath.stderr.includes('12345'), 'non-string source paths are rejected without echoing values');

  const remoteRunner = (_root, args) => {
    if (args.join(' ') === 'rev-parse --show-toplevel') return { status: 0, stdout: ROOT };
    if (args.join(' ') === 'rev-parse HEAD') return { status: 0, stdout: 'c036a58763dec27e597871abff9ae9804f2c3f3a' };
    if (args.join(' ') === 'branch --show-current') return { status: 0, stdout: 'fixture-branch' };
    if (args.join(' ') === 'remote') return { status: 0, stdout: 'origin' };
    if (args.join(' ') === 'remote get-url origin') return { status: 0, stdout: 'https://git.example.net:8443/group/nested/repository.git' };
    throw new Error('unexpected injected Git request');
  };
  const remoteSnapshot = collectReceiptSnapshot({}, ROOT, { runGit: remoteRunner, generatedAt: '2026-10-25T00:00:00.000Z' });
  const nestedRepo = buildDeliveryReceipt({ expectedRepository: 'git.example.net:8443/group/nested/repository' }, remoteSnapshot);
  const wrongNestedRepo = buildDeliveryReceipt({ expectedRepository: 'git.example.net:8443/other/nested/repository' }, remoteSnapshot);
  const wrongPort = buildDeliveryReceipt({ expectedRepository: 'git.example.net/group/nested/repository' }, remoteSnapshot);
  check(nestedRepo.repositoryMatch.status === 'match', 'remote identity retains the full nested path and port');
  check(wrongNestedRepo.repositoryMatch.status === 'mismatch' && wrongPort.repositoryMatch.status === 'mismatch', 'nested path and port differences fail repository matching');
  assert.deepEqual(nestedRepo.repository.remotes, [{
    name: 'origin',
    canonical: { present: true, sha256: hashText('git.example.net:8443/group/nested/repository') },
    status: 'read',
  }], 'receipt emits only the allowed hashed remote fields');
}

export function runTest() {
  testPureEvaluation();
  testLargeBlobRead();
  testFileMetadataFailures();
  testCollectorAndCli();
  process.stdout.write('delivery-receipt: focused fixtures passed\n');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = runTest();
