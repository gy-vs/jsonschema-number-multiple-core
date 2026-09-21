// Exact JSON number arithmetic derived directly from numeric lexemes.
// A JSON number is parsed as sign * coefficient * 10**exponent (coefficient > 0
// except for zero), so every comparison stays in integer ratio and never loses
// precision to binary floating point.

/** Maximum number of coefficient digits accepted from a single number lexeme. */
export const MAX_DIGITS = 1000;
/**
 * Inclusive bound for both the explicit JSON exponent and the adjusted exponent
 * (explicit exponent minus fractional digit count). 10**1_000_000 is a ~415 KiB
 * BigInt, which keeps the resource cost bounded.
 */
export const MAX_EXPONENT_ABS = 1_000_000;

export type Sign = 1 | -1;

/** Canonical form of a JSON number: value === sign * coefficient * 10**exponent. */
export interface Decimal {
  /** 1 or -1; `-0` keeps sign -1. */
  sign: Sign;
  /** Digits with trailing zeros stripped; 0n for a zero lexeme. */
  coefficient: bigint;
  exponent: number;
  /** The original lexeme exactly as it appeared, for error messages. */
  raw: string;
}

/** Thrown while scanning a number lexeme: malformed grammar or budget breach. */
export class NumberLexemeError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(`${message}: ${raw}`);
    this.name = 'NumberLexemeError';
  }
}

/**
 * Parse a JSON number lexeme (RFC 8259 grammar) into sign/coefficient/exponent
 * without ever converting to a JS Number. Trailing characters are rejected.
 */
