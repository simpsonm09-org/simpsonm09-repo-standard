#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from './lib/exit.mjs';
import { isMain } from './lib/proc.mjs';
import { checkScripting } from './lib/scripting.mjs';
import { checkEnv } from './lib/env.mjs';
import { checkSubprocess } from './lib/subprocess.mjs';
import { checkDocs, hasCoverageRecipe } from './lib/docs.mjs';
import { normalize, readText } from './lib/tree.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STANDARD_ROOT = resolve(HERE, '..');

export const REQUIRED_PATHS = [
  '.github/workflows/ci.yml',
  'mise.toml',
  'justfile',
  'trivy.yaml',
  '.aislop/config.yml',
  '.github/config/flint.toml',
  '.github/dependabot.yml',
  '.editorconfig',
  '.gitattributes',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CODEOWNERS',
  'SUPPORT.md',
  '.github/ISSUE_TEMPLATE/',
  '.github/pull_request_template.md',
];

export const COMMUNITY_PATHS = [
  'LICENSE',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SUPPORT.md',
  '.editorconfig',
  '.aislop/config.yml',
  '.github/pull_request_template.md',
  '.github/ISSUE_TEMPLATE/bug.yml',
  '.github/ISSUE_TEMPLATE/feature.yml',
  '.github/ISSUE_TEMPLATE/config.yml',
];

const SHARED_JOBS = ['lint', 'aislop', 'security'];
const STANDARD_REPO = 'simpsonm09-org/simpsonm09-repo-standard';
const SHA_PATTERN = /^[0-9a-fA-F]{40}$/;
const GROUPS = ['files', 'mise', 'ci', 'dependabot', 'community', 'docs', 'scripting', 'env', 'subprocess'];

function groupOf(id) {
  const slash = id.indexOf('/');
  return slash === -1 ? id : id.slice(0, slash);
}

function parseJobs(text) {
  const jobs = new Map();
  let inJobs = false;
  let current = null;
  for (const line of text.split('\n')) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    if (/^\S/.test(line)) {
      inJobs = false;
      continue;
    }
    const match = /^ {2}([A-Za-z0-9_.-]+):\s*$/.exec(line);
    if (match) {
      current = match[1];
      jobs.set(current, []);
      continue;
    }
    if (current) jobs.get(current).push(line);
  }
  return jobs;
}

