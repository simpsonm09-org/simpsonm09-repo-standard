import { basename } from 'node:path';

export function isActualEnvPath(path) {
  const name = basename(path);
  return /^\.env(?:\..+)?$/i.test(name) && !/\.example$/i.test(name);
}
