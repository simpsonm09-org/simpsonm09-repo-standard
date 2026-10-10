import { relative } from 'node:path';
import { tokenize } from './js-tokens.mjs';
import { isVendoredSkill } from './scripting.mjs';
import { listFiles, normalize, readText, toPosix } from './tree.mjs';

// The subprocess group. A GUI-hosted Node process that starts a console program opens
// an empty console window on Windows unless its child_process options set windowsHide:
// true. Each call into node:child_process must pass that literal key. The scan is
// token-based, so the fleet keeps no parser. It follows each import and require form,
// and a name defaulted or assigned from one of the functions (`spawn = spawnSync`).

const MODULES = new Set(['node:child_process', 'child_process']);
const CALLS = new Set(['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']);
const EXTENSIONS = ['.mjs', '.js', '.cjs', '.ts', '.mts', '.cts'];
const SKIP_DIRS = new Set(['node_modules', '.git']);
const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);

const isP = (tok, value) => tok?.type === 'punc' && tok.value === value;
const isW = (tok, value) => tok?.type === 'id' && tok.value === value;
const isKeyword = (tok) => isW(tok, 'require') || isW(tok, 'import');
const nameOf = (tok) => (tok.type === 'str' ? tok.value.slice(1, -1) : tok.value);

// The bracket paired with toks[at]: the closer after an opener, or the opener before a
// closer. Returns toks.length (or -1) when the walk runs out of tokens.
function pair(toks, at) {
  const step = OPEN.has(toks[at].value) ? 1 : -1;
  let depth = 0;
  for (let j = at; j >= 0 && j < toks.length; j += step) {
    if (toks[j].type !== 'punc') continue;
    if (OPEN.has(toks[j].value)) depth += step;
    else if (CLOSE.has(toks[j].value)) depth -= step;
    if (depth === 0) return j;
  }
  return step > 0 ? toks.length : -1;
}

// Top-level [start, end) ranges between commas in toks[s..e), empty ranges dropped.
function splitTop(toks, s, e) {
  const out = [];
  let depth = 0;
  let start = s;
  for (let j = s; j < e; j += 1) {
    if (toks[j].type !== 'punc') continue;
    if (OPEN.has(toks[j].value)) depth += 1;
    else if (CLOSE.has(toks[j].value)) depth -= 1;
    else if (toks[j].value === ',' && depth === 0) {
      out.push([start, j]);
      start = j + 1;
    }
  }
  if (start < e) out.push([start, e]);
  return out.filter(([a, b]) => b > a);
}

// `modules` holds the local names of the whole module. `fns` maps a local name to its function.
function bindings(toks) {
  const modules = new Set();
  const fns = new Map();

  // The inside of a braced import or destructuring pattern: `a`, `b as c`, or `b: c`.
  const named = (s, e) => {
    for (const [a, b] of splitTop(toks, s, e)) {
      const i = isW(toks[a], 'type') && b - a > 1 && toks[a + 1].type === 'id' ? a + 1 : a;
      const imported = nameOf(toks[i]);
      const local = i + 2 < b && (isW(toks[i + 1], 'as') || isP(toks[i + 1], ':')) ? nameOf(toks[i + 2]) : imported;
      if (imported === 'default') modules.add(local);
      else if (CALLS.has(imported)) fns.set(local, imported);
    }
  };

  // The clause of `import <clause> from`, which runs from the `import` keyword to `from`.
  const importClause = (from) => {
    let start = from;
    while (start >= 0 && !isW(toks[start], 'import') && !isW(toks[start], 'export') && !isP(toks[start], ';')) start -= 1;
    if (!isW(toks[start], 'import')) return;
    for (let i = start + 1; i < from; i += 1) {
      if (isP(toks[i], '{')) {
        named(i + 1, pair(toks, i));
        i = pair(toks, i);
      } else if (isP(toks[i], '*')) {
        modules.add(toks[i + 2].value);
        i += 2;
      } else if (toks[i].type === 'id' && toks[i].value !== 'type') modules.add(toks[i].value);
    }
  };

  // `X = require(...)`, `{ a: b } = await import(...)`, and the like. `k` is the keyword.
  const assignedRequire = (k) => {
    let b = k - 1;
    if (isW(toks[b], 'await')) b -= 1;
    if (!isP(toks[b], '=')) return;
    b -= 1;
    if (isP(toks[b], '}')) named(pair(toks, b) + 1, b);
    else if (toks[b]?.type === 'id') modules.add(toks[b].value);
  };

  toks.forEach((t, k) => {
    if (t.type !== 'str' || !MODULES.has(nameOf(t))) return;
    if (isW(toks[k - 1], 'from')) importClause(k - 1);
    else if (isP(toks[k - 1], '(') && isKeyword(toks[k - 2])) assignedRequire(k - 2);
  });

  // `spawn = spawnSync`, in a default or an assignment, binds spawn to the same function.
  toks.forEach((rhs, k) => {
    if (k < 2 || rhs.type !== 'id' || !fns.has(rhs.value) || !isP(toks[k - 1], '=') || toks[k - 2].type !== 'id') return;
    if (['(', '.', '['].some((v) => isP(toks[k + 1], v))) return;
    fns.set(toks[k - 2].value, fns.get(rhs.value));
  });
  return { modules, fns };
}

