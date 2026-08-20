/**
 * `when` expression evaluator (S-04 §3.5 "When-язык", S-03 §3.9).
 *
 * Extends the boolean-only language of
 * apps/electron/src/renderer/actions/keybinding-context.ts with comparisons
 * and counters: `==`, `!=`, `>`, `<`, `>=`, `<=`, `&&`, `||`, `!`, parens and
 * `.count` over array-valued keys. Hand-rolled tiny parser — NOT filtrex or
 * any other dependency.
 *
 * Examples (verbatim from specs):
 *   activeSurface=='knowledge'
 *   activeSurface=='knowledge' || activeSurface=='session'
 *   activeSurface=='knowledge' && selectedBlocks.count>0 && agent.available==true
 *
 * Semantics:
 *  - `undefined`/empty expression → true (no `when` = always available).
 *  - Unknown keys resolve to `undefined`; bare-identifier terms are truthy
 *    tests; comparisons against `undefined` are false (except `!=`).
 *  - Parse errors never throw: they evaluate to false.
 */

import type { ContextKeys } from './types.ts';

type Token =
  | { type: 'op'; value: '&&' | '||' | '!' | '==' | '!=' | '>=' | '<=' | '>' | '<' }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'ident'; value: string };

class WhenSyntaxError extends Error {}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === undefined) break;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i++;
      continue;
    }
    if (ch === '&' && input[i + 1] === '&') {
      tokens.push({ type: 'op', value: '&&' });
      i += 2;
      continue;
    }
    if (ch === '|' && input[i + 1] === '|') {
      tokens.push({ type: 'op', value: '||' });
      i += 2;
      continue;
    }
    if (ch === '=' && input[i + 1] === '=') {
      tokens.push({ type: 'op', value: '==' });
      i += 2;
      continue;
    }
    if (ch === '!' && input[i + 1] === '=') {
      tokens.push({ type: 'op', value: '!=' });
      i += 2;
      continue;
    }
    if (ch === '!') {
      tokens.push({ type: 'op', value: '!' });
      i++;
      continue;
    }
    if (ch === '>' && input[i + 1] === '=') {
      tokens.push({ type: 'op', value: '>=' });
      i += 2;
      continue;
    }
    if (ch === '<' && input[i + 1] === '=') {
      tokens.push({ type: 'op', value: '<=' });
      i += 2;
      continue;
    }
    if (ch === '>') {
      tokens.push({ type: 'op', value: '>' });
      i++;
      continue;
    }
    if (ch === '<') {
      tokens.push({ type: 'op', value: '<' });
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const end = input.indexOf(ch, i + 1);
      if (end === -1) throw new WhenSyntaxError('unterminated string literal');
      tokens.push({ type: 'string', value: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      let j = i;
      while (j < input.length) {
        const cj = input[j];
        if (cj === undefined || !/[0-9.]/.test(cj)) break;
        j++;
      }
      const raw = input.slice(i, j);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new WhenSyntaxError(`bad number: ${raw}`);
      tokens.push({ type: 'number', value });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < input.length) {
        const cj = input[j];
        if (cj === undefined || !/[A-Za-z0-9_$.]/.test(cj)) break;
        j++;
      }
      tokens.push({ type: 'ident', value: input.slice(i, j) });
      i = j;
      continue;
    }
    throw new WhenSyntaxError(`unexpected character: ${ch}`);
  }
  return tokens;
}

function resolvePath(path: string, keys: ContextKeys): unknown {
  // Flat-key publishers (e.g. `selectedBlocks.count` as a number) win.
  if (Object.prototype.hasOwnProperty.call(keys, path)) return keys[path];
  let current: unknown = keys[path.split('.')[0] ?? ''];
  for (const segment of path.split('.').slice(1)) {
    // `.count` over an array-valued key (S-04 §3.5: counter suffix).
    if (segment === 'count' && Array.isArray(current)) return current.length;
    if (current === null || typeof current !== 'object') return undefined;
    if (!(segment in current)) return undefined;
    // `in` narrowing guarantees the key exists on the object (TS 4.9+).
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function compare(left: unknown, right: unknown, fn: (a: number, b: number) => boolean): boolean {
  if (typeof left === 'number' && typeof right === 'number') return fn(left, right);
  if (typeof left === 'string' && typeof right === 'string') {
    return fn(left < right ? -1 : left > right ? 1 : 0, 0);
  }
  return false;
}

function parse(tokens: Token[], keys: ContextKeys): boolean {
  let pos = 0;

  function peek(): Token | undefined {
    return tokens[pos];
  }

  function parsePrimary(): unknown {
    const token = peek();
    if (token === undefined) throw new WhenSyntaxError('unexpected end of expression');
    if (token.type === 'lparen') {
      pos++;
      const value = parseOr();
      if (peek()?.type !== 'rparen') throw new WhenSyntaxError('missing closing parenthesis');
      pos++;
      return value;
    }
    if (token.type === 'string') {
      pos++;
      return token.value;
    }
    if (token.type === 'number') {
      pos++;
      return token.value;
    }
    if (token.type === 'ident') {
      pos++;
      if (token.value === 'true') return true;
      if (token.value === 'false') return false;
      return resolvePath(token.value, keys);
    }
    throw new WhenSyntaxError(`unexpected token kind: ${token.type}`);
  }

  function parseComparison(): unknown {
    const left = parsePrimary();
    const token = peek();
    if (
      token?.type !== 'op' ||
      !(token.value === '==' || token.value === '!=' || token.value === '>' || token.value === '<' || token.value === '>=' || token.value === '<=')
    ) {
      return left;
    }
    pos++;
    const right = parsePrimary();
    if (token.value === '==') return left === right;
    if (token.value === '!=') return left !== right;
    if (token.value === '>') return compare(left, right, (a, b) => a > b);
    if (token.value === '<') return compare(left, right, (a, b) => a < b);
    if (token.value === '>=') return compare(left, right, (a, b) => a >= b);
    return compare(left, right, (a, b) => a <= b);
  }

  function parseUnary(): unknown {
    const token = peek();
    if (token?.type === 'op' && token.value === '!') {
      pos++;
      return !parseUnary();
    }
    return parseComparison();
  }

  function parseAnd(): boolean {
    let left = Boolean(parseUnary());
    for (;;) {
      const token = peek();
      if (token?.type !== 'op' || token.value !== '&&') return left;
      pos++;
      const right = Boolean(parseUnary());
      left = left && right;
    }
  }

  function parseOr(): boolean {
    let left = parseAnd();
    for (;;) {
      const token = peek();
      if (token?.type !== 'op' || token.value !== '||') return left;
      pos++;
      const right = parseAnd();
      left = left || right;
    }
  }

  const result = parseOr();
  if (pos !== tokens.length) throw new WhenSyntaxError('trailing tokens after expression');
  return result;
}

/**
 * Evaluate a `when` expression against a context key snapshot.
 * Never throws: malformed expressions evaluate to false.
 */
export function evaluateWhen(expression: string | undefined, keys: ContextKeys): boolean {
  if (expression === undefined || expression.trim() === '') return true;
  try {
    return parse(tokenize(expression), keys);
  } catch (error) {
    if (error instanceof WhenSyntaxError) {
      console.warn(`[evaluateWhen] malformed expression "${expression}": ${error.message}`);
      return false;
    }
    throw error;
  }
}
