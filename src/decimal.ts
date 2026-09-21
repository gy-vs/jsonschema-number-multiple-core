/**
 * Exact decimal arithmetic over JSON number lexemes.
 *
 * A number is kept as sign * coefficient * 10^exponent with a BigInt
 * coefficient, so nothing is ever rounded through a binary double.
 */

/** Resource budget bounding how large a single number literal may be. */
export interface NumberBudget {
  /** Maximum number of mantissa digits (integer + fraction) in one literal. */
  maxCoefficientDigits: number;
  /** Maximum absolute value of the written decimal exponent. */
  maxExponent: number;
}

export const DEFAULT_BUDGET: NumberBudget = {
  maxCoefficientDigits: 1000,
  maxExponent: 100_000,
};

export class NumberBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NumberBudgetError';
  }
}

/**
 * Exact decimal: value = sign * coefficient * 10^exponent.
 * The coefficient is normalized to carry no trailing zeros; zero has sign 0.
 */
export interface Decimal {
  readonly sign: -1 | 0 | 1;
  readonly coefficient: bigint;
  readonly exponent: number;
  /** Decimal digit count of `coefficient` (0 when the value is zero). */
  readonly digits: number;
}

const LEXEME = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/** Exponent literals longer than this many digits always exceed any sane budget. */
const MAX_EXPONENT_LITERAL_DIGITS = 10;

/**
 * Parse a JSON number lexeme into an exact decimal. Never touches Number
 * for the mantissa; throws NumberBudgetError when the literal exceeds the
 * resource budget and SyntaxError when it is not a valid JSON number.
 */
export function parseDecimal(lexeme: string, budget: NumberBudget = DEFAULT_BUDGET): Decimal {
  const m = LEXEME.exec(lexeme);
  if (!m) throw new SyntaxError(`invalid JSON number: ${JSON.stringify(lexeme.slice(0, 80))}`);
  const [, neg, intPart, fracPart = '', expPart] = m;

  const mantissaDigits = intPart.length + fracPart.length;
  if (mantissaDigits > budget.maxCoefficientDigits) {
    throw new NumberBudgetError(
      `number has ${mantissaDigits} mantissa digits, budget allows ${budget.maxCoefficientDigits}`,
    );
  }

  let exponent = 0;
  if (expPart !== undefined) {
    const significant = expPart.replace(/^[+-]/, '').replace(/^0+(?=\d)/, '');
    if (significant.length > MAX_EXPONENT_LITERAL_DIGITS) {
      throw new NumberBudgetError(`exponent of number exceeds budget ±${budget.maxExponent}`);
    }
    exponent = Number.parseInt(expPart, 10);
    if (Math.abs(exponent) > budget.maxExponent) {
      throw new NumberBudgetError(`exponent ${exponent} exceeds budget ±${budget.maxExponent}`);
    }
  }
  exponent -= fracPart.length;

  let digits = (intPart + fracPart).replace(/^0+/, '');
  if (digits === '') return { sign: 0, coefficient: 0n, exponent: 0, digits: 0 };

  const trimmed = digits.replace(/0+$/, '');
  exponent += digits.length - trimmed.length;
  digits = trimmed;

  return { sign: neg ? -1 : 1, coefficient: BigInt(digits), exponent, digits: digits.length };
}

/** Exact three-way comparison of two decimals. */
export function compareDecimal(a: Decimal, b: Decimal): -1 | 0 | 1 {
  if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1;
  if (a.sign === 0) return 0;

  // Compare magnitudes by the position of the most significant digit first.
  const magA = a.exponent + a.digits;
  const magB = b.exponent + b.digits;
  let cmp: -1 | 0 | 1;
  if (magA !== magB) {
    cmp = magA < magB ? -1 : 1;
  } else {
    // Equal magnitude implies |shift| <= max(a.digits, b.digits), so the
    // scale-up below stays within the digit budget.
    const shift = a.exponent - b.exponent;
    const ca = shift > 0 ? a.coefficient * 10n ** BigInt(shift) : a.coefficient;
    const cb = shift < 0 ? b.coefficient * 10n ** BigInt(-shift) : b.coefficient;
    cmp = ca < cb ? -1 : ca > cb ? 1 : 0;
  }
  return a.sign === 1 ? cmp : ((cmp === 0 ? 0 : -cmp) as -1 | 0 | 1);
}

/** Split n into n = 2^twos * 5^fives * rest with rest coprime to 10. */
function splitTwosFives(n: bigint): { twos: number; fives: number; rest: bigint } {
  let twos = 0;
  let fives = 0;
  while (n !== 0n && n % 10n === 0n) {
    n /= 10n;
    twos++;
    fives++;
  }
  while (n !== 0n && n % 2n === 0n) {
    n /= 2n;
    twos++;
  }
  while (n !== 0n && n % 5n === 0n) {
    n /= 5n;
    fives++;
  }
  return { twos, fives, rest: n };
}

/**
 * Exact divisibility: is `value` an integer multiple of `multiple`?
 * `multiple` must be strictly positive (enforced at schema compile time).
 *
 * value/multiple = ±(v.coeff / m.coeff) * 10^k. Since the part of m.coeff
 * coprime to 10 can never be cancelled by a power of ten, divisibility
 * reduces to comparing the 2- and 5-adic valuations plus one BigInt modulo.
 */
export function isMultipleOf(value: Decimal, multiple: Decimal): boolean {
  if (value.coefficient === 0n) return true;
  const m = splitTwosFives(multiple.coefficient);
  const v = splitTwosFives(value.coefficient);
  if (m.rest !== 1n && v.rest % m.rest !== 0n) return false;
  const k = value.exponent - multiple.exponent;
  if (k >= 0) return v.twos + k >= m.twos && v.fives + k >= m.fives;
  return v.twos >= m.twos - k && v.fives >= m.fives - k;
}
