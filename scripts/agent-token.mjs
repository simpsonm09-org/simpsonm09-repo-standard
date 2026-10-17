#!/usr/bin/env node
// Mint a GitHub App installation token for a fleet repository. The token is the
// agent identity at the boundary, a short-lived credential scoped to one
// installation. The app id and private key come from the environment, with a
// local fallback for development.
//
// Usage:
//   node scripts/agent-token.mjs <owner>/<repo> [--json]
//   node scripts/agent-token.mjs --installation <id> [--json]
//   node scripts/agent-token.mjs --self-test
//
// The token is printed to stdout. Never log it, and never write it to a file.

import { createSign, generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CONFIG_DIR = join(homedir(), '.config', 'simpsonm09');
const API = 'https://api.github.com';
const JWT_LIFETIME_SECONDS = 540;

export function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function appJwt(appId, privateKey, now = Math.floor(Date.now() / 1000)) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + JWT_LIFETIME_SECONDS, iss: appId }));
  const signingInput = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey);
  return `${signingInput}.${base64url(signature)}`;
}

function credentials() {
  const id = process.env.AGENT_APP_ID;
  const key = process.env.AGENT_APP_PRIVATE_KEY;
  if (id && key) return { id, key };
  const meta = JSON.parse(readFileSync(join(CONFIG_DIR, 'agent-app.json'), 'utf8'));
  return { id: String(meta.id), key: readFileSync(join(CONFIG_DIR, 'agent-app.pem'), 'utf8') };
}

async function github(path, token, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${API}${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

function validateRepositoryName(owner, repo) {
  if (typeof owner !== 'string' || typeof repo !== 'string' || !owner || !repo) {
    throw new Error('owner and repository must be nonempty strings');
  }
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(owner)
    || !/^[A-Za-z0-9_.-]+$/.test(repo)
    || repo === '.' || repo === '..') {
    throw new Error('invalid owner or repository name');
  }
}

export async function mintForRepo(owner, repo, deps = {}) {
  validateRepositoryName(owner, repo);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const { id, key } = (deps.credentialsProvider ?? credentials)();
  const jwt = appJwt(id, key);
  const installation = await github(`/repos/${owner}/${repo}/installation`, jwt, {}, fetchImpl);
  if (!Number.isSafeInteger(installation?.id) || installation.id <= 0) throw new Error('invalid installation id');
  const token = await github(`/app/installations/${installation.id}/access_tokens`, jwt, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repositories: [repo] }),
  }, fetchImpl);
  if (!token || typeof token.token !== 'string' || token.token.trim() === '') throw new Error('invalid token response');
  const expiry = typeof token.expires_at === 'string' ? Date.parse(token.expires_at) : NaN;
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('invalid token response');
  if (token.repositories !== undefined) {
    const expected = `${owner}/${repo}`.toLowerCase();
    if (!Array.isArray(token.repositories)
      || token.repositories.length !== 1
      || !token.repositories[0]
      || typeof token.repositories[0].full_name !== 'string'
      || token.repositories[0].full_name.toLowerCase() !== expected) {
      throw new Error('token response repository scope mismatch');
    }
  }
  return { installation: installation.id, token: token.token, expires_at: token.expires_at };
}

export function selfTest() {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
  const jwt = appJwt('123', pem);
  const [header, payload, signature] = jwt.split('.');
  assert(header && payload && signature, 'jwt has three parts');

  const signingInput = `${header}.${payload}`;
  const raw = Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  assert(verify('RSA-SHA256', Buffer.from(signingInput), publicKey, raw), 'signature verifies');

  const decoded = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  assert(decoded.iss === '123', 'issuer is the app id');
  assert(decoded.exp - decoded.iat <= 660, 'lifetime is under the ten minute cap');
}

function parseArgs(argv) {
  const args = { repo: undefined, installation: undefined, json: false, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--installation') {
      index += 1;
      args.installation = argv[index];
    } else if (arg === '--json') args.json = true;
    else if (arg === '--self-test') args.selfTest = true;
    else if (!args.repo) args.repo = arg;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.selfTest) {
    try {
      selfTest();
      process.stdout.write('agent-token: self-test ok\n');
    } catch (error) {
      process.stderr.write(`agent-token: self-test failed: ${error.message}\n`);
      process.exit(1);
    }
    return;
  }

  const target = args.repo;
  if (!target?.includes('/')) {
    process.stderr.write('usage: agent-token <owner>/<repo> [--json]\n');
    process.exit(2);
  }
  const [owner, repo] = target.split('/');

  try {
    const result = await mintForRepo(owner, repo);
    if (args.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else process.stdout.write(`${result.token}\n`);
  } catch (error) {
    process.stderr.write(`agent-token: ${error.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
