#!/usr/bin/env node
// Patch coverage gate. Fails when the units a change adds or edits are not
// covered enough by the test suite. Reads an lcov report and a git diff, so it
// works for any language whose coverage tool emits lcov.
//
// usage:
//   node scripts/patch-coverage.mjs --lcov coverage/lcov.info --base origin/main \
//     [--mode lines|branches|both] [--threshold 80] [--branch-threshold 70] \
//     [--crap] [--allow-missing-branch]
//
// The base ref is the merge base for a pull request. On a push with no pull
// request, pass HEAD~1. A change with no measured units passes.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { EXIT } from './lib/exit.mjs';
import { isMain } from './lib/proc.mjs';

const MODES = new Set(['lines', 'branches', 'both']);

function parseArgs(argv) {
  const options = {
    lcov: 'coverage/lcov.info',
    base: 'origin/main',
    mode: 'lines',
    threshold: 80,
    branchThreshold: 70,
    crap: false,
    allowMissingBranch: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') options.help = true;
    else if (arg === '--lcov') { options.lcov = argv[i + 1]; i += 1; }
    else if (arg === '--base') { options.base = argv[i + 1]; i += 1; }
    else if (arg === '--mode') { options.mode = argv[i + 1]; i += 1; }
    else if (arg === '--threshold') { options.threshold = Number(argv[i + 1]); i += 1; }
    else if (arg === '--branch-threshold') { options.branchThreshold = Number(argv[i + 1]); i += 1; }
    else if (arg === '--crap') options.crap = true;
    else if (arg === '--allow-missing-branch') options.allowMissingBranch = true;
  }
  return options;
}

function parseFunction(line) {
  const parts = line.slice(3).split(',');
  const start = Number(parts[0]);
  // Vitest v8 writes `FN:<line>,<name>`; pytest-cov writes
  // `FN:<start>,<end>,<name>`. A name may itself contain a comma, so only read
  // the second field as an end when it is numeric.
  if (parts.length >= 3 && /^\d+$/.test(parts[1])) {
    return { start, end: null, name: parts.slice(2).join(','), count: 0 };
  }
  return { start, end: null, name: parts.slice(1).join(','), count: 0 };
}

// A function runs to the line before the next one, and the last runs to the end
// of the file.
function deriveSpans(functions) {
  for (let i = 0; i < functions.length; i += 1) {
    const next = functions[i + 1];
    functions[i].end = next ? next.start - 1 : Number.POSITIVE_INFINITY;
  }
}

export function parseLcov(text) {
  const files = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('SF:')) {
      current = { lines: new Map(), branches: [], functions: [] };
      files.set(line.slice(3).trim(), current);
    } else if (!current) {
      continue;
    } else if (line.startsWith('DA:')) {
      const [number, hits] = line.slice(3).split(',');
      current.lines.set(Number(number), Number(hits));
    } else if (line.startsWith('BRDA:')) {
      const [at, block, branch, taken] = line.slice(5).split(',');
      current.branches.push({
        line: Number(at),
        block: Number(block),
        branch: Number(branch),
        taken: taken === '-' ? 0 : Number(taken),
      });
    } else if (line.startsWith('FNDA:')) {
      const rest = line.slice(5);
      const comma = rest.indexOf(',');
      const count = Number(rest.slice(0, comma));
      const name = rest.slice(comma + 1);
      const fn = current.functions.find((entry) => entry.name === name);
      if (fn) fn.count = count;
    } else if (line.startsWith('FN:')) {
      current.functions.push(parseFunction(line));
    } else if (line === 'end_of_record') {
      current = null;
    }
  }
  for (const record of files.values()) deriveSpans(record.functions);
  return files;
}

function changedLines(base) {
  let diff;
  try {
    diff = execFileSync('git', ['diff', '--unified=0', `${base}...HEAD`], { encoding: 'utf8' });
  } catch {
    return new Map();
  }
  const result = new Map();
  let file = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6);
      result.set(file, new Set());
      continue;
    }
    const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (match && file) {
      const start = Number(match[1]);
      const count = match[2] === undefined ? 1 : Number(match[2]);
      for (let i = 0; i < count; i += 1) result.get(file).add(start + i);
    }
  }
  return result;
}

// The diff path uses forward slashes, but an emitter on Windows may write the
// `SF:` name with backslashes, so normalize both sides before comparing.
function toForwardSlashes(path) {
  return path.replace(/\\/g, '/');
}

export function matchReport(files, rel) {
  const target = toForwardSlashes(rel);
  const suffix = '/' + target;
  for (const [name, data] of files) {
    const normalized = toForwardSlashes(name);
    if (normalized === target || normalized.endsWith(suffix)) return data;
  }
  return null;
}

function lineUnits(record, lines) {
  const measured = [...lines].filter((line) => record.lines.has(line));
  const covered = measured.filter((line) => record.lines.get(line) > 0);
  return { measured: measured.length, covered: covered.length };
}

function branchUnits(record, lines) {
  const measured = record.branches.filter((branch) => lines.has(branch.line));
  const covered = measured.filter((branch) => branch.taken > 0);
  return { measured: measured.length, covered: covered.length };
}

function touches(fn, lines) {
  for (const line of lines) if (line >= fn.start && line <= fn.end) return true;
  return false;
}

