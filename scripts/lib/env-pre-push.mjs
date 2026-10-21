#!/usr/bin/env node
// Filename-only guard for actual .env files in commits reachable from pushed
// refs. It deliberately never opens a blob.

import { execFileSync } from 'node:child_process';
import { isActualEnvPath } from './env-path.mjs';

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const refs = input.trim().split(/\r?\n/).filter(Boolean).map((line) => line.split(/\s+/));
      for (const [_localRef, localSha] of refs) {
        if (!localSha || /^0+$/.test(localSha)) continue;
        const names = execFileSync('git', ['log', '--full-history', '--diff-merges=separate', '-z', '--format=', '--name-only', localSha, '--',
          ':(glob,icase).env', ':(glob,icase).env.*', ':(glob,icase)**/.env', ':(glob,icase)**/.env.*'], {
          windowsHide: true,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        if (names.split('\0').some((name) => name && isActualEnvPath(name))) {
          process.stderr.write('env/pre-push: proposed ref history contains an actual .env filename; keep it local\n');
          process.exitCode = 1;
          return;
        }
      }
    } catch {
      process.stderr.write('env/pre-push: could not inspect proposed ref history; refusing the push\n');
      process.exitCode = 1;
    }
  });
}

main();
