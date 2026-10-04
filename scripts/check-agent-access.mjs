#!/usr/bin/env node
// Compare the declared agent access level for each fleet repository to the live
// protect-main ruleset, so a manual catalog edit and a manual ruleset edit cannot
// drift apart unnoticed. The declared level comes from repo-catalog/repos.json.
// The live approval count and the App bypass come from the GitHub API. The App id
// is 5181331, org simpsonm09-org.
//
// Usage:
//   node scripts/check-agent-access.mjs [--catalog <path>] [--org <owner>] [--app-id <id>] [--json]
//   node scripts/check-agent-access.mjs --self-test
//
// It exits 0 when every repository matches, and 1 when any repository drifts.
// This is a local check; it is not wired into CI.

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CAPABILITIES, loadCatalog, loadCommittedCatalog, resolveLevel } from './agent-access.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_DIR = join(ROOT, '..', 'simpsonm09-repo-catalog');
const DEFAULT_CATALOG = join(CATALOG_DIR, 'repos.json');
const DEFAULT_ORG = 'simpsonm09-org';
const DEFAULT_APP_ID = 5181331;
const DEFAULT_BRANCH = 'main';

// The level grants the App a bypass on the protect-main ruleset exactly when it
// grants a merge. ruleset-payload.mjs holds the same mapping, so the check reads
// the capability table rather than repeating the level list.
export function appBypassExpected(level) {
  return (CAPABILITIES[level] ?? []).includes('mergePr');
}

// The bypass mode the level expects for the App, or null when the level grants no
// App bypass. A full repository pushes to main directly, so its mode is always; a
// merge repository lands its own pull requests, so its mode is pull_request. This
// is the same mapping ruleset-payload.mjs applies, kept in one place so the check
// and the payload cannot disagree.
export function expectedBypassMode(level) {
  if (level === 'full') return 'always';
  if (level === 'merge') return 'pull_request';
  return null;
}

// The ruleset rule carries the approval count; the default is 0 when absent.
export function approvalCount(ruleset) {
  const rule = (ruleset.rules ?? []).find((entry) => entry.type === 'pull_request');
  return rule?.parameters?.required_approving_review_count ?? 0;
}

export function appBypassPresent(ruleset, appId) {
  return (ruleset.bypass_actors ?? []).some(
    (actor) => actor.actor_type === 'Integration' && Number(actor.actor_id) === Number(appId),
  );
}

// The bypass mode the App carries on the ruleset, or null when the App is absent.
// Compare reads it, not just the actor, so a wrong mode is drift.
export function appBypassMode(ruleset, appId) {
  const actor = (ruleset.bypass_actors ?? []).find(
    (entry) => entry.actor_type === 'Integration' && Number(entry.actor_id) === Number(appId),
  );
  return actor ? actor.bypass_mode ?? null : null;
}

// One repository's verdict. A null ruleset means the live read failed, which is
// drift: an unreadable ruleset cannot prove the declared level.
export function compare(repo, level, ruleset, appId) {
  if (ruleset === null) return { repo, level, ok: false, reason: 'cannot read the protect-main ruleset' };
  const approvals = approvalCount(ruleset);
  const expectedBypass = appBypassExpected(level);
  const hasBypass = appBypassPresent(ruleset, appId);
  const wantMode = expectedBypassMode(level);
  const gotMode = appBypassMode(ruleset, appId);
  if (approvals !== 1) {
    return { repo, level, approvals, hasBypass, ok: false, reason: `approval count is ${approvals}, expected 1` };
  }
  if (hasBypass !== expectedBypass) {
    const want = expectedBypass ? 'present' : 'absent';
    const got = hasBypass ? 'present' : 'absent';
    return { repo, level, approvals, hasBypass, ok: false, reason: `App bypass is ${got}, expected ${want} for ${level}` };
  }
  if (gotMode !== wantMode) {
    return { repo, level, approvals, hasBypass, ok: false, reason: `App bypass mode is ${gotMode}, expected ${wantMode} for ${level}` };
  }
  return { repo, level, approvals, hasBypass, ok: true };
}

function ghJson(org, repo, path) {
  const out = execFileSync('gh', ['api', `repos/${org}/${repo}/${path}`], { encoding: 'utf8' });
  return JSON.parse(out);
}

function protectMain(org, repo, branch) {
  const list = ghJson(org, repo, `rulesets`);
  const summary = (Array.isArray(list) ? list : []).find((entry) => entry.name === 'protect-main');
  if (!summary) return null;
  const detail = ghJson(org, repo, `rulesets/${summary.id}`);
  // Unrelated ruleset revisions are ignored; the branch condition is the anchor.
  if (!(detail.conditions?.ref_name?.include ?? []).includes(`refs/heads/${branch}`)) return null;
  return detail;
}

