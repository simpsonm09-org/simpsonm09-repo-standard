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
const REGEX_LITERAL = /\/(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^\/\\[\n])+\/[A-Za-z]*/y;

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

export function tokenize(src) {
  const toks = [];
  // One entry per open brace: '{' for a block or '${' for a template expression, whose closing '}' resumes the template.
  const braces = [];
  let i = 0;
  const emit = (type, start, end) => {
    toks.push({ type, value: src.slice(start, end), start, end });
    return end;
  };
  // Reads template text from `from` to a closing backtick, or to a `${` that opens an expression.
  const template = (from) => {
    let j = from;
    while (j < src.length && src[j] !== '`' && !src.startsWith('${', j)) j += src[j] === '\\' ? 2 : 1;
    if (src[j] === '`') return emit('str', from, j) + 1;
    if (j >= src.length) return emit('str', from, src.length);
    braces.push('${');
    return emit('str', from, j) + 2;
  };

  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) i += 1;
    else if (src.startsWith('//', i)) i = src.indexOf('\n', i) < 0 ? src.length : src.indexOf('\n', i);
    else if (src.startsWith('/*', i)) i = src.indexOf('*/', i + 2) < 0 ? src.length : src.indexOf('*/', i + 2) + 2;
    else if (c === '"' || c === "'") i = emit('str', i, stringEnd(src, i));
    else if (c === '`') i = template(i + 1);
    else if (c === '{') {
      braces.push('{');
      i = emit('punc', i, i + 1);
    } else if (c === '}') i = braces.pop() === '${' ? template(i + 1) : emit('punc', i, i + 1);
    else if (c === '/' && regexAllowed(toks) && matchRegex(src, i)) i = emit('regex', i, REGEX_LITERAL.lastIndex);
    else if (/[A-Za-z_$]/.test(c)) i = emit('id', i, scan(src, i, /[A-Za-z0-9_$]/));
    else if (/[0-9]/.test(c)) i = emit('num', i, scan(src, i, /[0-9A-Za-z_.]/));
    else i = emit('punc', i, i + (['...', '=>'].find((p) => src.startsWith(p, i)) ?? c).length);
  }
  return toks;
}
