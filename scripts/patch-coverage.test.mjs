#!/usr/bin/env node
// Prove the patch-coverage parser and gate. On Windows some coverage emitters
// write `SF:` records with backslashes while `git diff` uses forward slashes,
// and the gate would then find no measured unit and pass vacuously. The matcher
// cases assert the match across both separators and keep the suffix match for
// absolute `SF:` paths. The parser and gate cases cover BRDA, both FN forms,
// the branch threshold, the missing-branch fallback, and advisory CRAP.
//
// Usage:
//   node scripts/patch-coverage.test.mjs
//
// Exits 0 when every assertion holds and 1 on the first failure.

import { EXIT } from './lib/exit.mjs';
import { isMain } from './lib/proc.mjs';
import { crapScore, evaluate, matchReport, parseLcov } from './patch-coverage.mjs';

function makeAsserter() {
  let count = 0;
  const assert = (condition, message) => {
    count += 1;
    if (!condition) throw new Error(message);
  };
  return { assert, total: () => count };
}

function gateOptions(overrides = {}) {
  return {
    lcov: 'coverage/lcov.info',
    mode: 'lines',
    threshold: 80,
    branchThreshold: 70,
    crap: false,
    allowMissingBranch: false,
    ...overrides,
  };
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
    assert(report.lines.get(12) === 1 && report.lines.get(13) === 0, `${name}: measured lines survive the match`);
  }
}

function testParsing(assert) {
  const text = [
    'SF:src/a.py',
    'FN:10,20,first',
    'FN:30,second',
    'FNDA:5,first',
    'FNDA:0,second',
    'DA:10,1',
    'DA:11,0',
    'BRDA:10,1,0,3',
    'BRDA:10,1,1,-',
    'BRDA:12,2,0,0',
    'end_of_record',
  ].join('\n');
  const record = parseLcov(text).get('src/a.py');
  assert(record.functions.length === 2, 'both FN forms parse');
  assert(record.functions[0].name === 'first' && record.functions[0].start === 10, 'the pytest FN form keeps start and name');
  assert(record.functions[1].name === 'second' && record.functions[1].start === 30, 'the vitest FN form keeps start and name');
  assert(record.functions[0].end === 29, 'a span ends before the next function');
  assert(record.functions[1].end === Number.POSITIVE_INFINITY, 'the last span runs to the end of the file');
  assert(record.functions[0].count === 5 && record.functions[1].count === 0, 'FNDA attaches by name');
  assert(record.branches.length === 3, 'BRDA records parse');
  assert(record.branches[0].block === 1 && record.branches[0].taken === 3, 'BRDA block and taken parse');
  assert(record.branches[1].taken === 0, 'an unexecuted branch marker becomes zero');
  assert(record.branches[2].line === 12, 'BRDA line parses');
  assert(record.lines.get(10) === 1 && record.lines.get(11) === 0, 'DA lines still parse');
}

function testBranchGate(assert) {
  const files = parseLcov('SF:src/a.js\nDA:10,1\nBRDA:10,0,0,1\nBRDA:10,0,1,0\nend_of_record\n');
  const changed = new Map([['src/a.js', new Set([10])]]);
  const strict = evaluate(gateOptions({ mode: 'branches', branchThreshold: 70 }), files, changed);
  assert(strict.code === EXIT.FAIL, 'branch coverage below the branch threshold fails');
  assert(strict.stdout.some((line) => line.includes('1/2 changed branches covered (50.0%)')), 'branch coverage is reported');
  const lenient = evaluate(gateOptions({ mode: 'branches', branchThreshold: 50 }), files, changed);
  assert(lenient.code === EXIT.OK, 'branch coverage at the threshold passes');
}

function testMissingBranch(assert) {
  const files = parseLcov('SF:src/a.js\nDA:10,1\nend_of_record\n');
  const changed = new Map([['src/a.js', new Set([10])]]);
  const strict = evaluate(gateOptions({ mode: 'branches' }), files, changed);
  assert(strict.code === EXIT.FAIL, 'branch mode without BRDA fails closed');
  assert(strict.stderr.some((line) => line.includes('branch data unavailable')), 'the failure names the missing branch data');
  const fallback = evaluate(gateOptions({ mode: 'branches', allowMissingBranch: true }), files, changed);
  assert(fallback.code === EXIT.OK, 'the fallback passes when the lines are covered');
  assert(fallback.stdout.some((line) => line.includes('degraded to line coverage')), 'the fallback degrades to line coverage');
  assert(fallback.stdout.some((line) => line.includes('CRAP unavailable')), 'the fallback reports CRAP unavailable');
  assert(fallback.stdout.some((line) => line.includes('1/1 changed lines covered')), 'the fallback still gates lines');
}

function testNoUnits(assert) {
  const files = parseLcov('SF:src/a.js\nDA:10,1\nend_of_record\n');
  const changed = new Map([['src/a.js', new Set([99])]]);
  const result = evaluate(gateOptions(), files, changed);
  assert(result.code === EXIT.OK, 'a change with no measured units passes');
  assert(result.stdout.some((line) => line.includes('no measured changed units')), 'the pass is reported');
}

function testCrap(assert) {
  const text = [
    'SF:src/a.js',
    'FN:10,f',
    'DA:10,1',
    'DA:11,1',
    'DA:12,0',
    'BRDA:10,0,0,1',
    'BRDA:11,1,0,1',
    'end_of_record',
  ].join('\n');
  const files = parseLcov(text);
  const record = files.get('src/a.js');
  // Two distinct blocks give CC 3, and 2 of 3 lines are covered.
  assert(Math.abs(crapScore(record, record.functions[0]) - 10 / 3) < 1e-9, 'CRAP uses the distinct blocks and span coverage');
  const changed = new Map([['src/a.js', new Set([11])]]);
  const result = evaluate(gateOptions({ crap: true }), files, changed);
  assert(result.stdout.some((line) => line.includes('CRAP 3.3 src/a.js:10 f (advisory)')), 'the gate reports advisory CRAP for a touched function');
}

// Run the suite and return an exit code, so the CLI and verify.mjs share one
// path. It never calls process.exit, so an import cannot end the caller.
export function runTest() {
  const { assert, total } = makeAsserter();
  try {
    testMatcher(assert);
    testParsing(assert);
    testBranchGate(assert);
    testMissingBranch(assert);
    testNoUnits(assert);
    testCrap(assert);
    process.stdout.write(`patch-coverage.test: ok (${total()} assertions)\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`patch-coverage.test: failed: ${error.message}\n`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exit(runTest());