function findUses(block) {
  for (const line of block) {
    const match = /^\s+uses:\s*(\S+)/.exec(line);
    if (match) return match[1].replace(/['"]/g, '');
  }
  return null;
}

function checkFiles(root, add) {
  for (const rel of REQUIRED_PATHS) {    const full = join(root, rel);
    if (!existsSync(full)) {
      add(`files/${rel.replace(/\/$/, '')}`, `missing required path ${rel}`);
      continue;
    }
    if (rel.endsWith('/') && !statSync(full).isDirectory()) {
      add(`files/${rel.replace(/\/$/, '')}`, `${rel} is not a directory`);
    }
  }
}

function checkMise(root, add) {
  const file = join(root, 'mise.toml');
  if (!existsSync(file)) return;
  if (!/^\s*"aqua:casey\/just"\s*=/m.test(normalize(readText(file)))) {
    add('mise/just-pin', 'mise.toml does not pin aqua:casey/just');
  }
}

function hasTestJob(root) {
  const dir = join(root, '.github', 'workflows');
  if (!existsSync(dir)) return false;
  for (const name of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(name)) continue;
    const jobs = parseJobs(normalize(readText(join(dir, name))));
    const block = jobs.get('test');
    if (block?.some((line) => /^\s+runs-on:/.test(line))) return true;
  }
  return false;
}

function checkCi(root, add) {
  const file = join(root, '.github/workflows/ci.yml');
  if (!existsSync(file)) return;
  const text = normalize(readText(file));
  const jobs = parseJobs(text);
  const isSelf = root === STANDARD_ROOT;
  const external = /^simpsonm09-org\/simpsonm09-repo-standard\/\.github\/workflows\/([a-z0-9-]+)\.yml@([0-9a-fA-F]{40})$/;
  const local = /^\.\/\.github\/workflows\/([a-z0-9-]+)\.yml$/;

  for (const job of SHARED_JOBS) checkSharedJob(job, jobs, external, local, isSelf, add);

  if (callsCoverage(jobs, external, local, isSelf) && !hasCoverageRecipe(root)) {
    add('ci/coverage-recipe', 'ci.yml calls the shared coverage workflow but justfile has no "coverage" recipe');
  }

  checkPins(text, add);

  if (!hasTestJob(root)) {
    add('ci/test', 'no "test" job that runs on a runner in .github/workflows');
  }
}

function checkSharedJob(job, jobs, external, local, isSelf, add) {
  const block = jobs.get(job);
  if (!block) {
    add(`ci/${job}`, `ci.yml has no "${job}" job`);
    return;
  }
  const uses = findUses(block);
  if (!uses) {
    add(`ci/${job}`, `job "${job}" does not call a reusable workflow`);
    return;
  }
  const externalMatch = external.exec(uses);
  const localMatch = local.exec(uses);
  if (externalMatch) {
    if (externalMatch[1] !== job) add(`ci/${job}`, `job "${job}" calls ${externalMatch[1]}.yml`);
  } else if (localMatch && isSelf) {
    if (localMatch[1] !== job) add(`ci/${job}`, `job "${job}" calls ${localMatch[1]}.yml`);
  } else {
    add(`ci/${job}`, `job "${job}" is not pinned to a 40-char repo-standard SHA (uses: ${uses})`);
  }
}

function callsCoverage(jobs, external, local, isSelf) {
  for (const block of jobs.values()) {
    const uses = findUses(block);
    if (!uses) continue;
    const externalMatch = external.exec(uses);
    const localMatch = local.exec(uses);
    if (externalMatch?.[1] === 'coverage' || (isSelf && localMatch?.[1] === 'coverage')) return true;
  }
  return false;
}

function checkPins(text, add) {
  for (const match of text.matchAll(/^\s*uses:\s*(\S+)/gm)) {
    const ref = match[1];
    if (!ref.includes(`${STANDARD_REPO}/`)) continue;
    const at = ref.lastIndexOf('@');
    if (at === -1 || !SHA_PATTERN.test(ref.slice(at + 1))) {
      add('ci/pin', `unpinned repo-standard reference ${ref}`);
    }
  }
}

function checkDependabot(root, add) {
  const file = join(root, '.github/dependabot.yml');
  if (!existsSync(file)) return;
  const text = normalize(readText(file)).replace(/\r\n/g, '\n');
  if (!/^\s*version:\s*["']?2["']?\s*$/m.test(text)) {
    add('dependabot/version', '.github/dependabot.yml must declare version: 2');
  }
  const blocks = text.split(/^\s*-\s*package-ecosystem:\s*/m).slice(1);
  if (blocks.length === 0) {
    add('dependabot/ecosystems', '.github/dependabot.yml declares no package ecosystem');
    return;
  }
  for (const block of blocks) {
    const name = block.split('\n')[0].replace(/["']/g, '').trim() || 'unknown';
    if (!/^\s*schedule:\s*$/m.test(block)) {
      add(`dependabot/${name}`, `package ecosystem ${name} has no schedule`);
    } else if (!/^\s*interval:\s*\S/m.test(block)) {
      add(`dependabot/${name}`, `package ecosystem ${name} has no schedule interval`);
    }
  }
  for (const match of text.matchAll(/^\s*(token|password):\s*(.+)$/gm)) {
    if (!match[2].includes('${{ secrets.')) {
      add('dependabot/secret', `${match[1]} must reference a secret, not an inline value`);
    }
  }
}

function checkCommunity(root, add) {
  for (const rel of COMMUNITY_PATHS) {
    const target = join(root, rel);
    const source = join(STANDARD_ROOT, rel);
    if (!existsSync(target)) {
      add(`community/${rel}`, `${rel} is missing`);
      continue;
    }
    if (!existsSync(source)) continue;
    const targetText = normalize(readText(target)).replace(/\r\n/g, '\n');
    const sourceText = normalize(readText(source)).replace(/\r\n/g, '\n');
    if (targetText !== sourceText) add(`community/${rel}`, `${rel} differs from repo-standard`);
  }
}

export { checkScripting, checkEnv };

export function checkStandard(root) {
  const repoRoot = resolve(root);
  const gaps = [];
  const add = (id, message) => gaps.push({ id, message });
  checkFiles(repoRoot, add);
  checkMise(repoRoot, add);
  checkCi(repoRoot, add);
  checkDependabot(repoRoot, add);
  checkCommunity(repoRoot, add);
  checkDocs(repoRoot, add);
  checkScripting(repoRoot, add);
  checkEnv(repoRoot, add);
  checkSubprocess(repoRoot, add);
  return { root: repoRoot, gaps };
}

function statusFor(gaps, group) {
  const count = gaps.filter((gap) => groupOf(gap.id) === group).length;
  return count === 0 ? 'ok' : `GAP(${count})`;
}

function printResult(result) {
  const label = basename(result.root) || result.root;
  const header = ['repo'.padEnd(30), ...GROUPS.map((group) => group.padEnd(11))].join('');
  const row = [label.padEnd(30), ...GROUPS.map((group) => statusFor(result.gaps, group).padEnd(11))].join('');
  process.stdout.write(`check-standard  ${result.root}\n`);
  process.stdout.write(`${header}\n${row}\n`);
  for (const gap of result.gaps) process.stdout.write(`  gap ${gap.id}: ${gap.message}\n`);
}

function parseArgs(argv) {
  if (argv.includes('-h') || argv.includes('--help')) return { help: true };
  const positional = argv.filter((arg) => arg !== '--' && !arg.startsWith('-'));
  return { help: false, root: positional[0] ?? '.' };
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('usage: node scripts/check-standard.mjs [repo-path]\n');
    process.exit(EXIT.OK);
  }
  const result = checkStandard(args.root);
  printResult(result);
  process.exit(result.gaps.length > 0 ? EXIT.FAIL : EXIT.OK);
}
