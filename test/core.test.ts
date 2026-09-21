import { expect, it } from 'vitest';
import {
  SchemaCompileError,
  compileSchema,
  num,
  validate,
  validateJson,
  NumberLexemeError,
  parseJsonNumber,
  MAX_DIGITS,
  MAX_EXPONENT_ABS,
  compareDecimal,
  isMultipleOf,
} from '../src/index.js';

// --- Legacy API compatibility ---

it('legacy validate still works', () =>
  expect(validate({ type: 'string' }, 3)).toHaveLength(1));

// --- multipleOf: exact integer ratio, no binary-float residue ---

const centSchema = compileSchema('{"type":"number","multipleOf":0.01}');

it('accepts 0.29 against multipleOf 0.01 (the binary-float residue case)', () => {
  expect(validateJson(centSchema, '0.29')).toEqual([]);
});

it('accepts a sweep of cents exactly', () => {
  for (let i = 0; i <= 100; i++) {
    const cents = i;
    const value = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
    expect(validateJson(centSchema, value)).toEqual([]);
  }
});

it('rejects near-boundary non-multiples that an epsilon heuristic would let through', () => {
  // 0.29999999999999999 is NOT 0.30; a tolerance-based check would accept it.
  const issues = validateJson(centSchema, '0.29999999999999999');
  expect(issues).toHaveLength(1);
  expect(issues[0].message).toBe('0.29999999999999999 is not a multiple of 0.01');
});

it('rejects 0.291 and keeps the instance text verbatim', () => {
  const issues = validateJson(centSchema, '0.291');
  expect(issues[0].message).toBe('0.291 is not a multiple of 0.01');
  expect(issues[0].path).toBe('#');
});

it('scientific notation divisors and values', () => {
  const schema = compileSchema('{"type":"number","multipleOf":1e-3}');
  expect(validateJson(schema, '2.50E2')).toEqual([]);
  expect(validateJson(schema, '0.005')).toEqual([]);
  expect(validateJson(schema, '0.0005')).toHaveLength(1);
});

it('trailing zeros and different lexical equivalents behave identically', () => {
  const variants = ['1', '1.0', '1.00', '1e0', '1E0', '1.0e0', '0.1e1', '100e-2', '+1'.replace('+', '')];
  for (const v of variants) {
    expect(validateJson(centSchema, v)).toEqual([], `variant ${v}`);
  }
  const badVariants = ['1.0010', '1001e-3', '0.0101'];
  for (const v of badVariants) {
    expect(validateJson(centSchema, v)).toHaveLength(1);
  }
});

it('negative numbers and -0', () => {
  expect(validateJson(centSchema, '-0.29')).toEqual([]);
  expect(validateJson(centSchema, '-0.291')).toHaveLength(1);
  expect(validateJson(centSchema, '-0')).toEqual([]);
  expect(validateJson(centSchema, '0')).toEqual([]);
  // -0 keeps its sign in the parsed form even though it compares equal to 0.
  expect(parseJsonNumber('-0').sign).toBe(-1);
  expect(compareDecimal(parseJsonNumber('-0'), parseJsonNumber('0'))).toBe(0);
});

it('extremely small decimals are compared exactly', () => {
  const schema = compileSchema('{"type":"number","multipleOf":1e-20}');
  expect(validateJson(schema, '1.5e-19')).toEqual([]);
  expect(validateJson(schema, '1e-21')).toHaveLength(1);
  expect(validateJson(schema, '0.00000000000000000005')).toEqual([]);
  expect(validateJson(schema, '0.000000000000000000050000001')).toHaveLength(1);
});

it('divisor finer than value least-significant place can still divide', () => {
  // 100 / 0.0001 = 1_000_000 exactly.
  const schema = compileSchema('{"type":"number","multipleOf":0.0001}');
  expect(validateJson(schema, '100')).toEqual([]);
});

it('classical float traps resolve exactly', () => {
  const tenth = compileSchema('{"type":"number","multipleOf":0.1}');
  expect(validateJson(tenth, '0.3')).toEqual([]);
  expect(validateJson(tenth, '0.7')).toEqual([]);
  expect(validateJson(tenth, '35.7')).toEqual([]);
  expect(validateJson(tenth, '1.0000000000000001')).toHaveLength(1);

  const three = compileSchema('{"type":"number","multipleOf":3}');
  // Binary floats would call 0.1+0.2 != 0.3; here 0.3 is text and exact.
  expect(validateJson(three, '0.3')).toHaveLength(1);
  expect(validateJson(three, '300000000000000000000001')).toHaveLength(1);
  expect(validateJson(three, '300000000000000000000003')).toEqual([]);
});

