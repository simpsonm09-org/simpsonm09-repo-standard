#!/usr/bin/env node
import { EXIT } from './lib/exit.mjs';
import { isMain, run, skip, which } from './lib/proc.mjs';

const GITLEAKS_IMAGE = 'ghcr.io/gitleaks/gitleaks:v8.30.1';

export function runSecretScan() {
  if (which('gitleaks')) {
    return run('gitleaks', ['detect', '--source', '.', '--redact', '--exit-code', '1']);
  }
  if (which('docker')) {
    const image = process.env.GITLEAKS_IMAGE ?? GITLEAKS_IMAGE;
    const mount = `${process.cwd()}:/repo`;
    return run('docker', ['run', '--rm', '-v', mount, '-w', '/repo', image, 'detect', '--source=.', '--redact', '--exit-code', '1']);
  }
  skip('gitleaks', 'install gitleaks or docker to scan git history');
  return EXIT.OK;
}

if (isMain(import.meta.url)) process.exit(runSecretScan());
