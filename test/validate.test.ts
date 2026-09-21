import { describe, expect, it } from 'vitest';
import { SchemaCompileError, compileSchema, validateJson } from '../src/index.js';

describe('multipleOf', () => {
  it('accepts 0.29 against multipleOf 0.01 (exact, not float remainder)', () => {
    expect(validateJson({ type: 'number', multipleOf: 0.01 }, '0.29')).toEqual([]);
  });

  it('rejects genuine non-multiples', () => {
    expect(validateJson({ multipleOf: 0.01 }, '0.295')).toEqual([
      { path: '#', message: '0.295 is not a multiple of 0.01' },
    ]);
  });

  it('rejects near-boundary non-multiples an epsilon would pass', () => {
    const issues = validateJson({ multipleOf: 0.01 }, '0.29000000000000001');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe('0.29000000000000001 is not a multiple of 0.01');
  });

  it('handles scientific notation on both sides', () => {
    expect(validateJson({ multipleOf: '2.5e-3' }, '1.25e-2')).toEqual([]);
    expect(validateJson({ multipleOf: '2.5e-3' }, '1.3e-2')).toHaveLength(1);
  });

  it('handles negatives and tiny decimals', () => {
    expect(validateJson({ multipleOf: 0.01 }, '-0.29')).toEqual([]);
    expect(validateJson({ multipleOf: '1e-500' }, '3e-500')).toEqual([]);
    expect(validateJson({ multipleOf: '1e-500' }, '7e-501')).toHaveLength(1);
  });

  it('handles huge integers beyond the safe-integer range', () => {
    expect(validateJson({ multipleOf: '1e30' }, '5e30')).toEqual([]);
    expect(validateJson({ multipleOf: '1e30' }, '123456789012345678901234567890000000001')).toHaveLength(1);
    expect(validateJson({ multipleOf: '10' }, '123456789012345678901234567890')).toEqual([]);
  });

  it('keeps the instance raw number text in the message', () => {
    expect(validateJson({ multipleOf: 0.01 }, '2.95e-1')).toEqual([
      { path: '#', message: '2.95e-1 is not a multiple of 0.01' },
    ]);
    const compiled = compileSchema({ multipleOf: '0.010' });
    expect(validateJson(compiled, '0.295')).toEqual([
      { path: '#', message: '0.295 is not a multiple of 0.010' },
    ]);
  });
});

describe('minimum and maximum', () => {
  const range = { minimum: 0.29, maximum: 0.29 };

  it('treats lexically different but equal values identically', () => {
    for (const text of ['0.29', '2.9e-1', '0.290', '29e-2', '2.90E-1']) {
      expect(validateJson(range, text), text).toEqual([]);
    }
  });

  it('rejects just-outside values exactly', () => {
    expect(validateJson(range, '0.290001')).toEqual([
      { path: '#', message: '0.290001 is greater than maximum 0.29' },
    ]);
    expect(validateJson(range, '0.289999')).toEqual([
      { path: '#', message: '0.289999 is less than minimum 0.29' },
    ]);
  });

  it('compares beyond double precision', () => {
    // Both literals collapse to the same double; exact decimal keeps them apart.
    expect(validateJson({ minimum: '1.0000000000000001' }, '1.00000000000000005')).toHaveLength(1);
    expect(validateJson({ minimum: '9007199254740993' }, '9007199254740992.5')).toHaveLength(1);
    expect(validateJson({ minimum: '9007199254740993' }, '9007199254740993')).toEqual([]);
  });

  it('compares huge integers exactly', () => {
    expect(validateJson({ minimum: '1e40' }, '9'.repeat(39))).toHaveLength(1);
    expect(validateJson({ minimum: '1e40' }, '1' + '0'.repeat(40))).toEqual([]);
  });

  it('handles negative bounds', () => {
    expect(validateJson({ maximum: -0.3 }, '-0.29')).toEqual([
      { path: '#', message: '-0.29 is greater than maximum -0.3' },
    ]);
    expect(validateJson({ minimum: -0.2 }, '-0.29')).toEqual([
      { path: '#', message: '-0.29 is less than minimum -0.2' },
    ]);
    expect(validateJson({ minimum: -0.3, maximum: -0.2 }, '-0.29')).toEqual([]);
  });

  it('treats -0 as equal to 0', () => {
    expect(validateJson({ minimum: 0, maximum: 0 }, '-0')).toEqual([]);
    expect(validateJson({ multipleOf: 5 }, '-0')).toEqual([]);
    expect(validateJson({ minimum: 0 }, '-0.5')).toEqual([
      { path: '#', message: '-0.5 is less than minimum 0' },
    ]);
  });
});

