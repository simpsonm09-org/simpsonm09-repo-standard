// Read the job structure of a GitHub Actions workflow token by token, so the
// checkers need no YAML parser. A job is a two-space key under `jobs:`, and its
// block is the indented lines that follow it.

export const EXTERNAL_WORKFLOW = /^simpsonm09-org\/simpsonm09-repo-standard\/\.github\/workflows\/([a-z0-9-]+)\.yml@([0-9a-fA-F]{40})$/;
export const LOCAL_WORKFLOW = /^\.\/\.github\/workflows\/([a-z0-9-]+)\.yml$/;

export function parseJobs(text) {
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

export function findUses(block) {
  for (const line of block) {
    const match = /^\s+uses:\s*(\S+)/.exec(line);
    if (match) return match[1].replace(/['"]/g, '');
  }
  return null;
}

// The names of the jobs that call one shared workflow. A local reference counts
// only in the standard repository itself, the one place those files live.
export function jobsCalling(jobs, workflow, isSelf) {
  return [...jobs.keys()].filter((name) => {
    const uses = findUses(jobs.get(name));
    if (!uses) return false;
    const external = EXTERNAL_WORKFLOW.exec(uses);
    if (external) return external[1] === workflow;
    const local = LOCAL_WORKFLOW.exec(uses);
    return isSelf && local !== null && local[1] === workflow;
  });
}
