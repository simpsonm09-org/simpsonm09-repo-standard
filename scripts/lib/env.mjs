import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { normalize, readText, toPosix } from './tree.mjs';
import { isActualEnvPath } from './env-path.mjs';

// The env convention. A repository that ignores a local `.env` must ship a
// committed sibling `.env.example` and list the local file in a root
// `.worktreeinclude`. The checker reports stable `env/<rule>` ids.
function ignoredBy(root, rel) {
  try {
    execFileSync('git', ['-C', root, 'check-ignore', '--no-index', '-q', '--', rel], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function ignoredByLocalGitignore(root, rel) {
  try {
    const output = execFileSync('git', ['-C', root, 'check-ignore', '--no-index', '-v', '-z', '--stdin'], {
      windowsHide: true,
      encoding: 'utf8',
      input: `${rel}\0`,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const [source, , pattern] = output.split('\0');
    const sourcePath = source?.split(':', 1)[0];
    if (!sourcePath || isAbsolute(sourcePath) || !(sourcePath === '.gitignore' || sourcePath.endsWith('/.gitignore')) || pattern?.startsWith('!')) return false;
    execFileSync('git', ['-C', root, 'ls-files', '--error-unmatch', '--', sourcePath], { windowsHide: true, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function worktreeincludePaths(root) {
  const file = join(root, '.worktreeinclude');
  const out = [];
  for (const raw of normalize(readText(file)).replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    out.push(toPosix(line));
  }
  return out;
}

function checkIncludePaths(repoRoot, paths, tracked, add) {
  if (paths.length === 0) {
    add('env/worktreeinclude-path', '.worktreeinclude lists no paths');
    return;
  }

  for (const rel of paths) {
    if (!ignoredByLocalGitignore(repoRoot, rel)) {
      add('env/worktreeinclude-path', `.worktreeinclude lists ${rel}, which .gitignore does not ignore`);
      continue;
    }
    const example = `${rel}.example`;
    if (!existsSync(join(repoRoot, example))) {
      add('env/example', `${rel} has no sibling ${example}`);
    } else if (ignoredBy(repoRoot, example)) {
      add('env/example', `${example} must not be ignored by .gitignore`);
    } else if (!tracked.some((path) => path.toLowerCase() === example.toLowerCase())) {
      add('env/example', `${example} must be tracked as the committed template`);
    }
  }
}

export function checkEnv(root, add) {
  const repoRoot = resolve(root);
  let tracked = [];
  const isGit = existsSync(join(repoRoot, '.git'));
  if (!isGit) return;
  try {
    execFileSync('git', ['-C', repoRoot, 'rev-parse', '--show-toplevel'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    tracked = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z'], {
      windowsHide: true,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\0').filter(Boolean);
  } catch {
    add('env/index', 'Git could not read the repository index');
    return;
  }

  for (const rel of tracked) {
    if (isActualEnvPath(rel)) {
      add('env/tracked', `${rel} is tracked; actual .env files must stay local`);
    }
  }

  const includeFile = join(repoRoot, '.worktreeinclude');
  const hasInclude = existsSync(includeFile);
  const ignoresEnv = ignoredBy(repoRoot, '.env');
  const locallyIgnoresEnv = ignoredByLocalGitignore(repoRoot, '.env');
  if (!hasInclude && !ignoresEnv) return;

  if (!hasInclude) {
    add('env/worktreeinclude', '.gitignore ignores .env but there is no root .worktreeinclude');
    return;
  }

  if (ignoresEnv && !locallyIgnoresEnv) {
    add('env/ignore', '.env must be ignored by the repository .gitignore, not only a machine-wide exclude');
  }

  checkIncludePaths(repoRoot, worktreeincludePaths(repoRoot), tracked, add);
}
