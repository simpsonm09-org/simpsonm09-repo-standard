// The required status checks by repository kind. check-standard, check-repo, and
// ruleset-payload read this one list, so they cannot disagree. The rule is in
// docs/governance.md under "Required checks".

import { findException } from './exceptions.mjs';

export const COVERAGE_CONTEXT = 'coverage / coverage';

// Every repository reports these, so every repository requires them.
export const BASE_CONTEXTS = Object.freeze([
  'lint / flint',
  'aislop / aislop',
  'security / trivy',
  'security / secrets',
  'standard / standard',
  'test',
]);

// A records repository declares itself with an exception on this check id, in
// docs/exceptions.json. Any other repository is a code repository.
export const RECORDS_EXCEPTION = 'ci/coverage';

const EXTRA_TEST_JOB = /^test-[A-Za-z0-9_-]+$/;

export function kindOf(exceptions, repo) {
  if (!repo) return 'code';
  return findException(exceptions, repo, RECORDS_EXCEPTION) ? 'records' : 'code';
}

export function expectedChecks(kind) {
  return kind === 'code' ? [...BASE_CONTEXTS, COVERAGE_CONTEXT] : [...BASE_CONTEXTS];
}

// The job that reports a required check. "lint / flint" is reported by the caller
// job "lint", and a bare name such as "test" or "test-node" is its own job.
export function jobOf(context) {
  return context.split(' / ')[0];
}

// Compare the checks a live ruleset requires with the checks the kind expects.
// `jobs` is the parsed ci.yml. The gap ids are the ones check-repo prints.
export function requiredGaps({ kind, live, jobs }) {
  const gaps = [];
  const expected = expectedChecks(kind);
  const required = new Set(live);
  for (const context of expected) {
    if (!required.has(context)) {
      gaps.push({ id: 'ruleset/required-missing', message: `${context} is expected for a ${kind} repository and is not required` });
    }
  }
  for (const context of live) {
    const job = jobOf(context);
    if (!jobs.has(job)) {
      gaps.push({ id: 'ruleset/required-no-job', message: `${context} is required, but ci.yml has no "${job}" job to report it` });
    } else if (!expected.includes(context) && !EXTRA_TEST_JOB.test(context)) {
      gaps.push({ id: 'ruleset/required-unexpected', message: `${context} is required, but a ${kind} repository does not require it` });
    }
  }
  return gaps;
}

// The gaps for one live protect-main ruleset, as the API returns it.
export function rulesetGaps(ruleset, { kind, jobs }) {
  const rule = (ruleset.rules ?? []).find((entry) => entry.type === 'required_status_checks');
  const live = (rule?.parameters?.required_status_checks ?? []).map((entry) => entry.context);
  return requiredGaps({ kind, live, jobs });
}

// A records repository that calls the coverage workflow runs a check nothing
// requires, so the job is noise at best and a broken recipe at worst.
export function recordsCoverageGaps(kind, callsCoverage) {
  if (kind !== 'records' || !callsCoverage) return [];
  return [
    {
      id: 'ci/coverage-unrequired',
      message: 'ci.yml calls the coverage workflow, but the exception file records this repository as having no code under test',
    },
  ];
}

export const COVERAGE_MISSING_MESSAGE =
  'ci.yml has no "coverage" job, so coverage / coverage cannot report. A repository with code under test calls the shared coverage workflow. A repository without code under test records that with an exception on ci/coverage in docs/exceptions.json';
