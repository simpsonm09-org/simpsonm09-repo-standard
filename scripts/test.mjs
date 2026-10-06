#!/usr/bin/env node
// Run every test suite and exit non-zero if any fails. One entry point so
// `just test`, the `mise` task, and verify.mjs all run the same set.
//
// Usage:
//   node scripts/test.mjs

import { EXIT } from './lib/exit.mjs';
import { isMain } from './lib/proc.mjs';
import { runTest as runAgentAccess } from './agent-access.test.mjs';
import { runTest as runPatchCoverage } from './patch-coverage.test.mjs';
import { runTest as runScripting } from './scripting.test.mjs';

const SUITES = [runAgentAccess, runPatchCoverage, runScripting];

export function runTests() {
  let failed = false;
  for (const suite of SUITES) {
    if (suite() !== EXIT.OK) failed = true;
  }
  return failed ? EXIT.FAIL : EXIT.OK;
}

if (isMain(import.meta.url)) process.exit(runTests());
