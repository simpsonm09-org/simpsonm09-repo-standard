#!/usr/bin/env node
// Prove the patch-coverage matcher is path-separator agnostic. On Windows some
// coverage emitters write `SF:` records with backslashes while `git diff` uses
// forward slashes, and the gate would then find no measured line and pass
// vacuously. These cases assert the match across both separators and keep the
// existing suffix match for absolute `SF:` paths.
//
// Usage:
//   node scripts/patch-coverage.test.mjs
//
// Exits 0 when every assertion holds and 1 on the first failure.

import { isMain } from './lib/proc.mjs';
import { matchReport, parseLcov } from './patch-coverage.mjs';

function makeAsserter() {
  let count = 0;
  const assert = (condition, message) => {
    count += 1;
    if (!condition) throw new Error(message);
  };
  return { assert, total: () => count };
}

// The changed path always arrives from `git diff` with forward slashes. The
// report name varies by emitter, so each case pairs one report name with the
// lines the matcher must return.
const CASES = [
  { name: 'backslash report matches a forward-slash path', sf: 'src\\Api\\Program.cs', rel: 'src/Api/Program.cs' },
  { name: 'forward-slash report matches a forward-slash path', sf: 'src/Api/Program.cs', rel: 'src/Api/Program.cs' },
  { name: 'absolute report still matches by its tail', sf: '/home/ci/src/Api/Program.cs', rel: 'src/Api/Program.cs' },
  { name: 'a different file does not match', sf: 'src\\Other\\Thing.cs', rel: 'src/Api/Program.cs', expectNull: true },
];

function testMatcher(assert) {
  for (const { name, sf, rel, expectNull } of CASES) {
    const files = parseLcov(`SF:${sf}\nDA:12,1\nDA:13,0\nend_of_record\n`);
    const report = matchReport(files, rel);
    if (expectNull) {
      assert(report === null, `${name}: expected no match`);
      continue;
    }
    assert(report !== null, `${name}: expected a match for ${sf}`);
    assert(report.get(12) === 1 && report.get(13) === 0, `${name}: measured lines survive the match`);
  }
}

// Run the suite and return an exit code, so the CLI and verify.mjs share one
// path. It never calls process.exit, so an import cannot end the caller.
export function runTest() {
  const { assert, total } = makeAsserter();
  try {
    testMatcher(assert);
    process.stdout.write(`patch-coverage.test: ok (${total()} assertions)\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`patch-coverage.test: failed: ${error.message}\n`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exit(runTest());