describe('resource budget', () => {
  it('reports an instance exponent beyond the budget instead of guessing', () => {
    const issues = validateJson({ multipleOf: 2 }, '1e100001');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/number 1e100001 cannot be validated exactly: exponent 100001 exceeds budget/);
  });

  it('reports an instance mantissa beyond the digit budget', () => {
    const issues = validateJson({ multipleOf: 2 }, '1' + '0'.repeat(1000));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/1001 mantissa digits, budget allows 1000/);
  });

  it('honours a custom budget', () => {
    const tight = { maxCoefficientDigits: 10, maxExponent: 5 };
    expect(validateJson({ multipleOf: 2 }, '1e10', tight)).toHaveLength(1);
    expect(validateJson({ multipleOf: 2 }, '1e5', tight)).toEqual([]);
  });

  it('rejects over-budget schema numbers at compile time', () => {
    expect(() => compileSchema({ maximum: '1e100001' })).toThrow(SchemaCompileError);
    expect(() => compileSchema({ minimum: '1'.repeat(1001) })).toThrow(/mantissa digits/);
  });
});

describe('schema compilation', () => {
  it('rejects zero and negative multipleOf at compile time', () => {
    for (const multipleOf of [0, -0, -2, '-0.0', '-0.5']) {
      expect(() => compileSchema({ multipleOf }), String(multipleOf)).toThrow(
        /multipleOf must be greater than zero/,
      );
    }
  });

  it('rejects non-finite and malformed schema numbers', () => {
    expect(() => compileSchema({ multipleOf: Number.NaN })).toThrow(/finite/);
    expect(() => compileSchema({ multipleOf: Infinity })).toThrow(/finite/);
    expect(() => compileSchema({ minimum: 'abc' })).toThrow(SchemaCompileError);
    expect(() => compileSchema({ maximum: '1.2.3' })).toThrow(SchemaCompileError);
  });

  it('accepts string lexemes for full precision and compiles once for reuse', () => {
    const compiled = compileSchema({ multipleOf: '0.01' });
    expect(validateJson(compiled, '0.29')).toEqual([]);
    expect(validateJson(compiled, '0.295')).toHaveLength(1);
  });

  it('validates uncompiled schemas on the fly (and compiles their keywords)', () => {
    expect(() => validateJson({ multipleOf: 0 }, '1')).toThrow(/multipleOf must be greater than zero/);
  });
});

describe('structure and types', () => {
  const schema = {
    type: 'object' as const,
    required: ['price'],
    properties: { price: { type: 'number' as const, multipleOf: 0.01 } },
  };

  it('validates nested numbers with exact arithmetic', () => {
    expect(validateJson(schema, '{"price": 0.29}')).toEqual([]);
    expect(validateJson(schema, '{"price": 0.295}')).toEqual([
      { path: '#/price', message: '0.295 is not a multiple of 0.01' },
    ]);
  });

  it('reports missing required keys and type mismatches', () => {
    expect(validateJson(schema, '{}')).toEqual([{ path: '#/price', message: 'required' }]);
    expect(validateJson({ type: 'number' }, '"abc"')).toEqual([{ path: '#', message: 'expected number' }]);
  });

  it('ignores numeric keywords for non-number instances', () => {
    expect(validateJson({ minimum: 5 }, '"abc"')).toEqual([]);
  });

  it('validates array items', () => {
    const issues = validateJson({ type: 'array', items: { multipleOf: 0.5 } }, '[0.5, 1, 1.7]');
    expect(issues).toEqual([{ path: '#/2', message: '1.7 is not a multiple of 0.5' }]);
  });

  it('throws on invalid JSON text', () => {
    expect(() => validateJson({ type: 'number' }, '{invalid')).toThrow(SyntaxError);
  });
});