it('huge integers beyond Number.MAX_SAFE_INTEGER retain precision', () => {
  const schema = compileSchema('{"type":"number","multipleOf":1}');
  expect(validateJson(schema, '9007199254740993')).toEqual([]); // 2^53 + 1
  const big = compileSchema('{"type":"number","multipleOf":1000000000000000000000000000}');
  expect(validateJson(big, '1000000000000000000000000000')).toEqual([]);
  expect(validateJson(big, '1000000000000000000000000001')).toHaveLength(1);
});

it('never converts to Number along the way', () => {
  // These differ at the last digit but collapse together as JS numbers.
  const a = parseJsonNumber('9007199254740993');
  const b = parseJsonNumber('9007199254740992');
  expect(a.coefficient === b.coefficient).toBe(false);
  expect(isMultipleOf(a, parseJsonNumber('2'))).toBe(false);
  expect(isMultipleOf(b, parseJsonNumber('2'))).toBe(true);
});

// --- minimum / maximum ---

it('minimum and maximum compare exactly and preserve text', () => {
  const schema = compileSchema('{"type":"number","minimum":0.3,"maximum":2.5}');
  expect(validateJson(schema, '0.3')).toEqual([]);
  expect(validateJson(schema, '2.5')).toEqual([]);
  expect(validateJson(schema, '0.29999999999999999')).toHaveLength(1);
  expect(validateJson(schema, '2.5000000000000001')).toHaveLength(1);
  const tooSmall = validateJson(schema, '0.29');
  expect(tooSmall[0].message).toBe('0.29 is less than minimum 0.3');
  const tooLarge = validateJson(schema, '9');
  expect(tooLarge[0].message).toBe('9 is greater than maximum 2.5');
});

it('negative and scientific bounds', () => {
  const schema = compileSchema('{"type":"number","minimum":-1e-5,"maximum":1E100}');
  expect(validateJson(schema, '-0.00001')).toEqual([]);
  expect(validateJson(schema, '-0.00001001')).toHaveLength(1);
  expect(validateJson(schema, '1e100')).toEqual([]);
  expect(validateJson(schema, '1e101')).toHaveLength(1);
});

it('huge integer boundaries are exact', () => {
  const bound = '9007199254740993';
  const schema = compileSchema(`{"type":"number","minimum":${bound}}`);
  expect(validateJson(schema, bound)).toEqual([]);
  expect(validateJson(schema, '9007199254740992')).toHaveLength(1);
  expect(validateJson(schema, '9007199254740994')).toEqual([]);
});

// --- compile-time rejection of bad multipleOf ---

it('rejects zero multipleOf at compile time with the source text', () => {
  expect(() => compileSchema('{"multipleOf":0}')).toThrowError(
    /multipleOf must be a strictly positive number, got 0/,
  );
  expect(() => compileSchema('{"multipleOf":-0}')).toThrowError(/-0$/);
  expect(() => compileSchema('{"multipleOf":0.0}')).toThrowError(/got 0\.0$/);
  expect(() => compileSchema('{"multipleOf":-0.000}')).toThrowError(/-0\.000$/);
  expect(() => compileSchema('{"multipleOf":-1}')).toThrowError(/got -1$/);
  expect(() => compileSchema('{"multipleOf":-0.01}')).toThrowError(/got -0\.01$/);
  expect(() => compileSchema('{"multipleOf":"0.01"}')).toThrow(SchemaCompileError);
});

it('programmatic specs use the num() brand and validate at compile too', () => {
  expect(() =>
    compileSchema({ type: 'number', multipleOf: num('0') }),
  ).toThrowError(/got 0$/);
  const schema = compileSchema({
    type: 'number',
    multipleOf: num('0.05'),
    minimum: num('-1e2'),
    maximum: num('1e2'),
  });
  expect(validateJson(schema, '0.25')).toEqual([]);
  expect(validateJson(schema, '0.27')).toHaveLength(1);
  expect(validateJson(schema, '-100')).toEqual([]);
});

// --- nested structures, paths, and message fidelity ---