// A `.spawn(` or `.default.spawn(` member call starting at toks[at], or null.
function memberCallAt(toks, at) {
  const m = isP(toks[at], '.') && isW(toks[at + 1], 'default') && isP(toks[at + 2], '.') ? at + 2 : at;
  if (isP(toks[m], '.') && toks[m + 1]?.type === 'id' && CALLS.has(toks[m + 1].value) && isP(toks[m + 2], '(')) {
    return { fn: toks[m + 1].value, open: m + 2 };
  }
  return null;
}

// Every call into a bound name, as { fn, name, open, close }. `name` is the token the line is read from.
function findCalls(toks, { modules, fns }) {
  const calls = [];
  const add = (fn, name, open) => calls.push({ fn, name, open, close: pair(toks, open) });
  toks.forEach((t, k) => {
    if (t.type === 'id' && !isP(toks[k - 1], '.') && !isW(toks[k - 1], 'function')) {
      if (fns.has(t.value) && isP(toks[k + 1], '(')) add(fns.get(t.value), k, k + 1);
      const member = modules.has(t.value) ? memberCallAt(toks, k + 1) : null;
      if (member) add(member.fn, k, member.open);
    } else if (t.type === 'str' && MODULES.has(nameOf(t)) && isP(toks[k - 1], '(') && isP(toks[k + 1], ')') && isKeyword(toks[k - 2])) {
      const member = memberCallAt(toks, k + 2);
      if (member) add(member.fn, k - 2, member.open);
    }
  });
  return calls;
}

const isObjectLiteral = (toks, [a, b]) => isP(toks[a], '{') && pair(toks, a) === b - 1;
const isFunctionValue = (toks, [a, b]) => isW(toks[a], 'function') || toks.slice(a, b).some((t) => isP(t, '=>'));

// The options object must set windowsHide to the literal true, and no spread may follow that key.
function literalGap(toks, [a, b]) {
  let state = 'absent';
  for (const [s, e] of splitTop(toks, a + 1, b - 1)) {
    if (isP(toks[s], '...')) {
      if (state === 'literal') return 'a spread after windowsHide: true can override it';
    } else if (['id', 'str'].includes(toks[s].type) && nameOf(toks[s]) === 'windowsHide') {
      state = e - s === 3 && isP(toks[s + 1], ':') && isW(toks[s + 2], 'true') ? 'literal' : 'other';
    }
  }
  if (state === 'literal') return null;
  return state === 'other' ? 'windowsHide must be the literal true' : 'options object has no literal windowsHide: true';
}

// Why a call's options fail, or null. exec takes its options second. A spawn-like call takes
// them third, or second when that argument is an object or a callback.
function callGap(toks, call) {
  const args = splitTop(toks, call.open + 1, call.close);
  const second = args[1];
  const secondIsOptions = second && (isObjectLiteral(toks, second) || isFunctionValue(toks, second));
  const range = args[['exec', 'execSync'].includes(call.fn) || secondIsOptions ? 1 : 2];
  if (range && isObjectLiteral(toks, range)) return literalGap(toks, range);
  if (!range || isFunctionValue(toks, range)) return 'has no options; pass a literal { windowsHide: true }';
  return 'options are a variable; inline a literal { windowsHide: true } at this call';
}

// The failing calls in one source text, as { line, fn, reason }.
export function findSubprocessGaps(src) {
  const toks = tokenize(src);
  return findCalls(toks, bindings(toks)).flatMap((call) => {
    const reason = callGap(toks, call);
    if (!reason) return [];
    return [{ line: src.slice(0, toks[call.name].start).split('\n').length, fn: call.fn, reason }];
  });
}

// Adds one gap per failing call in the repository's source files. Vendored skills are
// exempt, as they are in the scripting group.
export function checkSubprocess(root, add) {
  for (const file of listFiles(root, EXTENSIONS, SKIP_DIRS)) {
    const rel = toPosix(relative(root, file));
    if (isVendoredSkill(root, rel)) continue;
    for (const gap of findSubprocessGaps(normalize(readText(file)))) {
      add('subprocess/windows-hide', `${rel}:${gap.line} ${gap.fn}() ${gap.reason}`);
    }
  }
}
