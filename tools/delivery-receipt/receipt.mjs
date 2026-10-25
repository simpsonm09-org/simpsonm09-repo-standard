import { buildDeliveryReceipt } from './receipt-evaluator.mjs';
import { collectReceiptSnapshot, readCommittedBlob } from './receipt-collector.mjs';
import { describeCommittedBlob, describeWorkingTree } from './receipt-codec.mjs';
import { MAX_GIT_BUFFER_BYTES, sha256 } from './receipt-validation.mjs';

export { buildDeliveryReceipt, collectReceiptSnapshot, createReceipt, describeCommittedBlob, describeWorkingTree, hashText, gitBufferLimit, readCommittedBlob };

function createReceipt(input, root, options = {}) {
  return buildDeliveryReceipt(input, collectReceiptSnapshot(input, root, options));
}

function hashText(value) {
  return sha256(Buffer.from(value, 'utf8'));
}

function gitBufferLimit() {
  return MAX_GIT_BUFFER_BYTES;
}
