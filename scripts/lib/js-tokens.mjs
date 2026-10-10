// A small JavaScript tokenizer for the subprocess check. It keeps identifiers,
// strings, numbers, and punctuation, and drops comments and whitespace. A template
// literal and a regular expression are read whole, so a quote or a bracket inside
// one cannot unbalance the rest of the file. Template text is a `str` token with no
// quotes, so compare keywords and punctuation by type as well as by value.

const REGEX_AFTER = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const CLOSERS = new Set([')', ']', '}']);

function scan(src, start, pattern) {
  let j = start;
  while (j < src.length && pattern.test(src[j])) j += 1;
  return j;
}

function stringEnd(src, start) {
  let j = start + 1;
  while (j < src.length && src[j] !== src[start] && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
  return src[j] === src[start] ? j + 1 : j;
}

// A regular expression literal, matched whole: an escape, a class (which may hold a slash), or any other character.
const REGEX_LITERAL = /\/(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\[\n])+\/[A-Za-z]*/y;

// Sets REGEX_LITERAL.lastIndex to the end of a regular expression that starts at `at`, and reports whether one does.
function matchRegex(src, at) {
  REGEX_LITERAL.lastIndex = at;
  return REGEX_LITERAL.test(src);
}

function regexAllowed(toks) {
  const prev = toks.at(-1);
  if (!prev) return true;
  if (prev.type === 'id') return REGEX_AFTER.has(prev.value);
  return prev.type === 'punc' && !CLOSERS.has(prev.value);
}

// The lexer state: the source, the tokens so far, and one entry per open brace. A brace entry is
// '{' for a block or '${' for a template expression, whose closing '}' resumes the template.
function lexer(src) {
  return { src, toks: [], braces: [] };
}

function emit(lex, type, start, end) {
  lex.toks.push({ type, value: lex.src.slice(start, end), start, end });
  return end;
}

// Reads template text from `from` to a closing backtick, or to a `${` that opens an expression.
function readTemplate(lex, from) {
  const { src } = lex;
  let j = from;
  while (j < src.length && src[j] !== '`' && !src.startsWith('${', j)) j += src[j] === '\\' ? 2 : 1;
  if (src[j] === '`') return emit(lex, 'str', from, j) + 1;
  if (j >= src.length) return emit(lex, 'str', from, src.length);
  lex.braces.push('${');
  return emit(lex, 'str', from, j) + 2;
}

// The index after a line or block comment that starts at i, or -1 when none starts there.
function commentEnd(src, i) {
  if (src.startsWith('//', i)) return src.indexOf('\n', i) < 0 ? src.length : src.indexOf('\n', i);
  if (src.startsWith('/*', i)) return src.indexOf('*/', i + 2) < 0 ? src.length : src.indexOf('*/', i + 2) + 2;
  return -1;
}

// Identifiers, numbers, and the punctuation that is left over.
function readWordOrPunc(lex, i, c) {
  if (/[A-Za-z_$]/.test(c)) return emit(lex, 'id', i, scan(lex.src, i, /[A-Za-z0-9_$]/));
  if (/[0-9]/.test(c)) return emit(lex, 'num', i, scan(lex.src, i, /[0-9A-Za-z_.]/));
  return emit(lex, 'punc', i, i + (['...', '=>'].find((p) => lex.src.startsWith(p, i)) ?? c).length);
}

// Reads the token that starts at i, whose first character is c. Returns the index after it.
function readToken(lex, i, c) {
  const { src, toks, braces } = lex;
  if (c === '"' || c === "'") return emit(lex, 'str', i, stringEnd(src, i));
  if (c === '`') return readTemplate(lex, i + 1);
  if (c === '{') {
    braces.push('{');
    return emit(lex, 'punc', i, i + 1);
  }
  if (c === '}') return braces.pop() === '${' ? readTemplate(lex, i + 1) : emit(lex, 'punc', i, i + 1);
  if (c === '/' && regexAllowed(toks) && matchRegex(src, i)) return emit(lex, 'regex', i, REGEX_LITERAL.lastIndex);
  return readWordOrPunc(lex, i, c);
}

// Reads one token, or skips the whitespace or comment at i. Returns the index after it.
function readAt(lex, i) {
  const c = lex.src[i];
  if (/\s/.test(c)) return i + 1;
  const afterComment = commentEnd(lex.src, i);
  if (afterComment >= 0) return afterComment;
  return readToken(lex, i, c);
}

export function tokenize(src) {
  const lex = lexer(src);
  let i = 0;
  while (i < src.length) i = readAt(lex, i);
  return lex.toks;
}
