#!/usr/bin/env node
import { EXIT } from './lib/exit.mjs';
import { isMain, run, which, skip } from './lib/proc.mjs';

export function runSecurity() {
  if (!which('trivy')) {
    skip('trivy', 'install it or rely on the CI security workflow');
    return EXIT.OK;
  }
  return run('trivy', ['fs', '--scanners', 'vuln,secret,misconfig', '--severity', 'HIGH,CRITICAL', '--exit-code', '1', '.']);
}

if (isMain(import.meta.url)) process.exit(runSecurity());
