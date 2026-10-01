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

export function findException(exceptions, repo, id) {
  return exceptions.find((entry) => (entry.repo === '*' || entry.repo === repo) && (entry.checks.has('*') || entry.checks.has(id)));
}
