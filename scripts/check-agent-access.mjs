#!/usr/bin/env node
// Compare the declared agent access level for each fleet repository to the live
// protect-main ruleset, so a manual catalog edit and a manual ruleset edit cannot
// drift apart unnoticed. The declared level comes from repo-catalog/repos.json.
// The live approval count and the App bypass come from the GitHub API. The App id
// is 5181331, org simpsonm09-org.
//
// Usage:
//   node scripts/check-agent-access.mjs [--catalog <path>] [--org <owner>] [--app-id <id>] [--json]
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

// One repository's verdict. A null ruleset means the live read failed, which is
// drift: an unreadable ruleset cannot prove the declared level.
export function compare(repo, level, ruleset, appId) {
  if (ruleset === null) return { repo, level, ok: false, reason: 'cannot read the protect-main ruleset' };
  const approvals = approvalCount(ruleset);
  const expectedBypass = appBypassExpected(level);
  const hasBypass = appBypassPresent(ruleset, appId);
  if (approvals !== 1) {
    return { repo, level, approvals, hasBypass, ok: false, reason: `approval count is ${approvals}, expected 1` };
  }
  if (hasBypass !== expectedBypass) {
    const want = expectedBypass ? 'present' : 'absent';
    const got = hasBypass ? 'present' : 'absent';
    return { repo, level, approvals, hasBypass, ok: false, reason: `App bypass is ${got}, expected ${want} for ${level}` };
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
  const args = { catalog: undefined, org: DEFAULT_ORG, appId: DEFAULT_APP_ID, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--catalog') args.catalog = argv[(index += 1)];
    else if (arg === '--org') args.org = argv[(index += 1)];
    else if (arg === '--app-id') args.appId = Number(argv[(index += 1)]);
    else if (arg === '--json') args.json = true;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

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
