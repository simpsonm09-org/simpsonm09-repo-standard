#!/usr/bin/env node
import { runAislop } from './aislop.mjs';
import { EXIT } from './lib/exit.mjs';
import { isMain } from './lib/proc.mjs';
import { runLint } from './lint.mjs';
import { runSecretScan } from './secret-scan.mjs';
import { runSecurity } from './security.mjs';

const STEPS = [
  ['lint', runLint],
  ['aislop', runAislop],
  ['security', runSecurity],
  ['secret-scan', runSecretScan],
];

export function runVerify() {
  const results = [];
  let failed = false;
  for (const [id, step] of STEPS) {
    console.log(`verify: ${id}`);
    const code = step([]);
    results.push(`${id}=${code}`);
    if (code !== EXIT.OK) failed = true;
  }
  console.log(`verify: ${failed ? 'failed' : 'ok'} (${results.join(' ')})`);
  return failed ? EXIT.FAIL : EXIT.OK;
}

if (isMain(import.meta.url)) process.exit(runVerify());
