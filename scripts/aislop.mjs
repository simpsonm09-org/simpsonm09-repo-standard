#!/usr/bin/env node
import { EXIT } from './lib/exit.mjs';
import { isMain, run, which } from './lib/proc.mjs';

// Keep this version in step with .github/workflows/aislop.yml.
const AISLOP_VERSION = '0.16.1';

export function runAislop() {
  if (!which('npx')) {
    console.log('skip: aislop needs npx. Install Node with npm.');
    return EXIT.OK;
  }
  return run('npx', ['--yes', `aislop@${AISLOP_VERSION}`, 'ci']);
}

if (isMain(import.meta.url)) process.exit(runAislop());
