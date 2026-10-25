import { safeText, sha256, validateInput } from './receipt-validation.mjs';

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


