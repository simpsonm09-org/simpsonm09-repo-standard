#!/usr/bin/env node
// Read-only snapshot CLI. Input commands are hashed as data and never dispatched.
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createReceipt } from './receipt.mjs';

const MAX_INPUT_BYTES = 1024 * 1024;

function parseArgs(argv) {
  const parsed = { input: null, repo: process.cwd(), expectedAccount: null };
  const destinations = { '--input': 'input', '--repo': 'repo', '--expected-account': 'expectedAccount' };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const destination = destinations[option];
    if (!destination) throw new Error('unknown option');
    const value = readOptionValue(argv, index, option);
    index += 1;
    parsed[destination] = value;
  }
  if (!parsed.input) throw new Error('provide --input FILE or --input - for JSON on stdin');
  return parsed;
}

function readOptionValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`missing value for ${option}`);
  if (value.length > 4096 || value.includes('\0')) throw new Error('option value is invalid');
  return value;
}

export async function main(argv = process.argv.slice(2), stdin = process.stdin) {
  try {
    const args = parseArgs(argv);
    const raw = args.input === '-' ? await readStdin(stdin) : readInputFile(args.input);
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      throw new Error('input is not valid JSON');
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('input must be a JSON object');
    if (args.expectedAccount) input.expectedAccount = args.expectedAccount;
    process.stdout.write(`${JSON.stringify(createReceipt(input, args.repo), null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`delivery-receipt: ${error.message}\n`);
    return 2;
  }
}

function readInputFile(path) {
  const absolute = resolve(path);
  try {
    if (statSync(absolute).size > MAX_INPUT_BYTES) throw new Error(`input exceeds ${MAX_INPUT_BYTES} bytes`);
    return readFileSync(absolute, 'utf8');
  } catch (error) {
    if (error instanceof Error && error.message === `input exceeds ${MAX_INPUT_BYTES} bytes`) throw error;
    throw new Error('input file could not be read');
  }
}

function readStdin(stdin) {
  return new Promise((resolveText, reject) => {
    let text = '';
    let bytes = 0;
    let rejected = false;
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk) => {
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > MAX_INPUT_BYTES && !rejected) {
        rejected = true;
        reject(new Error(`input exceeds ${MAX_INPUT_BYTES} bytes`));
        stdin.destroy();
        return;
      }
      if (!rejected) text += chunk;
    });
    stdin.on('end', () => resolveText(text));
    stdin.on('error', reject);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
