#!/usr/bin/env node
// Prove the required-check rules. A code repository reports coverage / coverage,
// and a records repository does not, so every required check has a job that reports
// it. Each rule gets a violating case that must report its named gap and a
// compliant case that must report nothing. The live ruleset is a fixture, so no
// API is called. The CLI cases run check-repo over throwaway repositories and read
// the committed exception file for the two records repositories.
//
// Usage:
//   node --test scripts/required.test.mjs
//
// Exits 0 when every assertion holds and 1 on the first failure.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkStandard } from './check-standard.mjs';
import { jobsCalling, parseJobs } from './lib/ci.mjs';
import { isMain } from './lib/proc.mjs';
import { COVERAGE_CONTEXT, expectedChecks, kindOf, recordsCoverageGaps, requiredGaps, rulesetGaps } from './lib/required.mjs';

const CHECK_REPO = fileURLToPath(new URL('./check-repo.mjs', import.meta.url));
const PIN = 'a'.repeat(40);
const RECORDS_REPO = 'simpsonm09-org/simpsonm09-repo-catalog';
const CODE_REPO = 'simpsonm09-org/simpsonm09-fixture-go';
const SHARED_JOBS = ['lint', 'aislop', 'security', 'standard'];
const BASE_LIVE = ['lint / flint', 'aislop / aislop', 'security / trivy', 'security / secrets', 'standard / standard', 'test'];

function makeAsserter() {
  let count = 0;
  const assert = (condition, message) => {
    count += 1;
    if (!condition) throw new Error(message);
  };
  return { assert, total: () => count };
}

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'required-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, ...rel.split('/'));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

const sharedUses = (name) => `simpsonm09-org/simpsonm09-repo-standard/.github/workflows/${name}.yml@${PIN}`;

// A ci.yml with the four shared jobs, a plain test job, and any extras. Each option
// changes one job so a case names the one thing it tests.
function ciText({ coverage = null, omit = [], testSuffixes = [] } = {}) {
  const blocks = SHARED_JOBS.filter((name) => !omit.includes(name)).map((name) => `  ${name}:\n    uses: ${sharedUses(name)}`);
  if (coverage !== null) blocks.push(`  coverage:\n    uses: ${coverage}`);
  if (!omit.includes('test')) blocks.push('  test:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: just test');
  for (const suffix of testSuffixes) blocks.push(`  test-${suffix}:\n    runs-on: windows-latest\n    steps:\n      - run: just test`);
  return ['name: ci', 'on:', '  pull_request:', 'jobs:', ...blocks, ''].join('\n');
}

const CODE_JUST = 'coverage:\n    node scripts/cover.mjs\n';

function repoWith(ci, justfile = '') {
  return fixture({ '.github/workflows/ci.yml': ci, justfile });
}

function gapsOf(root) {
  const gaps = checkStandard(root).gaps;
  rmSync(root, { recursive: true, force: true });
  return gaps;
}

function gapIds(root) {
  return gapsOf(root).map((gap) => gap.id);
}

function jobsOf(names) {
  return new Map(names.map((name) => [name, []]));
}

const CODE_JOBS = [...SHARED_JOBS, 'coverage', 'test'];
const RECORDS_JOBS = [...SHARED_JOBS, 'test'];

function testKindOf(assert) {
  const exceptions = [{ repo: RECORDS_REPO, checks: new Set(['ci/coverage']), reason: '', date: '' }];
  assert(kindOf(exceptions, RECORDS_REPO) === 'records', 'an excepted repository on ci/coverage is records');
  assert(kindOf(exceptions, CODE_REPO) === 'code', 'a repository with no exception is code');
  assert(kindOf(exceptions, null) === 'code', 'no repository identity is code');
  const other = [{ repo: RECORDS_REPO, checks: new Set(['community/LICENSE']), reason: '', date: '' }];
  assert(kindOf(other, RECORDS_REPO) === 'code', 'an exception on another check does not make a repository records');
}

function testExpectedChecks(assert) {
  assert(expectedChecks('code').includes(COVERAGE_CONTEXT), 'code expects coverage / coverage');
  assert(!expectedChecks('records').includes(COVERAGE_CONTEXT), 'records does not expect coverage / coverage');
  for (const kind of ['code', 'records']) {
    assert(expectedChecks(kind).includes('test'), `${kind} expects the test job`);
  }
}