function parseArgs(argv) {
  const args = { catalog: undefined, org: DEFAULT_ORG, appId: DEFAULT_APP_ID, json: false, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--catalog') args.catalog = argv[(index += 1)];
    else if (arg === '--org') args.org = argv[(index += 1)];
    else if (arg === '--app-id') args.appId = Number(argv[(index += 1)]);
    else if (arg === '--json') args.json = true;
    else if (arg === '--self-test') args.selfTest = true;
  }
  return args;
}

// The mode predicate and compare, over fixed rulesets, without the GitHub API. It
// proves the two drift directions the live check exists to catch: the mode differs
// from the level's expectation, and the App is present when the level forbids it.
function selfTest() {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const APP = 5181331;
  const rules = [{ type: 'pull_request', parameters: { required_approving_review_count: 1 } }];
  const withApp = (mode) => ({
    rules,
    bypass_actors: [
      { actor_type: 'OrganizationAdmin', bypass_mode: 'pull_request' },
      { actor_id: APP, actor_type: 'Integration', bypass_mode: mode },
    ],
  });

  assert(expectedBypassMode('full') === 'always', 'full expects mode always');
  assert(expectedBypassMode('merge') === 'pull_request', 'merge expects mode pull_request');
  for (const level of ['none', 'read', 'propose']) {
    assert(expectedBypassMode(level) === null, `${level} expects no app bypass`);
  }

  assert(appBypassMode(withApp('always'), APP) === 'always', 'reads the app mode');
  assert(appBypassMode({ rules }, APP) === null, 'no app reads as null mode');

  assert(compare('full', 'full', withApp('always'), APP).ok, 'full with always is clean');
  assert(compare('merge', 'merge', withApp('pull_request'), APP).ok, 'merge with pull_request is clean');

  const wrongFull = compare('full', 'full', withApp('pull_request'), APP);
  assert(!wrongFull.ok && wrongFull.reason.includes('pull_request') && wrongFull.reason.includes('always'),
    'full with pull_request is drift naming the modes');

  const wrongMerge = compare('merge', 'merge', withApp('always'), APP);
  assert(!wrongMerge.ok && wrongMerge.reason.includes('always') && wrongMerge.reason.includes('pull_request'),
    'merge with always is drift naming the modes');

  const proposeWithApp = compare('propose', 'propose', withApp('pull_request'), APP);
  assert(!proposeWithApp.ok && proposeWithApp.reason.includes('App bypass is present'),
    'propose with an app is drift');

  const missing = compare('full', 'full', { rules }, APP);
  assert(!missing.ok && missing.reason.includes('App bypass is absent'), 'full without an app is drift');
  assert(!compare('full', 'full', null, APP).ok, 'unreadable ruleset is drift');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    try {
      selfTest();
      process.stdout.write('check-agent-access: self-test ok\n');
    } catch (error) {
      process.stderr.write(`check-agent-access: self-test failed: ${error.message}\n`);
      process.exit(1);
    }
    return;
  }

  let catalog;
  try {
    catalog = args.catalog
      ? loadCatalog(args.catalog)
      : loadCommittedCatalog() ?? loadCatalog(DEFAULT_CATALOG);
  } catch {
    process.stderr.write('check-agent-access: cannot read the catalog\n');
    process.exit(2);
  }

  const rows = [];
  let drift = false;
  for (const entry of catalog.repos ?? []) {
    const resolved = resolveLevel(catalog, entry.name);
    let ruleset = null;
    try {
      ruleset = protectMain(args.org, entry.name, DEFAULT_BRANCH);
    } catch (error) {
      if (!args.json) process.stderr.write(`check-agent-access: cannot read ${entry.name} ruleset: ${error.message}\n`);
    }
    const row = compare(entry.name, resolved.level, ruleset, args.appId);
    rows.push(row);
    if (!row.ok) drift = true;
  }

  if (args.json) process.stdout.write(`${JSON.stringify({ org: args.org, appId: args.appId, rows }, null, 2)}\n`);
  else {
    for (const row of rows) {
      const status = row.ok ? 'ok' : `DRIFT: ${row.reason}`;
      process.stdout.write(`${row.repo}\tlevel=${row.level}\tapprovals=${row.approvals ?? '?'}\tappBypass=${row.hasBypass ?? '?'}\t${status}\n`);
    }
    process.stdout.write(`check-agent-access: ${drift ? 'drift' : 'clean'} (${rows.length} repositories)\n`);
  }
  process.exit(drift ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
