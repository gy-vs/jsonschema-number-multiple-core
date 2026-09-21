import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BUDGET,
  NumberBudget,
  NumberBudgetError,
  compareDecimal,
  isMultipleOf,
  parseDecimal,
} from '../src/decimal.js';

const dec = (raw: string, budget?: NumberBudget) => parseDecimal(raw, budget);

describe('parseDecimal', () => {
  it('parses scientific notation without touching Number', () => {
    expect(dec('2.9e-1')).toMatchObject({ sign: 1, coefficient: 29n, exponent: -2 });
    expect(dec('12E3')).toMatchObject({ sign: 1, coefficient: 12n, exponent: 3 });
  });

  it('normalizes trailing zeros into the exponent', () => {
    expect(dec('0.2900')).toMatchObject({ coefficient: 29n, exponent: -2 });
    expect(dec('1.2300e2')).toMatchObject({ coefficient: 123n, exponent: 0 });
    expect(dec('1000')).toMatchObject({ coefficient: 1n, exponent: 3 });
  });

  it('parses negatives', () => {
    expect(dec('-12.5')).toMatchObject({ sign: -1, coefficient: 125n, exponent: -1 });
  });

  it('parses tiny decimals and huge integers exactly', () => {
    expect(dec('1e-999')).toMatchObject({ coefficient: 1n, exponent: -999 });
    expect(dec('0.000001')).toMatchObject({ coefficient: 1n, exponent: -6 });
    expect(dec('123456789012345678901234567890')).toMatchObject({
      coefficient: 12345678901234567890123456789n, // trailing zero folds into the exponent
      exponent: 1,
    });
  });

  it('maps every zero spelling to signed zero', () => {
    for (const raw of ['0', '-0', '0.0', '-0.000e10', '0e-5']) {
      expect(dec(raw)).toMatchObject({ sign: 0, coefficient: 0n });
    }
  });

  it('enforces the mantissa digit budget', () => {
    expect(() => dec('1' + '0'.repeat(1000))).toThrow(NumberBudgetError);
    expect(dec('1' + '0'.repeat(999))).toMatchObject({ coefficient: 1n });
    expect(() => dec('0.' + '0'.repeat(1000) + '1')).toThrow(NumberBudgetError);
  });

  it('enforces the exponent budget', () => {
    expect(() => dec('1e100001')).toThrow(NumberBudgetError);
    expect(() => dec('1e-100001')).toThrow(NumberBudgetError);
    expect(() => dec('1e123456789012345')).toThrow(NumberBudgetError);
    expect(dec('1e100000')).toMatchObject({ coefficient: 1n, exponent: 100000 });
    expect(dec('1e000005')).toMatchObject({ coefficient: 1n, exponent: 5 });
    const tight = { maxCoefficientDigits: 10, maxExponent: 2 };
    expect(() => dec('1e3', tight)).toThrow(NumberBudgetError);
    expect(() => dec('12345678901', tight)).toThrow(NumberBudgetError);
  });

  it('rejects malformed lexemes', () => {
    for (const raw of ['', '01', '1.', '.5', '1e', '1e+', 'abc', '--1', '1.2.3']) {
      expect(() => dec(raw)).toThrow(SyntaxError);
    }
  });
});

describe('compareDecimal', () => {
  it('treats different lexical spellings of one value as equal', () => {
    const spellings = ['0.29', '2.9e-1', '29e-2', '0.290', '0.29E0', '2.90E-1'];
    for (const a of spellings) {
      for (const b of spellings) {
        expect(compareDecimal(dec(a), dec(b)), `${a} vs ${b}`).toBe(0);
      }
    }
  });

  it('equates -0 and 0', () => {
    expect(compareDecimal(dec('-0'), dec('0'))).toBe(0);
    expect(compareDecimal(dec('-0.0e3'), dec('0'))).toBe(0);
  });

  it('orders beyond double precision', () => {
    // Both sides round to the same IEEE-754 double.
    expect(compareDecimal(dec('1.0000000000000001'), dec('1.00000000000000005'))).toBe(1);
    expect(compareDecimal(dec('9007199254740992.5'), dec('9007199254740993'))).toBe(-1);
  });

  it('orders negatives, tiny and huge magnitudes', () => {
    expect(compareDecimal(dec('-2'), dec('-1'))).toBe(-1);
    expect(compareDecimal(dec('-0.29'), dec('-0.3'))).toBe(1);
    expect(compareDecimal(dec('1e100000'), dec('9'.repeat(999)))).toBe(1);
    expect(compareDecimal(dec('-1e100000'), dec('-1'))).toBe(-1);
    expect(compareDecimal(dec('1e-100000'), dec('0'))).toBe(1);
  });
});

describe('isMultipleOf', () => {
  const cases: Array<[string, string, boolean]> = [
    ['0.29', '0.01', true], // 0.29 % 0.01 !== 0 in binary floating point
    ['0.295', '0.01', false],
    ['0.29000000000000001', '0.01', false], // an epsilon comparison would accept this
    ['0.3', '0.15', true],
    ['7', '0.5', true],
    ['1', '3', false],
    ['-0.29', '0.01', true],
    ['0', '0.01', true],
    ['-0', '5', true],
    ['2.9e-1', '1e-2', true],
    ['1e1000', '1e-1000', true],
    ['1e-1000', '1e1000', false],
    ['0.12', '0.06', true],
    ['0.15', '0.06', false],
    ['123456789012345678901234567890', '10', true],
    ['123456789012345678901234567891', '10', false],
    ['1.25e-2', '2.5e-3', true],
    ['1.3e-2', '2.5e-3', false],
  ];

  it.each(cases)('%s multipleOf %s => %s', (value, multiple, expected) => {
    expect(isMultipleOf(dec(value), dec(multiple))).toBe(expected);
  });
});
