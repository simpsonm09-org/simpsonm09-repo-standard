import { createHash } from 'node:crypto';

const MAX_HASH_FILE_BYTES = 25 * 1024 * 1024;
const MAX_GIT_BUFFER_BYTES = MAX_HASH_FILE_BYTES + 1024 * 1024;
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

export function validateInput(input) {
  validatePathInputs(input);
  validateHashFields(input);
  validateExpectedHead(input.expectedHead);
  validateTextFields(input);
  validateInputBounds(input);
}


export { MAX_HASH_FILE_BYTES, MAX_GIT_BUFFER_BYTES, safeText, sha256 };