// CRAP for one function: cyclomatic complexity from the distinct branch blocks
// in its span, coverage from the measured lines in the same span.
export function crapScore(record, fn) {
  const blocks = new Set();
  for (const branch of record.branches) {
    if (branch.line >= fn.start && branch.line <= fn.end) blocks.add(branch.block);
  }
  const complexity = blocks.size + 1;
  const span = [...record.lines.keys()].filter((line) => line >= fn.start && line <= fn.end);
  const covered = span.filter((line) => record.lines.get(line) > 0).length;
  const coverage = span.length === 0 ? 0 : covered / span.length;
  return complexity * complexity * (1 - coverage) ** 3 + complexity;
}

// Resolve the gate over an already parsed report and diff. Returns the exit
// code and the lines to print, so the CLI and the tests share one path.
export function evaluate(options, files, changed) {
  const stdout = [];
  const stderr = [];
  const hasBranches = [...files.values()].some((record) => record.branches.length > 0);
  const hasFunctions = [...files.values()].some((record) => record.functions.length > 0);

  let mode = options.mode;
  let degraded = false;
  if ((mode === 'branches' || mode === 'both') && !hasBranches) {
    if (!options.allowMissingBranch) {
      stderr.push(`patch-coverage: branch data unavailable in ${options.lcov} (no BRDA records), fail`);
      return { code: EXIT.FAIL, stdout, stderr };
    }
    stdout.push('patch-coverage: branch data unavailable, degraded to line coverage; CRAP unavailable');
    mode = 'lines';
    degraded = true;
  }

  let lineMeasured = 0;
  let lineCovered = 0;
  let branchMeasured = 0;
  let branchCovered = 0;
  const gaps = [];
  for (const [rel, lines] of changed) {
    const record = matchReport(files, rel);
    if (!record) continue;
    if (mode === 'lines' || mode === 'both') {
      const unit = lineUnits(record, lines);
      lineMeasured += unit.measured;
      lineCovered += unit.covered;
      if (unit.measured > 0 && unit.covered < unit.measured) {
        gaps.push(`  ${rel}: ${unit.covered}/${unit.measured} changed lines covered`);
      }
    }
    if (mode === 'branches' || mode === 'both') {
      const unit = branchUnits(record, lines);
      branchMeasured += unit.measured;
      branchCovered += unit.covered;
      if (unit.measured > 0 && unit.covered < unit.measured) {
        gaps.push(`  ${rel}: ${unit.covered}/${unit.measured} changed branches covered`);
      }
    }
  }

  if (lineMeasured === 0 && branchMeasured === 0) {
    stdout.push('patch-coverage: no measured changed units, pass');
    return { code: EXIT.OK, stdout, stderr };
  }

  let ok = true;
  if ((mode === 'lines' || mode === 'both') && lineMeasured > 0) {
    const percent = (lineCovered / lineMeasured) * 100;
    stdout.push(`patch-coverage: ${lineCovered}/${lineMeasured} changed lines covered (${percent.toFixed(1)}%), threshold ${options.threshold}%`);
    if (percent < options.threshold) ok = false;
  }
  if ((mode === 'branches' || mode === 'both') && branchMeasured > 0) {
    const percent = (branchCovered / branchMeasured) * 100;
    stdout.push(`patch-coverage: ${branchCovered}/${branchMeasured} changed branches covered (${percent.toFixed(1)}%), threshold ${options.branchThreshold}%`);
    if (percent < options.branchThreshold) ok = false;
  }
  stdout.push(...gaps);

  if (options.crap && !degraded) {
    if (hasBranches && hasFunctions) {
      for (const [rel, lines] of changed) {
        const record = matchReport(files, rel);
        if (!record) continue;
        for (const fn of record.functions) {
          if (!touches(fn, lines)) continue;
          stdout.push(`patch-coverage: CRAP ${crapScore(record, fn).toFixed(1)} ${rel}:${fn.start} ${fn.name} (advisory)`);
        }
      }
    } else {
      stdout.push('patch-coverage: CRAP unavailable (needs both BRDA and FN records)');
    }
  }

  return { code: ok ? EXIT.OK : EXIT.FAIL, stdout, stderr };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('usage: node scripts/patch-coverage.mjs --lcov <path> --base <ref> [--mode lines|branches|both] [--threshold 80] [--branch-threshold 70] [--crap] [--allow-missing-branch]\n');
    process.exit(EXIT.OK);
  }
  if (!MODES.has(options.mode)) {
    process.stderr.write(`patch-coverage: unknown mode ${options.mode}, expected lines, branches, or both\n`);
    process.exit(EXIT.FAIL);
  }
  if (!existsSync(options.lcov)) {
    process.stderr.write(`patch-coverage: no coverage report at ${options.lcov}\n`);
    process.exit(EXIT.FAIL);
  }

  const files = parseLcov(readFileSync(options.lcov, 'utf8'));
  const changed = changedLines(options.base);
  const result = evaluate(options, files, changed);
  for (const line of result.stdout) process.stdout.write(`${line}\n`);
  for (const line of result.stderr) process.stderr.write(`${line}\n`);
  process.exit(result.code);
}

if (isMain(import.meta.url)) main();
