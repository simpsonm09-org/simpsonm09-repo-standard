#!/usr/bin/env node
// Audit the scripting conformance of every immediate child repository in a
// directory and print one matrix. The default runs only the `scripting` group;
// --full runs every check-standard group. It reads files only and never runs
// repository code. Exits non-zero when any repository fails.
//
// Usage:
//   node scripts/audit-fleet.mjs <repos-dir> [--full]

import { existsSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { checkScripting, checkStandard } from './check-standard.mjs';
import { EXIT } from './lib/exit.mjs';
import { isMain } from './lib/proc.mjs';

const USAGE = `usage: node scripts/audit-fleet.mjs <repos-dir> [--full]

Runs the scripting conformance group over every immediate child repository and
prints one matrix of failing entries. With --full it runs every check-standard
group. Exits non-zero when any repository fails.
`;

function parseArgs(argv) {
  const options = { root: null, full: false, help: false };
  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') options.help = true;
    else if (arg === '--full') options.full = true;
    else if (options.root === null) options.root = arg;
  }
  return options;
}

// A repository has a root justfile. A workspace meta directory does not, so it
// is skipped rather than reported as a failing repository.
function childRepos(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'justfile')))
    .map((entry) => join(root, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function auditRepo(root, full) {
  if (full) return checkStandard(root).gaps;
  const gaps = [];
  checkScripting(root, (id, message) => gaps.push({ id, message }));
  return gaps;
}

function summarize(gaps) {
  const counts = new Map();
  for (const gap of gaps) counts.set(gap.id, (counts.get(gap.id) ?? 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function renderEntries(entries) {
  if (entries.length === 0) return '-';
  return entries.map(([id, count]) => (count > 1 ? `${id} x${count}` : id)).join(', ');
}

function printMatrix(rows, full) {
  const header = ['repo'.padEnd(38), 'failing entries'.padEnd(56), 'count'].join('');
  process.stdout.write(`audit-fleet  ${full ? 'check-standard' : 'scripting'}\n${header}\n`);
  for (const row of rows) {
    process.stdout.write(`${row.name.padEnd(38)}${renderEntries(row.entries).padEnd(56)}${row.count}\n`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(USAGE);
    process.exit(EXIT.OK);
  }
  if (options.root === null) {
    process.stderr.write(USAGE);
    process.exit(EXIT.USAGE);
  }
  const root = resolve(options.root);
  let rows;
  try {
    rows = childRepos(root).map((dir) => {
      const gaps = auditRepo(dir, options.full);
      return { name: basename(dir), entries: summarize(gaps), count: gaps.length };
    });
  } catch (error) {
    process.stderr.write(`audit-fleet: cannot audit ${root}: ${error.message}\n`);
    process.exit(EXIT.FAIL);
  }
  printMatrix(rows, options.full);
  const failed = rows.filter((row) => row.count > 0).length;
  process.stdout.write(`\nfleet: ${failed}/${rows.length} repositories failed\n`);
  process.exit(failed > 0 ? EXIT.FAIL : EXIT.OK);
}

if (isMain(import.meta.url)) main();
