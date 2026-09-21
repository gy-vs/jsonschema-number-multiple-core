/**
 * Minimal JSON parser that keeps number lexemes as raw text, so numeric
 * validation can happen on the exact decimal the author wrote instead of
 * on a lossy IEEE-754 double.
 */

/** A JSON number together with its original lexical representation. */
export class JsonNumber {
  constructor(public readonly raw: string) {}
}

export type JsonValue = string | JsonNumber | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= '0' && ch <= '9';

export function parseJson(text: string): JsonValue {
  let pos = 0;

  const fail = (message: string): never => {
    throw new SyntaxError(`invalid JSON at offset ${pos}: ${message}`);
  };

  const skipWhitespace = (): void => {
    while (pos < text.length && (text[pos] === ' ' || text[pos] === '\t' || text[pos] === '\n' || text[pos] === '\r')) {
      pos++;
    }
  };

  const parseString = (): string => {
    pos++; // opening quote
    let out = '';
    for (;;) {
      if (pos >= text.length) fail('unterminated string');
      const ch = text[pos];
      if (ch === '"') {
        pos++;
        return out;
      }
      if (ch === '\\') {
        const esc = text[pos + 1];
        pos += 2;
        switch (esc) {
          case '"': out += '"'; continue;
          case '\\': out += '\\'; continue;
          case '/': out += '/'; continue;
          case 'b': out += '\b'; continue;
          case 'f': out += '\f'; continue;
          case 'n': out += '\n'; continue;
          case 'r': out += '\r'; continue;
          case 't': out += '\t'; continue;
          case 'u': {
            const hex = text.slice(pos, pos + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('invalid \\u escape');
            let code = Number.parseInt(hex, 16);
            pos += 4;
            if (code >= 0xd800 && code <= 0xdbff && text.slice(pos, pos + 2) === '\\u') {
              const lowHex = text.slice(pos + 2, pos + 6);
              const low = /^[0-9a-fA-F]{4}$/.test(lowHex) ? Number.parseInt(lowHex, 16) : -1;
              if (low >= 0xdc00 && low <= 0xdfff) {
                code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
                pos += 6;
              }
            }
            out += String.fromCodePoint(code);
            continue;
          }
          default:
            fail('invalid escape sequence');
        }
      }
      if (ch < ' ') fail('unescaped control character in string');
      out += ch;
      pos++;
    }
  };

  const parseNumber = (): JsonNumber => {
    const start = pos;
    if (text[pos] === '-') pos++;
    if (text[pos] === '0') {
      pos++;
    } else if (isDigit(text[pos])) {
      while (isDigit(text[pos])) pos++;
    } else {
      fail('invalid number');
    }
    if (text[pos] === '.') {
      pos++;
      if (!isDigit(text[pos])) fail('invalid number');
      while (isDigit(text[pos])) pos++;
    }
    if (text[pos] === 'e' || text[pos] === 'E') {
      pos++;
      if (text[pos] === '+' || text[pos] === '-') pos++;
      if (!isDigit(text[pos])) fail('invalid number');
      while (isDigit(text[pos])) pos++;
    }
    return new JsonNumber(text.slice(start, pos));
  };

  const parseValue = (): JsonValue => {
    skipWhitespace();
    const ch = text[pos];
    if (ch === '{') {
      pos++;
      const obj: { [key: string]: JsonValue } = {};
      skipWhitespace();
      if (text[pos] === '}') {
        pos++;
        return obj;
      }
      for (;;) {
        skipWhitespace();
        if (text[pos] !== '"') fail('expected object key');
        const key = parseString();
        skipWhitespace();
        if (text[pos] !== ':') fail(`expected ':'`);
        pos++;
        obj[key] = parseValue();
        skipWhitespace();
        if (text[pos] === ',') {
          pos++;
          continue;
        }
        if (text[pos] === '}') {
          pos++;
          return obj;
        }
        fail(`expected ',' or '}'`);
      }
    }
    if (ch === '[') {
      pos++;
      const arr: JsonValue[] = [];
      skipWhitespace();
      if (text[pos] === ']') {
        pos++;
        return arr;
      }
      for (;;) {
        arr.push(parseValue());
        skipWhitespace();
        if (text[pos] === ',') {
          pos++;
          continue;
        }
        if (text[pos] === ']') {
          pos++;
          return arr;
        }
        fail(`expected ',' or ']'`);
      }
    }
    if (ch === '"') return parseString();
    if (ch === '-' || isDigit(ch)) return parseNumber();
    if (text.startsWith('true', pos)) {
      pos += 4;
      return true;
    }
    if (text.startsWith('false', pos)) {
      pos += 5;
      return false;
    }
    if (text.startsWith('null', pos)) {
      pos += 4;
      return null;
    }
    return fail('unexpected token');
  };

  skipWhitespace();
  const value = parseValue();
  skipWhitespace();
  if (pos !== text.length) fail('unexpected trailing data');
  return value;
}
