import { sha256 } from './receipt-validation.mjs';

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