it('validates numbers nested in objects and arrays with correct paths', () => {
  const schema = compileSchema(
    JSON.stringify({
      type: 'object',
      required: ['price'],
      properties: {
        price: { type: 'number', multipleOf: 0.01, minimum: 0 },
        tags: { type: 'array', items: { type: 'string' } },
        nested: {
          type: 'object',
          properties: { rate: { type: 'number', multipleOf: 0.25 } },
        },
      },
    }),
  );
  const issues = validateJson(
    schema,
    '{"price":0.291,"tags":["a"],"nested":{"rate":0.3},"extra":true}',
  );
  expect(issues.map((i) => [i.path, i.message])).toEqual([
    ['#/price', '0.291 is not a multiple of 0.01'],
    ['#/nested/rate', '0.3 is not a multiple of 0.25'],
  ]);

  expect(validateJson(schema, '{"tags":[]}').map((i) => i.path)).toEqual(['#/price']);
});

it('message uses the exact instance spelling, including exponents and padding', () => {
  const schema = compileSchema('{"type":"number","multipleOf":1}');
  const issues = validateJson(schema, '  1.500e0  ');
  expect(issues[0].message).toBe('1.500e0 is not a multiple of 1');
});

it('type mismatches still reported before numeric checks', () => {
  const schema = compileSchema('{"type":"number","multipleOf":0.01}');
  expect(validateJson(schema, '"0.29"')[0].message).toBe('expected number');
  expect(validateJson(schema, 'true')[0].message).toBe('expected number');
});

it('reports malformed instance JSON as an issue at root', () => {
  const issues = validateJson(centSchema, '{');
  expect(issues).toHaveLength(1);
  expect(issues[0].path).toBe('#');
  expect(issues[0].message).toMatch(/invalid instance JSON/);
});

// --- parser-level: grammar and resource budget ---

it('accepts the full numeric grammar', () => {
  for (const lexeme of ['0', '-0', '123', '-123', '0.5', '-0.5', '1e0', '1E+3', '1.5e-10', '0.000', '100000']) {
    expect(() => parseJsonNumber(lexeme)).not.toThrow();
  }
});

it('rejects malformed lexemes', () => {
  for (const lexeme of ['01', '-01', '1.', '.5', '1e', '1e+', '--1', '+1', '1.2.3', '0x1', '1e1.5', '', ' 1', '1 ']) {
    expect(() => parseJsonNumber(lexeme)).toThrow(NumberLexemeError);
  }
});

it('rejects numbers with too many coefficient digits', () => {
  const huge = '1' + '0'.repeat(MAX_DIGITS); // MAX_DIGITS + 1
  expect(() => parseJsonNumber(huge)).toThrow(new RegExp(`exceeds ${MAX_DIGITS} digits`));
  expect(() => parseJsonNumber('1.' + '0'.repeat(MAX_DIGITS))).toThrow(NumberLexemeError);
});

it('rejects out-of-range explicit and adjusted exponents', () => {
  expect(() => parseJsonNumber(`1e${MAX_EXPONENT_ABS + 1}`)).toThrow(
    new RegExp(`exponent magnitude exceeds ${MAX_EXPONENT_ABS}`),
  );
  expect(() => parseJsonNumber(`1e-${MAX_EXPONENT_ABS + 1}`)).toThrow(NumberLexemeError);

  // Adjusted exponent (explicit - fraction digits) is bounded too. A 901-digit
  // fraction is well within MAX_DIGITS, so only the exponent budget can reject:
  //   -901 + -(MAX-50) = -MAX - 851
  const fraction = '0.' + '0'.repeat(900) + '1'; // adjusted exponent -901
  expect(() => parseJsonNumber(fraction)).not.toThrow();
  expect(
    () => parseJsonNumber(`${fraction}e-${MAX_EXPONENT_ABS - 50}`),
  ).toThrow(new RegExp(`adjusted exponent magnitude exceeds ${MAX_EXPONENT_ABS}`));

  // At the exact limit it must still parse.
  expect(() => parseJsonNumber(`1e${MAX_EXPONENT_ABS}`)).not.toThrow();
  expect(() => parseJsonNumber(`1e-${MAX_EXPONENT_ABS}`)).not.toThrow();
});

it('rejects overflowing numbers inside a JSON document', () => {
  const issues = validateJson(centSchema, `[1e${MAX_EXPONENT_ABS + 1}]`);
  expect(issues[0].message).toMatch(/invalid instance JSON/);
});
