// Strict RFC 8259 JSON parser that keeps the original lexeme of every number,
// so numeric validators can work from the source text instead of a JS Number.

import { NumberLexemeError, parseJsonNumber, type Decimal } from './decimal.js';

export type JsonNode =
  | { kind: 'number'; value: Decimal }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' }
  | { kind: 'array'; items: JsonNode[] }
  | { kind: 'object'; entries: Array<[string, JsonNode]> };

/** Malformed JSON text (grammar) or a number lexeme rejected by the budget. */
export class JsonSyntaxError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(`${message} at position ${position}`);
    this.name = 'JsonSyntaxError';
  }
}

/** Parse a complete JSON document; number lexemes survive verbatim. */
export function parseJson(text: string): JsonNode {
  const p = new Parser(text);
  p.skipWhitespace();
  const node = p.parseValue();
  p.skipWhitespace();
  if (p.pos !== text.length) throw new JsonSyntaxError('trailing characters', p.pos);
  return node;
}

class Parser {
  pos = 0;

  constructor(private readonly text: string) {}

  fail(message: string): never {
    throw new JsonSyntaxError(message, this.pos);
  }

  skipWhitespace(): void {
    const { text } = this;
    while (this.pos < text.length) {
      const ch = text.charCodeAt(this.pos);
      if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d) this.pos++;
      else break;
    }
  }

  parseValue(): JsonNode {
    const { text } = this;
    if (this.pos >= text.length) this.fail('unexpected end of input');
    const ch = text[this.pos];
    if (ch === '{') return this.parseObject();
    if (ch === '[') return this.parseArray();
    if (ch === '"') return { kind: 'string', value: this.parseString() };
    if (ch === 't') return this.parseLiteral('true', true);
    if (ch === 'f') return this.parseLiteral('false', false);
    if (ch === 'n') return this.parseNull();
    if (ch === '-' || (ch >= '0' && ch <= '9')) return this.parseNumber();
    this.fail('unexpected token');
  }

  private parseLiteral(literal: string, value: boolean): JsonNode {
    if (!this.text.startsWith(literal, this.pos)) {
      this.fail(`invalid literal, expected ${literal}`);
    }
    this.pos += literal.length;
    return { kind: 'boolean', value };
  }

  private parseNull(): JsonNode {
    if (!this.text.startsWith('null', this.pos)) {
      this.fail('invalid literal, expected null');
    }
    this.pos += 4;
    return { kind: 'null' };
  }

  private parseNumber(): JsonNode {
    const start = this.pos;
    const { text } = this;
    if (text[this.pos] === '-') this.pos++;
    // Integer part is the only digit run with a leading-zero restriction.
    this.scanIntegerDigits();
    if (text[this.pos] === '.') {
      this.pos++;
      const fracStart = this.pos;
      this.scanAnyDigits();
      if (this.pos === fracStart) this.fail('digit expected after fraction point');
    }
    if (text[this.pos] === 'e' || text[this.pos] === 'E') {
      this.pos++;
      if (text[this.pos] === '+' || text[this.pos] === '-') this.pos++;
      const expStart = this.pos;
      this.scanAnyDigits();
      if (this.pos === expStart) this.fail('digit expected in exponent');
    }
    const lexeme = text.slice(start, this.pos);
    try {
      return { kind: 'number', value: parseJsonNumber(lexeme) };
    } catch (err) {
      if (err instanceof NumberLexemeError) {
        throw new JsonSyntaxError(err.message, start);
      }
      throw err;
    }
  }

  private scanAnyDigits(): void {
    const { text } = this;
    while (this.pos < text.length) {
      const ch = text.charCodeAt(this.pos);
      if (ch >= 48 && ch <= 57) this.pos++;
      else break;
    }
  }

  private scanIntegerDigits(): void {
    const { text } = this;
    const start = this.pos;
    this.scanAnyDigits();
    if (this.pos === start) this.fail('digit expected');
    if (this.pos - start > 1 && text[start] === '0') {
      this.fail('leading zeros are not allowed');
    }
  }

  private parseArray(): JsonNode {
    this.pos++; // [
    const items: JsonNode[] = [];
    this.skipWhitespace();
    if (this.text[this.pos] === ']') {
      this.pos++;
      return { kind: 'array', items };
    }
    for (;;) {
      this.skipWhitespace();
      items.push(this.parseValue());
      this.skipWhitespace();
      const ch = this.text[this.pos];
      if (ch === ',') {
        this.pos++;
        continue;
      }
      if (ch === ']') {
        this.pos++;
        return { kind: 'array', items };
      }
      this.fail("expected ',' or ']'");
    }
  }

  private parseObject(): JsonNode {
    this.pos++; // {
    const entries: Array<[string, JsonNode]> = [];
    this.skipWhitespace();
    if (this.text[this.pos] === '}') {
      this.pos++;
      return { kind: 'object', entries };
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.pos] !== '"') this.fail('expected property key string');
      const key = this.parseString();
      this.skipWhitespace();
      if (this.text[this.pos] !== ':') this.fail("expected ':'");
      this.pos++;
      this.skipWhitespace();
      const value = this.parseValue();
      entries.push([key, value]);
      this.skipWhitespace();
      const ch = this.text[this.pos];
      if (ch === ',') {
        this.pos++;
        continue;
      }
      if (ch === '}') {
        this.pos++;
        return { kind: 'object', entries };
      }
      this.fail("expected ',' or '}'");
    }
  }

  private parseString(): string {
    this.pos++; // opening quote
    const { text } = this;
    let out = '';
    while (this.pos < text.length) {
      const code = text.charCodeAt(this.pos);
      if (code === 0x22) {
        this.pos++;
        return out;
      }
      if (code === 0x5c) {
        this.pos++;
        if (this.pos >= text.length) this.fail('unterminated escape');
        const esc = text[this.pos];
        switch (esc) {
          case '"': out += '"'; break;
          case '\\': out += '\\'; break;
          case '/': out += '/'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'n': out += '\n'; break;
          case 'r': out += '\r'; break;
          case 't': out += '\t'; break;
          case 'u': {
            const codePoint = this.parseHex4();
            if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
              // High surrogate must be followed by \uXXXX low surrogate.
              if (text[this.pos] !== '\\' || text[this.pos + 1] !== 'u') {
                this.fail('lone high surrogate');
              }
              this.pos += 2; // skip backslash and 'u'
              const low = this.parseHex4();
              if (low < 0xdc00 || low > 0xdfff) this.fail('invalid low surrogate');
              out += String.fromCharCode(codePoint, low);
            } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
              this.fail('lone low surrogate');
            } else {
              out += String.fromCodePoint(codePoint);
            }
            break;
          }
          default:
            this.fail('invalid escape');
        }
        // For '\u' escapes the position is already past the four hex digits.
        if (esc !== 'u') this.pos++;
      } else if (code < 0x20) {
        this.fail('unescaped control character');
      } else {
        out += text[this.pos];
        this.pos++;
      }
    }
    this.fail('unterminated string');
  }

  /** Reads four hex digits starting at pos; leaves pos after them. */
  private parseHex4(): number {
    if (this.pos + 4 > this.text.length) this.fail('incomplete unicode escape');
    const hex = this.text.slice(this.pos, this.pos + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail('invalid unicode escape');
    this.pos += 4;
    return parseInt(hex, 16);
  }
}
