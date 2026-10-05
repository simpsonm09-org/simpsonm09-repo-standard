import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { capture, which } from './proc.mjs';
import { GENERATED_FILE, OPS_FILE, RUNNER, interpreterFor, render, validateShape } from './ops.mjs';

const SCRIPT_EXTENSIONS = new Set(['.mjs', '.js', '.cjs', '.sh', '.ps1', '.py', '.ts']);
const KNOWN_INTERPRETERS = { '.ps1': 'pwsh', '.sh': 'bash', '.mjs': 'node', '.js': 'node', '.cjs': 'node' };

export function checkConvention(root, ops) {
  const errors = [];
  const notices = [];

  const shape = validateShape(ops);
  errors.push(...shape.errors);

  collectReachability(root, ops, errors);
  checkGenerated(root, ops, errors);
  checkTwins(root, ops, errors, notices);
  checkVendoredRunner(root, errors);
  checkTemplateRender(root, errors);

  return { errors, notices };
}

function toPosix(value) {
  return value.split('\\').join('/');
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function listScripts(root) {
  const scriptsDir = join(root, 'scripts');
  const out = [];
  if (!existsSync(scriptsDir)) return out;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SCRIPT_EXTENSIONS.has(extensionOf(entry.name))) out.push(full);
    }
  };
  walk(scriptsDir);
  return out;
}

function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

function collectReferences(ops) {
  const referenced = new Set();
  for (const op of ops.operations ?? []) {
    if ((op.kind ?? 'portable') === 'twin') addTwinReferences(op, referenced);
    collectRunReferences(op, referenced);
  }
  return referenced;
}

function addTwinReferences(op, referenced) {
  for (const rel of [op.windows, op.posix]) {
    if (rel) referenced.add(toPosix(rel));
  }
}

function collectRunReferences(op, referenced) {
  if (typeof op.run !== 'string') return;
  for (const token of op.run.split(/\s+/)) {
    if (isScriptPath(token)) referenced.add(toPosix(token.replace(/^\.\//, '')));
  }
}

function isScriptPath(token) {
  return /\.(mjs|js|cjs|sh|ps1|py|ts)$/i.test(token) || token.includes('/') || token.includes('\\');
}

function collectReachability(root, ops, errors) {
  const referenced = collectReferences(ops);
  for (const file of listScripts(root)) {
    const rel = toPosix(relative(root, file));
    if (rel.startsWith('scripts/lib/')) continue;
    if (rel === RUNNER) continue;
    if (!referenced.has(rel)) errors.push(`orphan script ${rel} is not reachable by any operation`);
  }
}

function checkGenerated(root, ops, errors) {
  const generatedPath = join(root, GENERATED_FILE);
  if (!existsSync(generatedPath)) {
    errors.push(`${GENERATED_FILE} is missing; run node scripts/op.mjs render`);
    return;
  }
  const actual = stripBom(readFileSync(generatedPath, 'utf8'));
  const expected = render(ops);
  if (actual !== expected) {
    errors.push(`${GENERATED_FILE} is out of date; run node scripts/op.mjs render`);
  }
  for (const op of ops.operations ?? []) {
    const recipe = new RegExp(`^${escapeRegExp(op.id)}(?:\\s+.*)?:`, 'm');
    if (!recipe.test(actual)) errors.push(`operation "${op.id}" has no recipe in ${GENERATED_FILE}`);
  }
  for (const line of actual.split('\n')) {
    if (!/^\s+\S/.test(line)) continue;
    if (/\b(bash|pwsh|powershell)\b/i.test(line)) {
      errors.push(`recipe body names an interpreter: ${line.trim()}`);
    }
  }
}

function checkTwins(root, ops, errors, notices) {
  for (const op of ops.operations ?? []) {
    if ((op.kind ?? 'portable') !== 'twin') continue;
    const sides = [['windows', op.windows], ['posix', op.posix]].filter(([, rel]) => rel);
    for (const [side, rel] of sides) checkTwinSide(root, op, side, rel, errors);
    if (sides.length < 2) continue;
    const results = {};
    for (const [side, rel] of sides) {
      const probe = probeTwinSide(root, op, side, rel, notices);
      if (probe) results[side] = probe;
    }
    compareTwinResults(op, results, errors);
    assertTwinResults(op, results, errors);
  }
}

function checkTwinSide(root, op, side, rel, errors) {
  if (!existsSync(join(root, rel))) {
    errors.push(`twin "${op.id}" ${side} implementation ${rel} is missing`);
  }
  if (!KNOWN_INTERPRETERS[extensionOf(rel)]) {
    errors.push(`twin "${op.id}" ${side} implementation ${rel} has no known interpreter`);
  }
}

function probeTwinSide(root, op, side, rel, notices) {
  const interpreter = KNOWN_INTERPRETERS[extensionOf(rel)];
  if (!interpreter) return null;
  if (!which(interpreter)) {
    notices.push(`twin "${op.id}" ${side} parity skipped: ${interpreter} is not on PATH`);
    return null;
  }
  const help = capture(interpreter, interpreterFor(root, rel, ['help']).argv, { cwd: root }).status;
  const usage = capture(interpreter, interpreterFor(root, rel, []).argv, { cwd: root }).status;
  return { help, usage };
}

function compareTwinResults(op, results, errors) {
  const windows = results.windows;
  const posix = results.posix;
  if (!windows || !posix) return;
  if (windows.help !== posix.help) {
    errors.push(`twin "${op.id}" help exit ${windows.help} (windows) != ${posix.help} (posix)`);
  }
  if (windows.usage !== posix.usage) {
    errors.push(`twin "${op.id}" usage exit ${windows.usage} (windows) != ${posix.usage} (posix)`);
  }
}

function assertTwinResults(op, results, errors) {
  for (const [side, result] of Object.entries(results)) {
    if (result.help !== 0) errors.push(`twin "${op.id}" ${side} must exit 0 for "help", got ${result.help}`);
    if (result.usage !== 2) errors.push(`twin "${op.id}" ${side} must exit 2 with no arguments, got ${result.usage}`);
  }
}

function checkVendoredRunner(root, errors) {
  const source = join(root, RUNNER);
  const vendored = join(root, 'templates', RUNNER);
  if (!existsSync(source) || !existsSync(vendored)) return;
  if (stripBom(readFileSync(source, 'utf8')) !== stripBom(readFileSync(vendored, 'utf8'))) {
    errors.push(`templates/${RUNNER} has drifted from ${RUNNER}`);
  }
}

function checkTemplateRender(root, errors) {
  const templateOps = join(root, 'templates', OPS_FILE);
  const templateGenerated = join(root, 'templates', GENERATED_FILE);
  if (!existsSync(templateOps)) return;
  let data;
  try {
    data = JSON.parse(readFileSync(templateOps, 'utf8'));
  } catch (error) {
    errors.push(`templates/${OPS_FILE} is invalid JSON: ${error.message}`);
    return;
  }
  errors.push(...validateShape(data).errors.map((entry) => `templates/${OPS_FILE}: ${entry}`));
  if (!existsSync(templateGenerated)) {
    errors.push(`templates/${GENERATED_FILE} is missing`);
    return;
  }
  if (stripBom(readFileSync(templateGenerated, 'utf8')) !== render(data)) {
    errors.push(`templates/${GENERATED_FILE} is out of date with templates/${OPS_FILE}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
