import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mintForRepo } from './agent-token.mjs';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const dependencies = (responses, requests = []) => ({
  credentialsProvider: () => ({ id: '12345', key: privateKey.export({ type: 'pkcs1', format: 'pem' }) }),
  fetchImpl: async (url, options) => {
    requests.push({ url, options });
    const value = responses.shift();
    if (value instanceof Error) throw value;
    return value;
  },
});
const response = (value, ok = true, status = 200) => ({ ok, status, json: async () => value });
const setup = (scope) => [
  response({ id: 4321 }),
  response({ token: 'offline-test-token', expires_at: '2099-01-01T00:00:00Z', ...scope }),
];

test('POST requests JSON scope for the target and preserves the return shape', async () => {
  const requests = [];
  const result = await mintForRepo('SimpsonM09', 'repo-one', dependencies(setup({
    repositories: [{ full_name: 'simpsonm09/REPO-ONE' }],
  }), requests));
  assert.deepEqual(result, {
    installation: 4321,
    token: 'offline-test-token',
    expires_at: '2099-01-01T00:00:00Z',
  });
  assert.equal(requests[1].options.method, 'POST');
  assert.equal(requests[1].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(requests[1].options.body), { repositories: ['repo-one'] });
});

test('accepts a response that omits repositories for GitHub compatibility', async () => {
  const result = await mintForRepo('owner', 'repo', dependencies(setup()));
  assert.equal(result.token, 'offline-test-token');
});

test('rejects invalid names before credentials or network access', async () => {
  let calls = 0;
  const deps = {
    credentialsProvider: () => { calls += 1; throw new Error('credentials accessed'); },
    fetchImpl: async () => { calls += 1; throw new Error('network accessed'); },
  };
  for (const [owner, repo] of [[ '', 'repo' ], ['owner', ''], ['../owner', 'repo'], ['owner', '../repo'], ['owner/name', 'repo'], ['owner', 'repo\\name']]) {
    await assert.rejects(mintForRepo(owner, repo, deps), /owner and repository|invalid owner or repository/);
  }
  assert.equal(calls, 0);
});

test('rejects scope mismatch, wrong owner, and multiple repositories', async () => {
  for (const repositories of [
    [{ full_name: 'other/repo' }],
    [{ full_name: 'owner/other' }],
    [{ full_name: 'owner/repo' }, { full_name: 'owner/extra' }],
    ['owner/repo'],
  ]) {
    await assert.rejects(
      mintForRepo('owner', 'repo', dependencies(setup({ repositories }))),
      /repository scope mismatch/,
    );
  }
});

test('rejects invalid installation IDs and malformed token responses', async () => {
  for (const id of [0, -1, 1.5, '123']) {
    await assert.rejects(mintForRepo('owner', 'repo', dependencies([
      response({ id }),
    ])), /invalid installation id/);
  }
  for (const token of [null, { token: '', expires_at: '2099-01-01T00:00:00Z' },
    { token: 'present', expires_at: 'not-a-date' }]) {
    await assert.rejects(mintForRepo('owner', 'repo', dependencies([
      response({ id: 1 }), response(token),
    ])), /invalid token response/);
  }
});

test('HTTP failures never include an echoed response body', async () => {
  const canary = 'SECRET-CANARY-response-body';
  const requests = [];
  const deps = dependencies([
    response(null, false, 403),
  ], requests);
  deps.fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return { ok: false, status: 403, json: async () => { throw new Error(canary); }, text: async () => canary };
  };
  await assert.rejects(mintForRepo('owner', 'repo', deps), (error) => {
    assert.match(error.message, /HTTP 403/);
    assert.doesNotMatch(error.message, new RegExp(canary));
    return true;
  });
});
