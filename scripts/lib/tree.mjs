import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

export function readText(path) {
  return readFileSync(path, 'utf8');
}

export function normalize(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function toPosix(value) {
  return value.split('\\').join('/');
}

export function extensionOf(name) {
  return extname(name).toLowerCase();
}

export function listFiles(dir, extensions) {
  const out = [];
  if (!existsSync(dir)) return out;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (extensions.includes(extensionOf(entry.name))) out.push(full);
    }
  };
  walk(dir);
  return out;
}

// A thin justfile can delegate its recipes to imported files. Read the justfile
// and each file it imports one level deep, so a recipe check sees the combined
// text. Paths are resolved from the repository root.
export function justfileText(root) {
  const file = join(root, 'justfile');
  if (!existsSync(file)) return '';
  const text = normalize(readText(file)).replace(/\r\n/g, '\n');
  let combined = text;
  for (const match of text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) {
    const imported = join(root, match[1]);
    if (!existsSync(imported)) continue;
    combined += `\n${normalize(readText(imported)).replace(/\r\n/g, '\n')}`;
  }
  return combined;
}
