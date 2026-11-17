import { existsSync, readFileSync } from 'node:fs';

function toChecks(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string');
  if (typeof value === 'string') return [value];
  return null;
}

export function loadExceptions(file) {
  if (!existsSync(file)) return [];
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const list = Array.isArray(data) ? data : data.exceptions ?? [];
  return list.map((entry) => {
    const raw = 'checks' in entry ? entry.checks : ('check' in entry ? entry.check : null);
    return {
      repo: entry.repo,
      checks: new Set(toChecks(raw) ?? []),
      reason: entry.reason ?? '',
      date: entry.date ?? '',
    };
  });
}

// The organization rename moves every repository to the new owner without
// changing its name. An exception declares a repository, not an owner spelling,
// so it keeps applying under either organization owner while the rename is in
// flight. Personal forks and third parties are never matched.
const ORG_OWNERS = ['simpsonm09-org', 'simpsonm09-projects'];

function sameRepository(candidate, repo) {
  if (candidate === repo) return true;
  const slash = repo.indexOf('/');
  if (slash === -1) return false;
  if (!ORG_OWNERS.includes(repo.slice(0, slash))) return false;
  const name = repo.slice(slash + 1);
  return ORG_OWNERS.some((owner) => candidate === `${owner}/${name}`);
}

export function findException(exceptions, repo, id) {
  return exceptions.find((entry) => (entry.repo === '*' || sameRepository(entry.repo, repo)) && (entry.checks.has('*') || entry.checks.has(id)));
}
