#!/usr/bin/env node
// Prove each env convention rule against a throwaway fixture repository. Every
// rule gets a violating fixture that must report its named `env/<rule>` entry
// and a compliant fixture that must report nothing, so the assertions name the
// entry, not a count. The checker reads files only and never runs repo code.
//
// Usage:
//   node --test scripts/env.test.mjs
//
// Exits 0 when every assertion holds and 1 on the first failure.

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkEnv } from './check-standard.mjs';
import { isMain } from './lib/proc.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

function makeAsserter() {
  let count = 0;
  const assert = (condition, message) => {
    count += 1;
    if (!condition) throw new Error(message);
  };
  return { assert, total: () => count };
}

function fixture(files, { untracked = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'env-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, ...rel.split('/'));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  };
  git('init', '-q');
  git('add', '-f', '-A');
  if (untracked.length) git('rm', '--cached', '--', ...untracked);
  return root;
}

function idsFor(files, options) {
  const root = fixture(files, options);
  try {
    const ids = [];
    checkEnv(root, (id) => ids.push(id));
    return ids;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function expectEntry(assert, label, files, id) {
  const ids = idsFor(files);
  assert(ids.includes(id), `${label}: expected ${id}, got [${ids.join(', ')}]`);
}

function expectClean(assert, label, files) {
  const ids = idsFor(files);
  assert(ids.length === 0, `${label}: expected no gaps, got [${ids.join(', ')}]`);
}

function testNoTrigger(assert) {
  expectClean(assert, 'a gitignore without .env and no .worktreeinclude', {
    '.gitignore': 'node_modules/\n',
  });
  expectClean(assert, 'a negated .env is not ignored', { '.gitignore': '.env\n!.env\n' });
}

function testWorktreeinclude(assert) {
  expectEntry(assert, 'ignored .env without a .worktreeinclude', { '.gitignore': '.env\n' }, 'env/worktreeinclude');
  expectEntry(assert, 'an env convention without an ignore rule', {
    '.gitignore': 'node_modules/\n', '.worktreeinclude': '.env\n', '.env.example': 'KEY=value\n',
  }, 'env/worktreeinclude-path');
}

function testWorktreeincludePath(assert) {
  expectEntry(assert, 'a listed path .gitignore does not ignore', {
    '.gitignore': '.env\n',
    '.worktreeinclude': '.env\nother.txt\n',
  }, 'env/worktreeinclude-path');
  expectEntry(assert, 'a .worktreeinclude with no paths', {
    '.gitignore': '.env\n',
    '.worktreeinclude': '# the local env file\n',
  }, 'env/worktreeinclude-path');
}

function testExample(assert) {
  expectEntry(assert, 'listed .env without a sibling .env.example', {
    '.gitignore': '.env\n',
    '.worktreeinclude': '.env\n',
  }, 'env/example');
  expectEntry(assert, 'a sibling .env.example that .gitignore ignores', {
    '.gitignore': '.env*\n',
    '.worktreeinclude': '.env\n',
    '.env.example': 'KEY=value\n',
  }, 'env/example');
  const untrackedIds = idsFor({
    '.gitignore': '.env\n', '.worktreeinclude': '.env\n', '.env.example': 'KEY=value\n',
  }, { untracked: ['.env.example'] });
  assert(untrackedIds.includes('env/example'), `an untracked example must report env/example, got [${untrackedIds.join(', ')}]`);
}

function testCompliant(assert) {
  expectClean(assert, 'an ignored .env with a committed .env.example', {
    '.gitignore': '.env\n',
    '.worktreeinclude': '.env\n',
    '.env.example': 'KEY=value\n',
  });
}

function testNested(assert) {
  expectClean(assert, 'a nested .env and its sibling example', {
    '.gitignore': '.env\n',
    '.worktreeinclude': 'settings/.env\n',
    'settings/.env.example': 'KEY=value\n',
  });
}

function testTracked(assert) {
  for (const [path, files] of [
    ['.env', { '.gitignore': '.env\n', '.worktreeinclude': '.env\n', '.env.example': 'KEY=value\n', '.env': 'local\n' }],
    ['.env.local', { '.gitignore': '.env*\n', '.worktreeinclude': '.env.local\n', '.env.local.example': 'KEY=value\n', '.env.local': 'local\n' }],
    ['settings/.env.production', { '.gitignore': '.env*\n', '.worktreeinclude': 'settings/.env.production\n', 'settings/.env.production.example': 'KEY=value\n', 'settings/.env.production': 'local\n' }],
  ]) {
    const ids = idsFor(files);
    assert(ids.includes('env/tracked'), `tracked ${path}: expected env/tracked, got [${ids.join(', ')}]`);
  }
  const ids = idsFor({
    '.gitignore': '.env*\n', '.worktreeinclude': '.env\n', '.env.example': 'KEY=value\n',
  });
  assert(!ids.includes('env/tracked'), `tracked scaffold: got [${ids.join(', ')}]`);
  const uppercase = idsFor({
    '.gitignore': '.ENV\n', '.worktreeinclude': '.ENV\n', '.ENV.example': 'KEY=value\n', '.ENV': 'local\n',
  });
  assert(uppercase.includes('env/tracked'), `tracked uppercase .ENV: expected env/tracked, got [${uppercase.join(', ')}]`);
}

function testIndexFailure(assert) {
  const root = fixture({ '.gitignore': '.env\n', '.worktreeinclude': '.env\n', '.env.example': 'KEY=value\n' });
  try {
    rmSync(join(root, '.git', 'index'));
    mkdirSync(join(root, '.git', 'index'));
    const ids = [];
    checkEnv(root, (id) => ids.push(id));
    assert(ids.includes('env/index'), 'a real Git repository with an unreadable index must report env/index');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function testGitFailures(assert) {
  const root = fixture({ '.gitignore': '.env\n', '.worktreeinclude': '.env\n', '.env.example': 'KEY=value\n' });
  try {
    rmSync(join(root, '.git'), { recursive: true, force: true });
    writeFileSync(join(root, '.git'), 'gitdir: missing-worktree-metadata\n');
    const ids = [];
    checkEnv(root, (id) => ids.push(id));
    assert(ids.includes('env/index'), 'a broken .git pointer must report env/index');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function testIgnoreSources(assert) {
  const nestedNegation = idsFor({
    '.gitignore': '.env\n', '.worktreeinclude': 'settings/.env\n',
    '.env.example': 'KEY=value\n', 'settings/.gitignore': '.env\n!.env\n',
    'settings/.env.example': 'KEY=value\n',
  });
  assert(nestedNegation.includes('env/worktreeinclude-path'), `nested .gitignore negation must be respected, got [${nestedNegation.join(', ')}]`);

  const untrackedIgnore = idsFor({
    '.gitignore': '.env\n', '.worktreeinclude': '.env\n', '.env.example': 'KEY=value\n',
  }, { untracked: ['.gitignore'] });
  assert(untrackedIgnore.includes('env/ignore'), `an untracked repository .gitignore must not satisfy the rule, got [${untrackedIgnore.join(', ')}]`);

  const root = fixture({ '.gitignore': '', '.worktreeinclude': '.env\n', '.env.example': 'KEY=value\n' });
  const globalIgnore = join(root, 'outside', '.gitignore');
  mkdirSync(dirname(globalIgnore), { recursive: true });
  writeFileSync(globalIgnore, '.env\n');
  const names = ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'];
  const previous = names.map((name) => process.env[name]);
  try {
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'core.excludesFile';
    process.env.GIT_CONFIG_VALUE_0 = globalIgnore;
    const ids = [];
    checkEnv(root, (id) => ids.push(id));
    assert(ids.includes('env/ignore'), `a global file named .gitignore must not satisfy the rule, got [${ids.join(', ')}]`);
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
    rmSync(root, { recursive: true, force: true });
  }
}

function runGit(args, cwd, input) {
  const result = spawnSync('git', args, { cwd, input, windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(result.stderr ?? '').trim()}`);
  return result.stdout ?? '';
}

function testPrePush(assert) {
  const base = mkdtempSync(join(tmpdir(), 'env-push-'));
  const standard = join(base, 'simpsonm09-repo-standard');
  const clone = join(base, 'fixture-clone');
  const bare = join(base, 'personal-fork.git');
  try {
    mkdirSync(join(standard, 'scripts'), { recursive: true });
    mkdirSync(join(standard, 'scripts', 'lib'), { recursive: true });
    writeFileSync(join(standard, 'scripts', 'lib', 'env-pre-push.mjs'), readFileSync(join(ROOT, 'lib', 'env-pre-push.mjs')));
    writeFileSync(join(standard, 'scripts', 'lib', 'env-path.mjs'), readFileSync(join(ROOT, 'lib', 'env-path.mjs')));
    runGit(['init', '--bare', '-q', bare], base);
    runGit(['-c', 'init.defaultBranch=main', 'init', '-q', clone], base);
    runGit(['config', 'user.email', 'fixture@example.invalid'], clone);
    runGit(['config', 'user.name', 'Fixture'], clone);
    runGit(['remote', 'add', 'origin', bare], clone);
    writeFileSync(join(clone, 'ordinary.txt'), 'safe\n');
    runGit(['add', 'ordinary.txt'], clone);
    runGit(['commit', '-m', 'safe base'], clone);
    const safeCommit = runGit(['rev-parse', 'HEAD'], clone).trim();
    const hook = join(clone, '.git', 'hooks', 'pre-push');
    writeFileSync(hook, readFileSync(join(ROOT, '..', 'templates', 'hooks', 'pre-push')));
    chmodSync(hook, 0o755);

    const push = (source, destination, expected, label) => {
      const result = spawnSync('git', ['push', 'origin', `${source}:refs/heads/${destination}`], { cwd: clone, windowsHide: true, encoding: 'utf8' });
      assert((result.status === 0) === expected, `${label}: expected ${expected ? 'allowed' : 'rejected'}, got ${(result.stderr ?? '').trim()}`);
      const advertised = runGit(['ls-remote', '--heads', 'origin', `refs/heads/${destination}`], clone).trim();
      assert(Boolean(advertised) === expected, `${label}: remote ref ${expected ? 'should exist' : 'must not be created'}`);
    };
    push('main', 'main', true, 'ordinary change to personal fork');

    writeFileSync(join(clone, '.env'), 'LOCAL=value\n');
    runGit(['add', '-f', '.env'], clone);
    runGit(['commit', '-m', 'add env'], clone);
    const envCommit = runGit(['rev-parse', 'HEAD'], clone).trim();
    runGit(['tag', 'env-tag', envCommit], clone);
    push('refs/tags/env-tag', 'tag-env', false, 'tag source containing env is blocked');
    push(envCommit, 'raw-sha-env', false, 'raw object id source containing env is blocked');
    runGit(['update-ref', 'refs/remotes/origin/env-tracking', envCommit], clone);
    push('refs/remotes/origin/env-tracking', 'remote-tracking-env', false, 'remote-tracking ref source containing env is blocked');
    rmSync(join(clone, '.env'));
    runGit(['add', '-u'], clone);
    runGit(['commit', '-m', 'delete env'], clone);
    push('main', 'main-env-added-deleted', false, 'env added then deleted remains blocked');

    runGit(['checkout', '-b', 'merged-env-history', safeCommit], clone);
    writeFileSync(join(clone, '.env'), 'LOCAL=value\n');
    runGit(['add', '-f', '.env'], clone);
    runGit(['commit', '-m', 'side branch add env'], clone);
    rmSync(join(clone, '.env'));
    runGit(['add', '-u'], clone);
    runGit(['commit', '-m', 'side branch delete env'], clone);
    runGit(['checkout', '-b', 'merge-env-history', safeCommit], clone);
    runGit(['merge', '--no-ff', '-m', 'merge side history', 'merged-env-history'], clone);
    push('merge-env-history', 'merged-side-env', false, 'merged side branch env history is blocked');

    runGit(['checkout', 'main'], clone);
    runGit(['reset', '--hard', safeCommit], clone);
    runGit(['read-tree', 'HEAD'], clone);
    const envBlob = runGit(['hash-object', '-w', '--stdin'], clone, 'LOCAL=value\n').trim();
    runGit(['update-index', '--add', '--cacheinfo', `100644,${envBlob},.env`], clone);
    const mergeTree = runGit(['write-tree'], clone).trim();
    const safeTree = runGit(['rev-parse', `${safeCommit}^{tree}`], clone).trim();
    const otherParent = runGit(['commit-tree', safeTree, '-p', safeCommit, '-m', 'second clean parent'], clone).trim();
    const mergeOnlyEnv = runGit(['commit-tree', mergeTree, '-p', safeCommit, '-p', otherParent, '-m', 'merge-only env addition'], clone).trim();
    push(mergeOnlyEnv, 'merge-commit-env', false, 'env introduced by merge commit is blocked');
    runGit(['read-tree', safeCommit], clone);

    runGit(['checkout', '-b', 'uppercase'], clone);
    mkdirSync(join(clone, 'nested'), { recursive: true });
    writeFileSync(join(clone, 'nested', '.ENV.local'), 'LOCAL=value\n');
    runGit(['add', '-f', 'nested/.ENV.local'], clone);
    runGit(['commit', '-m', 'uppercase env'], clone);
    push('uppercase', 'uppercase', false, 'nested uppercase env is blocked');

    runGit(['checkout', 'main'], clone);
    runGit(['reset', '--hard', safeCommit], clone);
    writeFileSync(join(clone, '.env.example'), 'KEY=value\n');
    runGit(['add', '.env.example'], clone);
    runGit(['commit', '-m', 'example only'], clone);
    push('main', 'main-example-only', true, 'example file is allowed');
    const deletion = spawnSync('git', ['push', 'origin', ':refs/heads/main'], { cwd: clone, windowsHide: true, encoding: 'utf8' });
    assert(deletion.status === 0, `deletion ref is allowed, got ${(deletion.stderr ?? '').trim()}`);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

export function runTest() {
  const { assert, total } = makeAsserter();
  try {
    testNoTrigger(assert);
    testWorktreeinclude(assert);
    testWorktreeincludePath(assert);
    testExample(assert);
    testCompliant(assert);
    testNested(assert);
    testTracked(assert);
    testIndexFailure(assert);
    testGitFailures(assert);
    testIgnoreSources(assert);
    testPrePush(assert);
    process.stdout.write(`env.test: ok (${total()} assertions)\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`env.test: failed: ${error.message}\n`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exit(runTest());
