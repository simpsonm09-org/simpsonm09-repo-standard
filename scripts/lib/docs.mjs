import { existsSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { justfileText, listFiles, normalize, readText, toPosix } from './tree.mjs';

const DIAGRAM_FENCES = ['mermaid', 'plantuml', 'graphviz', 'dot'];
const MANIFEST_KEYS = new Set(['readme', 'features', 'diagrams', 'api']);

function stripFences(text) {
  const out = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push(line);
  }
  return out.join('\n');
}

function samePath(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function fileLinks(file) {
  const text = normalize(readText(file));
  const out = [];
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].trim().split(/\s+/)[0];
    if (target.startsWith('<')) target = target.slice(1);
    if (target.endsWith('>')) target = target.slice(0, -1);
    target = target.split('#')[0].split('?')[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    out.push(resolve(dirname(file), target));
  }
  return out;
}

function reachableDocs(index, markdown) {
  const known = new Set(markdown.map((file) => resolve(file)));
  const reached = new Set([resolve(index)]);
  const queue = [index];
  while (queue.length > 0) {
    for (const target of fileLinks(queue.shift())) {
      if (!known.has(target) || reached.has(target)) continue;
      reached.add(target);
      queue.push(target);
    }
  }
  return reached;
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function marksGenerated(root, rel) {
  const file = join(root, '.gitattributes');
  if (!existsSync(file)) return false;
  const base = basename(rel);
  for (const line of normalize(readText(file)).split('\n')) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    const tokens = text.split(/\s+/);
    if (tokens.length < 2) continue;
    const marked = tokens.slice(1).some((attr) => attr === 'linguist-generated' || attr.startsWith('linguist-generated='));
    if (!marked) continue;
    const pattern = tokens[0].replace(/^\//, '');
    if (pattern === rel || pattern === base || pattern === `**/${base}`) return true;
    if (pattern.startsWith('*') && base.endsWith(pattern.slice(1))) return true;
  }
  return false;
}

function hasSpecRecipe(root) {
  return /^@?spec(\s+[^:\n]*)?:(?!=)/m.test(justfileText(root));
}

export function hasCoverageRecipe(root) {
  return /^@?coverage(\s+[^:\n]*)?:(?!=)/m.test(justfileText(root));
}

export function checkDocs(root, add) {
  const docsDir = join(root, 'docs');
  const markdown = listFiles(docsDir, ['.md']);
  const hasDocs = markdown.length > 0;

  const readme = checkReadme(root, add);
  if (hasDocs && !/docs\/README\.md/.test(readme)) {
    add('docs/readme-link', 'README.md does not link docs/README.md');
  }

  const index = join(docsDir, 'README.md');
  if (hasDocs) checkDocsIndex(root, index, markdown, add);

  const manifestPath = join(docsDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    add('docs/manifest', 'docs/manifest.json is missing');
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(normalize(readText(manifestPath)));
  } catch (error) {
    add('docs/manifest', `docs/manifest.json is invalid JSON: ${error.message}`);
    return;
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    add('docs/manifest', 'docs/manifest.json must be a JSON object');
    return;
  }

  validateManifest(manifest, add);
  checkFeatureDocs(root, index, manifest, add);
  checkDiagramDocs(root, manifest, add);
  checkApiSpec(root, manifest, add);
}

function checkReadme(root, add) {
  const readmePath = join(root, 'README.md');
  if (!existsSync(readmePath)) {
    add('docs/readme', 'README.md is missing');
    return '';
  }
  const readme = normalize(readText(readmePath));
  const headings = stripFences(readme).split('\n').filter((line) => /^#\s+\S/.test(line));
  if (headings.length !== 1) {
    add('docs/readme', `README.md has ${headings.length} level-1 headings, expected 1`);
  }
  return readme;
}

function checkDocsIndex(root, index, markdown, add) {
  if (!existsSync(index)) {
    add('docs/index', 'docs/README.md index is missing');
    return;
  }
  const reached = reachableDocs(index, markdown);
  for (const doc of markdown) {
    if (samePath(doc, index)) continue;
    if (!reached.has(resolve(doc))) {
      add('docs/index', `${toPosix(relative(root, doc))} is not reachable from docs/README.md`);
    }
  }
}

function validateManifest(manifest, add) {
  for (const key of Object.keys(manifest)) {
    if (!MANIFEST_KEYS.has(key)) add('docs/manifest', `docs/manifest.json has unknown key "${key}"`);
  }
  if ('readme' in manifest && typeof manifest.readme !== 'boolean') {
    add('docs/manifest', 'readme must be a boolean');
  }
  for (const key of ['features', 'diagrams']) {
    if (key in manifest && !isStringArray(manifest[key])) {
      add('docs/manifest', `${key} must be an array of strings`);
    }
  }
  if (isInvalidApi(manifest.api)) {
    add('docs/manifest', 'api must be a spec path or an object with a string spec');
  }
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isInvalidApi(api) {
  if (api === undefined || api === null) return false;
  return !(typeof api === 'string' || (typeof api === 'object' && typeof api.spec === 'string'));
}

function checkFeatureDocs(root, index, manifest, add) {
  const indexTargets = existsSync(index) ? fileLinks(index) : [];
  for (const rel of stringArray(manifest.features)) {
    const full = resolve(root, rel);
    if (!existsSync(full)) add('docs/feature', `declared feature doc ${rel} is missing`);
    else if (!indexTargets.some((target) => samePath(target, full))) {
      add('docs/feature', `declared feature doc ${rel} is not linked from docs/README.md`);
    }
  }
}

function checkDiagramDocs(root, manifest, add) {
  const fence = new RegExp(`\`\`\`\\s*(${DIAGRAM_FENCES.join('|')})\\b`);
  for (const rel of stringArray(manifest.diagrams)) {
    const full = resolve(root, rel);
    if (!existsSync(full)) {
      add('docs/diagram', `declared diagram doc ${rel} is missing`);
      continue;
    }
    if (!fence.test(normalize(readText(full)))) {
      add('docs/diagram', `declared diagram doc ${rel} has no supported diagram fence`);
    }
  }
}

function checkApiSpec(root, manifest, add) {
  if (typeof manifest.api !== 'string' && !(manifest.api && typeof manifest.api.spec === 'string')) return;
  const spec = typeof manifest.api === 'string' ? manifest.api : manifest.api.spec;
  const full = resolve(root, spec);
  if (!existsSync(full)) {
    add('docs/api', `declared API spec ${spec} is missing`);
    return;
  }
  if (!hasOpenapiVersion(spec, normalize(readText(full)))) {
    add('docs/api', `declared API spec ${spec} has no openapi/asyncapi version`);
  }

  const rel = toPosix(relative(root, full));
  if (!marksGenerated(root, rel)) {
    add('docs/api-generated', `${spec} is not marked linguist-generated in .gitattributes`);
  }
  if (!hasSpecRecipe(root)) {
    add('docs/api-generated', 'justfile has no "spec" recipe to regenerate the API document');
  }
}

function hasOpenapiVersion(spec, text) {
  if (/\.json$/i.test(spec)) {
    try {
      const data = JSON.parse(text);
      return Boolean(data.openapi || data.asyncapi);
    } catch {
      return false;
    }
  }
  return /^\s*(openapi|asyncapi):\s*\S/m.test(text);
}
