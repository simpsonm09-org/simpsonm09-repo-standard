#!/usr/bin/env node
// Print the ruleset payload for one repository. On a merge or full repository the
// agent App joins the bypass list with pull_request mode, so it can land its own
// green pull requests without gaining a direct push to main. See docs/governance.md.
//
// Usage:
//   node scripts/ruleset-payload.mjs <ruleset.json> --level <level> [--app-id <id>]
//   node scripts/ruleset-payload.mjs --self-test

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function buildPayload(ruleset, level, appId) {
  const payload = JSON.parse(JSON.stringify(ruleset));
  if (payload.name !== 'protect-main' || !appId || !['merge', 'full'].includes(level)) {
    return payload;
  }
  const id = Number(appId);
  payload.bypass_actors = (payload.bypass_actors ?? []).filter(
    (actor) => !(actor.actor_type === 'Integration' && Number(actor.actor_id) === id),
  );
  payload.bypass_actors.push({ actor_id: id, actor_type: 'Integration', bypass_mode: 'pull_request' });
  return payload;
}

function parseArgs(argv) {
  const args = { file: undefined, level: 'read', appId: undefined, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--level') args.level = argv[(index += 1)];
    else if (arg === '--app-id') args.appId = argv[(index += 1)];
    else if (arg === '--self-test') args.selfTest = true;
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

  const propose = buildPayload(base, 'propose', '5181331');
  assert(!propose.bypass_actors.some((a) => a.actor_type === 'Integration'), 'propose omits the app');

  const noApp = buildPayload(base, 'merge', undefined);
  assert(!noApp.bypass_actors.some((a) => a.actor_type === 'Integration'), 'no app id omits the app');

  const tags = buildPayload({ name: 'protect-tags' }, 'merge', '5181331');
  assert(!(tags.bypass_actors ?? []).some((a) => a.actor_type === 'Integration'), 'other rulesets are untouched');

  const idempotent = buildPayload(merge, 'merge', '5181331');
  assert(idempotent.bypass_actors.filter((a) => a.actor_type === 'Integration').length === 1, 'no duplicate app');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    try {
      selfTest();
      process.stdout.write('ruleset-payload: self-test ok\n');
    } catch (error) {
      process.stderr.write(`ruleset-payload: self-test failed: ${error.message}\n`);
      process.exit(1);
    }
    return;
  }
  if (!args.file) {
    process.stderr.write('usage: ruleset-payload <ruleset.json> --level <level> [--app-id <id>]\n');
    process.exit(2);
  }
  const ruleset = JSON.parse(readFileSync(args.file, 'utf8'));
  process.stdout.write(`${JSON.stringify(buildPayload(ruleset, args.level, args.appId), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