function testRecordsCoverageGaps(assert) {
  const gaps = recordsCoverageGaps('records', true);
  assert(gaps.length === 1 && gaps[0].id === 'ci/coverage-unrequired', 'records that calls coverage is a gap');
  assert(recordsCoverageGaps('records', false).length === 0, 'records without a coverage call is clean');
  assert(recordsCoverageGaps('code', true).length === 0, 'code that calls coverage is clean');
}

function ids(gaps) {
  return gaps.map((gap) => gap.id);
}

function testLiveCodeRepository(assert) {
  const clean = requiredGaps({ kind: 'code', live: expectedChecks('code'), jobs: jobsOf(CODE_JOBS) });
  assert(clean.length === 0, `a code repository matching its kind: expected no gaps, got ${JSON.stringify(clean)}`);

  const missing = requiredGaps({ kind: 'code', live: BASE_LIVE, jobs: jobsOf(CODE_JOBS) });
  assert(ids(missing).join() === 'ruleset/required-missing', `a code repository without coverage required: got ${ids(missing)}`);
  assert(missing[0].message.includes(COVERAGE_CONTEXT), 'the missing gap names coverage / coverage');
}

function testLiveRecordsRepository(assert) {
  const clean = requiredGaps({ kind: 'records', live: BASE_LIVE, jobs: jobsOf(RECORDS_JOBS) });
  assert(clean.length === 0, `a records repository matching its kind: expected no gaps, got ${JSON.stringify(clean)}`);

  const noJob = requiredGaps({ kind: 'records', live: [...BASE_LIVE, COVERAGE_CONTEXT], jobs: jobsOf(RECORDS_JOBS) });
  assert(ids(noJob).join() === 'ruleset/required-no-job', `coverage required with no coverage job: got ${ids(noJob)}`);

  const unexpected = requiredGaps({ kind: 'records', live: [...BASE_LIVE, COVERAGE_CONTEXT], jobs: jobsOf([...RECORDS_JOBS, 'coverage']) });
  assert(ids(unexpected).join() === 'ruleset/required-unexpected', `coverage required on records with a job: got ${ids(unexpected)}`);
}

function testLiveExtraTestJob(assert) {
  const withJob = requiredGaps({ kind: 'code', live: [...expectedChecks('code'), 'test-node'], jobs: jobsOf([...CODE_JOBS, 'test-node']) });
  assert(withJob.length === 0, `a stable test-node job may be required: got ${JSON.stringify(withJob)}`);

  const withoutJob = requiredGaps({ kind: 'code', live: [...expectedChecks('code'), 'test-node'], jobs: jobsOf(CODE_JOBS) });
  assert(ids(withoutJob).join() === 'ruleset/required-no-job', `test-node required with no job: got ${ids(withoutJob)}`);
}

function testLiveNoJobForBaseCheck(assert) {
  const gaps = requiredGaps({ kind: 'code', live: expectedChecks('code'), jobs: jobsOf(['test', 'lint']) });
  assert(gaps.some((gap) => gap.id === 'ruleset/required-no-job'), 'a required check whose job is absent is a no-job gap');
}

function testTreeCoverageJob(assert) {
  const withCoverage = repoWith(ciText({ coverage: `${sharedUses('coverage')}` }), CODE_JUST);
  assert(!gapIds(withCoverage).some((id) => id === 'ci/coverage' || id === 'ci/coverage-recipe'),
    'a code repository with the coverage job and recipe reports no coverage gap');

  const missing = gapsOf(repoWith(ciText(), CODE_JUST));
  const coverageGap = missing.find((gap) => gap.id === 'ci/coverage');
  assert(coverageGap !== undefined, 'a code repository without a coverage job is a ci/coverage gap');
  assert(coverageGap.message.includes('cannot report'), 'the ci/coverage gap says the required check cannot report');

  const wrong = repoWith(ciText({ coverage: sharedUses('lint') }), CODE_JUST);
  assert(gapIds(wrong).includes('ci/coverage'), 'a coverage job that calls another workflow is a ci/coverage gap');
}

function testTreeSharedJobs(assert) {
  const noStandard = repoWith(ciText({ omit: ['standard'] }));
  assert(gapIds(noStandard).includes('ci/standard'), 'a missing standard job is a ci/standard gap, because standard / standard is required');
}

function testExtraTestJob(assert) {
  const withExtra = repoWith(ciText({ coverage: sharedUses('coverage'), testSuffixes: ['node'] }), CODE_JUST);
  const found = gapIds(withExtra);
  assert(!found.includes('ci/test') && !found.includes('ci/coverage'), 'a test-node job beside a plain test job adds no gap');
}

