#!/usr/bin/env node
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkConvention } from './lib/check.mjs';
import { EXIT } from './lib/exit.mjs';
import { GENERATED_FILE, OPS_FILE, interpreterFor, loadOps, render, validateShape } from './lib/ops.mjs';
import { run, which } from './lib/proc.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const USAGE = `usage: node scripts/op.mjs [--root DIR] [--ops FILE] <command> [args]

commands:
  run <id> [args]   run an operation
  check             validate the manifest, recipes, twins, and generated files
  render            regenerate ${GENERATED_FILE} from ${OPS_FILE}
  list              list the operations
`;

function parseArgs(argv) {
  const parsed = { root: null, ops: null, command: null, rest: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root' || arg === '--ops') {
      index += 1;
      assignOption(parsed, arg, argv[index]);
    } else if (arg === '-h' || arg === '--help') {
      parsed.command = 'help';
    } else if (parsed.command === null) {
      parsed.command = arg;
    } else {
      parsed.rest.push(arg);
    }
  }
  return parsed;
}

function assignOption(parsed, arg, value) {
  if (value === undefined || value.startsWith('--')) exitUsage(`missing value for ${arg}`);
  if (arg === '--root') parsed.root = value;
  else parsed.ops = value;
}

function resolveRoot(explicit) {
  if (explicit) return resolve(explicit);
  if (process.env.REPO_ROOT) return resolve(process.env.REPO_ROOT);
  return resolve(HERE, '..');
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const root = resolveRoot(parsed.root);
  const command = parsed.command ?? 'help';

  if (command === 'help') {
    process.stdout.write(USAGE);
    process.exit(EXIT.OK);
  }

  let loaded;
  try {
    loaded = loadOps(root, parsed.ops);
  } catch (error) {
    process.stderr.write(`op: cannot read ${parsed.ops ?? join(root, OPS_FILE)}: ${error.message}\n`);
    process.exit(EXIT.FAIL);
  }

  process.exit(dispatch(command, root, loaded.data, parsed.rest));
}

function dispatch(command, root, ops, rest) {
  if (command === 'list') return listOps(ops);
  if (command === 'render') return renderOps(root, ops);
  if (command === 'check') return checkOps(root, ops);
  if (command === 'run') return runOperation(root, ops, rest);
  return usage(`unknown command "${command}"`);
}

function listOps(ops) {
  for (const op of ops.operations ?? []) {
    process.stdout.write(`${op.id}\t${op.kind ?? 'portable'}\t${op.description ?? ''}\n`);
  }
  return EXIT.OK;
}

function renderOps(root, ops) {
  const errors = validateShape(ops).errors;
  if (errors.length > 0) return fail(errors);
  writeFileSync(join(root, GENERATED_FILE), render(ops));
  process.stdout.write(`wrote ${GENERATED_FILE}\n`);
  return EXIT.OK;
}

function checkOps(root, ops) {
  const { errors, notices } = checkConvention(root, ops);
  for (const notice of notices) process.stdout.write(`notice: ${notice}\n`);
  if (errors.length > 0) return fail(errors);
  process.stdout.write(`check: ok (${(ops.operations ?? []).length} operations)\n`);
  return EXIT.OK;
}

function runOperation(root, ops, rest) {
  const id = rest[0];
  if (!id) return usage('run needs an operation id');
  const args = rest.slice(1);
  const op = (ops.operations ?? []).find((candidate) => candidate.id === id);
  if (!op) return usage(`unknown operation "${id}"`);

  const kind = op.kind ?? 'portable';
  if (kind === 'twin') {
    const rel = process.platform === 'win32' ? op.windows : op.posix;
    const { cmd, argv } = interpreterFor(root, rel, args);
    if (!which(cmd)) {
      process.stderr.write(`op: ${cmd} is not on PATH, cannot run the ${id} twin\n`);
      return EXIT.FAIL;
    }
    return run(cmd, argv, { cwd: root });
  }

  const tokens = op.run.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return usage(`operation "${id}" has an empty run command`);
  if (!existsSync(join(root, tokens[0])) && !which(tokens[0])) {
    process.stderr.write(`op: ${tokens[0]} is not on PATH, cannot run "${id}"\n`);
    return EXIT.FAIL;
  }
  return run(tokens[0], [...tokens.slice(1), ...args], { cwd: root });
}

function usage(message) {
  process.stderr.write(`op: ${message}\n`);
  process.stderr.write(USAGE);
  return EXIT.USAGE;
}

function fail(errors) {
  for (const error of errors) process.stderr.write(`error: ${error}\n`);
  return process.exit(EXIT.FAIL);
}

main();
