#!/usr/bin/env node
// Print the ruleset payload for one repository. The committed protect-main ruleset
// is the base. Two things come from the repository: its kind decides whether the
// coverage check is required, and its agent access level decides the App bypass.
// On a merge or full repository the agent App joins the bypass list. The mode
// follows the level: pull_request lets the App land its own green pull requests,
// and always additionally lets a full repository push to main directly. See
// docs/governance.md.
//
// Usage:
//   node scripts/ruleset-payload.mjs <ruleset.json> --level <level> [--app-id <id>] [--repo <owner/name>]
//   node scripts/ruleset-payload.mjs --self-test

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadExceptions } from './lib/exceptions.mjs';
import { COVERAGE_CONTEXT, kindOf } from './lib/required.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXCEPTIONS = join(HERE, '..', 'docs', 'exceptions.json');

// The App bypass mode per level. A level absent from the table grants the App no
// bypass. pull_request and always are the two modes GitHub accepts for an
// Integration bypass actor, so the level picks between them.
const APP_BYPASS_MODE = { merge: 'pull_request', full: 'always' };

export function buildPayload(ruleset, level, appId, kind = 'covered') {
  const payload = JSON.parse(JSON.stringify(ruleset));
  if (payload.name !== 'protect-main') return payload;
  setCoverageContext(payload, kind);
  if (!appId || !APP_BYPASS_MODE[level]) return payload;
  const id = Number(appId);
  payload.bypass_actors = (payload.bypass_actors ?? []).filter(
    (actor) => !(actor.actor_type === 'Integration' && Number(actor.actor_id) === id),
  );
  payload.bypass_actors.push({ actor_id: id, actor_type: 'Integration', bypass_mode: APP_BYPASS_MODE[level] });
  return payload;
}

// The committed file lists the checks every repository reports. Only a covered
// repository also requires coverage, so the kind adds or removes that one context.
function setCoverageContext(payload, kind) {
  const rule = (payload.rules ?? []).find((entry) => entry.type === 'required_status_checks');
  if (!rule?.parameters) return;
  const others = (rule.parameters.required_status_checks ?? []).filter((entry) => entry.context !== COVERAGE_CONTEXT);
  rule.parameters.required_status_checks = kind === 'covered' ? [...others, { context: COVERAGE_CONTEXT }] : others;
}

function parseArgs(argv) {
  const args = { file: undefined, level: 'read', appId: undefined, repo: undefined, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--level') {
      index += 1;
      args.level = argv[index];
    } else if (arg === '--app-id') {
      index += 1;
      args.appId = argv[index];
    } else if (arg === '--repo') {
      index += 1;
      args.repo = argv[index];
    } else if (arg === '--self-test') args.selfTest = true;
    else if (!args.file) args.file = arg;
  }
  return args;
}

function selfTest() {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const base = { name: 'protect-main', bypass_actors: [{ actor_type: 'OrganizationAdmin', bypass_mode: 'pull_request' }] };

  const merge = buildPayload(base, 'merge', '5181331');
  assert(merge.bypass_actors.some((a) => a.actor_type === 'Integration' && a.actor_id === 5181331), 'merge adds the app');
  assert(merge.bypass_actors.some((a) => a.actor_type === 'OrganizationAdmin'), 'merge keeps the admin');
  assert(appMode(merge) === 'pull_request', 'merge bypass mode is pull_request');

  const full = buildPayload(base, 'full', '5181331');
  assert(appMode(full) === 'always', 'full bypass mode is always');

  assert(appMode(merge) !== appMode(full), 'merge and full modes differ');

  const propose = buildPayload(base, 'propose', '5181331');
  assert(appMode(propose) === undefined, 'propose omits the app');

  const noApp = buildPayload(base, 'merge', undefined);
  assert(appMode(noApp) === undefined, 'no app id omits the app');

  const tags = buildPayload({ name: 'protect-tags' }, 'merge', '5181331');
  assert(appMode(tags) === undefined, 'other rulesets are untouched');

  const idempotent = buildPayload(merge, 'merge', '5181331');
  assert(idempotent.bypass_actors.filter((a) => a.actor_type === 'Integration').length === 1, 'no duplicate app');
}

// The required contexts of the protect-main payload, in order.
function contextsOf(payload) {
  const rule = (payload.rules ?? []).find((entry) => entry.type === 'required_status_checks');
  return (rule?.parameters?.required_status_checks ?? []).map((entry) => entry.context);
}

function selfTestKinds() {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const base = {
    name: 'protect-main',
    rules: [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'lint / flint' }, { context: 'test' }] } }],
  };

  const covered = buildPayload(base, 'read', undefined, 'covered');
  assert(contextsOf(covered).includes(COVERAGE_CONTEXT), 'a covered repository requires coverage');
  assert(contextsOf(covered).includes('test'), 'a covered repository keeps the base checks');

  const uncovered = buildPayload(covered, 'read', undefined, 'uncovered');
  assert(!contextsOf(uncovered).includes(COVERAGE_CONTEXT), 'an uncovered repository does not require coverage');
  assert(contextsOf(uncovered).join(',') === 'lint / flint,test', 'an uncovered repository keeps exactly the base checks');

  assert(contextsOf(buildPayload(base, 'read', undefined)).includes(COVERAGE_CONTEXT),
    'without a kind the payload is for a covered repository');
  assert(contextsOf(buildPayload(covered, 'read', undefined, 'covered')).filter((c) => c === COVERAGE_CONTEXT).length === 1,
    'a covered repository never duplicates coverage');

  const tags = buildPayload({ name: 'protect-tags', rules: base.rules }, 'read', undefined, 'uncovered');
  assert(contextsOf(tags).includes(COVERAGE_CONTEXT) === false && contextsOf(tags).length === 2, 'protect-tags is untouched');
}

// The bypass mode the payload gives the App, or undefined when the App is absent.
// The self-test reads the mode, not just the actor, so a wrong mode is caught.
function appMode(payload) {
  return (payload.bypass_actors ?? []).find((actor) => actor.actor_type === 'Integration')?.bypass_mode;
}

function runSelfTest() {
  try {
    selfTest();
    selfTestKinds();
    process.stdout.write('ruleset-payload: self-test ok\n');
  } catch (error) {
    process.stderr.write(`ruleset-payload: self-test failed: ${error.message}\n`);
    process.exit(1);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    runSelfTest();
    return;
  }
  if (!args.file) {
    process.stderr.write('usage: ruleset-payload <ruleset.json> --level <level> [--app-id <id>] [--repo <owner/name>]\n');
    process.exit(2);
  }
  const ruleset = JSON.parse(readFileSync(args.file, 'utf8'));
  const kind = args.repo ? kindOf(loadExceptions(EXCEPTIONS), args.repo) : 'covered';
  process.stdout.write(`${JSON.stringify(buildPayload(ruleset, args.level, args.appId, kind), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