function testJobsCallingCoverage(assert) {
  const jobs = parseJobs(ciText({ coverage: sharedUses('coverage') }));
  assert(jobsCalling(jobs, 'coverage', false).join() === 'coverage', 'the coverage job is found through its pinned reference');
  assert(jobsCalling(parseJobs(ciText()), 'coverage', false).length === 0, 'no coverage job, no calls');

  const local = parseJobs(ciText({ coverage: './.github/workflows/coverage.yml' }));
  assert(jobsCalling(local, 'coverage', true).join() === 'coverage', 'a local reference counts in the standard repository');
  assert(jobsCalling(local, 'coverage', false).length === 0, 'a local reference does not count in another repository');
}

function testRulesetGaps(assert) {
  const live = (contexts) => ({
    rules: [{ type: 'required_status_checks', parameters: { required_status_checks: contexts.map((context) => ({ context })) } }],
  });
  const codeJobs = jobsOf(CODE_JOBS);
  assert(rulesetGaps(live(expectedChecks('code')), { kind: 'code', jobs: codeJobs }).length === 0,
    'a live ruleset matching the code kind is clean');
  const gaps = rulesetGaps({ rules: [] }, { kind: 'code', jobs: codeJobs });
  assert(gaps.length === expectedChecks('code').length && gaps.every((gap) => gap.id === 'ruleset/required-missing'),
    'a ruleset with no required checks is missing every expected check');
  const extra = rulesetGaps(live([...expectedChecks('code'), 'test-node']), { kind: 'code', jobs: jobsOf(CODE_JOBS) });
  assert(extra.length === 1 && extra[0].id === 'ruleset/required-no-job', 'a required test-node with no job is a no-job gap');
}

function runCheckRepo(root, repo) {
  return spawnSync(process.execPath, [CHECK_REPO, root, '--repo', repo, '--no-api'], { windowsHide: true, encoding: 'utf8' });
}

function testRecordsCli(assert) {
  const plain = repoWith(ciText());
  const plainResult = runCheckRepo(plain, RECORDS_REPO);
  rmSync(plain, { recursive: true, force: true });
  assert(plainResult.stdout.includes('  ci/coverage (2026-10-12)'), 'a records repository lists ci/coverage as excepted');
  assert(!plainResult.stdout.includes('gap ci/coverage:'), 'a records repository with no coverage job has no open ci/coverage gap');

  const calls = repoWith(ciText({ coverage: sharedUses('coverage') }), CODE_JUST);
  const callsResult = runCheckRepo(calls, RECORDS_REPO);
  rmSync(calls, { recursive: true, force: true });
  assert(callsResult.stdout.includes('gap ci/coverage-unrequired:'), 'a records repository that calls coverage has an open gap');
}

function testCodeCli(assert) {
  const missing = repoWith(ciText());
  const missingResult = runCheckRepo(missing, CODE_REPO);
  rmSync(missing, { recursive: true, force: true });
  assert(missingResult.stdout.includes('gap ci/coverage:'), 'a code repository without a coverage job has an open ci/coverage gap');

  const present = repoWith(ciText({ coverage: sharedUses('coverage') }), CODE_JUST);
  const presentResult = runCheckRepo(present, CODE_REPO);
  rmSync(present, { recursive: true, force: true });
  assert(!presentResult.stdout.includes('gap ci/coverage:'), 'a code repository with the coverage job has no ci/coverage gap');
  assert(!presentResult.stdout.includes('ci/coverage-unrequired'), 'a code repository is not flagged as records');
}

export function runTest() {
  const { assert, total } = makeAsserter();
  try {
    testKindOf(assert);
    testExpectedChecks(assert);
    testRecordsCoverageGaps(assert);
    testLiveCodeRepository(assert);
    testLiveRecordsRepository(assert);
    testLiveExtraTestJob(assert);
    testLiveNoJobForBaseCheck(assert);
    testRulesetGaps(assert);
    testTreeCoverageJob(assert);
    testTreeSharedJobs(assert);
    testExtraTestJob(assert);
    testJobsCallingCoverage(assert);
    testRecordsCli(assert);
    testCodeCli(assert);
    process.stdout.write(`required.test: ok (${total()} assertions)\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`required.test: failed: ${error.message}\n`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exit(runTest());