export function parseJsonNumber(lexeme: string): Decimal {
  const raw = lexeme;
  let i = 0;
  let sign: Sign = 1;

  if (lexeme.startsWith('-')) {
    sign = -1;
    i = 1;
  }

  // int: "0" / digit1-9 *DIGIT
  let digitCount = 0;

  const intStart = i;
  if (lexeme[i] === '0') {
    i++;
    digitCount++;
    if (i < lexeme.length && isDigit(lexeme[i])) {
      throw new NumberLexemeError('leading zeros are not allowed', raw);
    }
  } else if (i < lexeme.length && isDigit19(lexeme[i])) {
    i++;
    digitCount++;
    while (i < lexeme.length && isDigit(lexeme[i])) i++, digitCount++;
  } else {
    throw new NumberLexemeError('number requires integer digits', raw);
  }
  const intDigits = lexeme.slice(intStart, i);

  // frac: "." 1*DIGIT
  let fracDigits = '';
  let fracDigitCount = 0;
  if (lexeme[i] === '.') {
    i++;
    const fracStart = i;
    while (i < lexeme.length && isDigit(lexeme[i])) i++;
    if (i === fracStart) {
      throw new NumberLexemeError('fraction point must be followed by a digit', raw);
    }
    fracDigits = lexeme.slice(fracStart, i);
    fracDigitCount = i - fracStart;
    digitCount += fracDigitCount;
  }
  if (digitCount > MAX_DIGITS) {
    throw new NumberLexemeError(`coefficient exceeds ${MAX_DIGITS} digits`, raw);
  }

  // exp: ("e"/"E") ["+"/"-"] 1*DIGIT
  let explicitExponent = 0;
  if (i < lexeme.length && (lexeme[i] === 'e' || lexeme[i] === 'E')) {
    i++;
    let expSign = 1;
    if (lexeme[i] === '+' || lexeme[i] === '-') {
      if (lexeme[i] === '-') expSign = -1;
      i++;
    }
    const expStart = i;
    while (i < lexeme.length && isDigit(lexeme[i])) i++;
    if (i === expStart) {
      throw new NumberLexemeError('exponent must contain a digit', raw);
    }
    // Reject absurd exponent strings before parsing them.
    if (i - expStart > 7) {
      throw new NumberLexemeError(`exponent magnitude exceeds ${MAX_EXPONENT_ABS}`, raw);
    }
    // Accumulate exponent digits as an integer without touching Number().
    let expMagnitude = 0;
    for (let p = expStart; p < i; p++) {
      expMagnitude = expMagnitude * 10 + (lexeme.charCodeAt(p) - 48);
    }
    explicitExponent = expSign * expMagnitude;
    if (Math.abs(explicitExponent) > MAX_EXPONENT_ABS) {
      throw new NumberLexemeError(`exponent magnitude exceeds ${MAX_EXPONENT_ABS}`, raw);
    }
  }

  if (i !== lexeme.length) {
    throw new NumberLexemeError('unexpected characters in number', raw);
  }

  const adjustedExponent = explicitExponent - fracDigitCount;
  if (Math.abs(adjustedExponent) > MAX_EXPONENT_ABS) {
    throw new NumberLexemeError(`adjusted exponent magnitude exceeds ${MAX_EXPONENT_ABS}`, raw);
  }

  let coefficient = BigInt(intDigits + fracDigits);
  // Canonicalize trailing zeros (e.g. 2.90 -> coefficient 29, exponent +1).
  let trailingZeros = 0;
  while (coefficient > 0n && coefficient % 10n === 0n) {
    coefficient /= 10n;
    trailingZeros++;
  }

  return {
    sign,
    coefficient,
    exponent: adjustedExponent + trailingZeros,
    raw,
  };
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isDigit19(ch: string): boolean {
  return ch >= '1' && ch <= '9';
}

/** Compare magnitudes of two non-zero decimals. Returns -1 | 0 | 1. */
function compareMagnitude(a: Decimal, b: Decimal): -1 | 0 | 1 {
  // Decimal place of the most significant digit.
  const ae = a.exponent + digitLength(a.coefficient) - 1;
  const be = b.exponent + digitLength(b.coefficient) - 1;
  if (ae !== be) return ae < be ? -1 : 1;
  // Shift the larger exponent down to the other and compare integers.
  if (a.exponent === b.exponent) {
    return a.coefficient < b.coefficient ? -1 : a.coefficient > b.coefficient ? 1 : 0;
  }
  if (a.exponent > b.exponent) {
    const scaled = a.coefficient * powerOfTen(a.exponent - b.exponent);
    return scaled < b.coefficient ? -1 : scaled > b.coefficient ? 1 : 0;
  }
  const scaled = b.coefficient * powerOfTen(b.exponent - a.exponent);
  return a.coefficient < scaled ? -1 : a.coefficient > scaled ? 1 : 0;
}

/** Exact signed comparison (zero sign does not affect ordering). */
export function compareDecimal(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const az = a.coefficient === 0n;
  const bz = b.coefficient === 0n;
  if (az || bz) {
    if (az && bz) return 0;
    if (az) return b.sign === 1 ? -1 : 1;
    return a.sign === 1 ? 1 : -1;
  }
  if (a.sign !== b.sign) return a.sign === 1 ? 1 : -1;
  const cmp = compareMagnitude(a, b);
  return a.sign === -1 ? ((-cmp) as -1 | 0 | 1) : cmp;
}

/**
 * Whether `value` is an exact integer multiple of `divisor`.
 * `divisor` must be positive; zero/negative divisors are rejected at schema
 * compile time instead.
 */
export function isMultipleOf(value: Decimal, divisor: Decimal): boolean {
  // Zero (including -0) is a multiple of every positive divisor.
  if (value.coefficient === 0n) return true;

  // A non-zero value smaller in magnitude than the divisor cannot be a
  // multiple (the only smaller integer quotient is 0, which needs value == 0).
  const valueMsd = value.exponent + digitLength(value.coefficient) - 1;
  const divisorMsd = divisor.exponent + digitLength(divisor.coefficient) - 1;
  if (divisorMsd > valueMsd) return false;

  // Align both numbers on the smaller of their least-significant digit places:
  //   |value| = V * 10**valueLsd, divisor = D * 10**divisorLsd
  // value / divisor is an integer iff the aligned V is divisible by aligned D.
  // Pure integer ratio — no rounding, no epsilon.
  const baseExponent = Math.min(value.exponent, divisor.exponent);
  const alignedValue = value.coefficient * powerOfTen(value.exponent - baseExponent);
  const alignedDivisor = divisor.coefficient * powerOfTen(divisor.exponent - baseExponent);
  return alignedValue % alignedDivisor === 0n;
}

function digitLength(n: bigint): number {
  return n === 0n ? 1 : n.toString().length;
}

let tenPowers: bigint[] = [1n];
function powerOfTen(n: number): bigint {
  if (n < tenPowers.length) return tenPowers[n];
  if (n <= 10000) {
    while (tenPowers.length <= n) {
      tenPowers.push(tenPowers[tenPowers.length - 1] * 10n);
    }
    return tenPowers[n];
  }
  return 10n ** BigInt(n);
}
