import {
  DEFAULT_BUDGET,
  NumberBudget,
  NumberBudgetError,
  Decimal,
  compareDecimal,
  isMultipleOf,
  parseDecimal,
} from './decimal.js';
import { JsonNumber, JsonValue, parseJson } from './json.js';

export { DEFAULT_BUDGET, NumberBudgetError, compareDecimal, isMultipleOf, parseDecimal } from './decimal.js';
export type { Decimal, NumberBudget } from './decimal.js';
export { JsonNumber, parseJson } from './json.js';
export type { JsonValue } from './json.js';

export type Schema = {
  type?: 'string' | 'number' | 'object' | 'array';
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  /** Exact decimal; a string keeps full precision, a JS number is read via shortest round-trip. */
  multipleOf?: number | string;
  minimum?: number | string;
  maximum?: number | string;
};

export type Issue = { path: string; message: string };

export function validate(schema: Schema, value: unknown, path = '#'): Issue[] {
  const issues: Issue[] = [];
  if (schema.type === 'string' && typeof value !== 'string') issues.push({ path, message: 'expected string' });
  if (schema.type === 'number' && typeof value !== 'number') issues.push({ path, message: 'expected number' });
  if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in row)) issues.push({ path: path + '/' + key, message: 'required' });
    for (const [key, child] of Object.entries(schema.properties ?? {}))
      if (key in row) issues.push(...validate(child, row[key], path + '/' + key));
  }
  return issues;
}

export class SchemaCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaCompileError';
  }
}

const COMPILED = Symbol('compiled');

interface CompiledNumber {
  /** Original lexical form, used in error messages. */
  readonly raw: string;
  readonly decimal: Decimal;
}

export interface CompiledSchema {
  readonly [COMPILED]: true;
  readonly type?: Schema['type'];
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, CompiledSchema>>;
  readonly items?: CompiledSchema;
  readonly multipleOf?: CompiledNumber;
  readonly minimum?: CompiledNumber;
  readonly maximum?: CompiledNumber;
}

/**
 * Compile a schema once: numeric keywords are parsed into exact decimals
 * (enforcing the resource budget) and a zero or negative multipleOf is
 * rejected here rather than at validation time.
 */
export function compileSchema(schema: Schema, budget: NumberBudget = DEFAULT_BUDGET): CompiledSchema {
  const compileNumber = (keyword: string, input: number | string): CompiledNumber => {
    if (typeof input === 'number' && !Number.isFinite(input)) {
      throw new SchemaCompileError(`${keyword} must be a finite number, got ${String(input)}`);
    }
    const raw = typeof input === 'number' ? String(input) : input;
    let decimal: Decimal;
    try {
      decimal = parseDecimal(raw, budget);
    } catch (error) {
      if (error instanceof NumberBudgetError || error instanceof SyntaxError) {
        throw new SchemaCompileError(`${keyword}: ${error.message}`);
      }
      throw error;
    }
    return { raw, decimal };
  };

  const walk = (node: Schema): CompiledSchema => {
    const out: {
      -readonly [K in keyof CompiledSchema]?: CompiledSchema[K];
    } = { [COMPILED]: true };
    if (node.type !== undefined) out.type = node.type;
    if (node.required !== undefined) out.required = [...node.required];
    if (node.properties !== undefined) {
      out.properties = Object.fromEntries(Object.entries(node.properties).map(([key, child]) => [key, walk(child)]));
    }
    if (node.items !== undefined) out.items = walk(node.items);
    if (node.multipleOf !== undefined) {
      const compiled = compileNumber('multipleOf', node.multipleOf);
      if (compiled.decimal.sign !== 1) {
        throw new SchemaCompileError(`multipleOf must be greater than zero, got ${compiled.raw}`);
      }
      out.multipleOf = compiled;
    }
    if (node.minimum !== undefined) out.minimum = compileNumber('minimum', node.minimum);
    if (node.maximum !== undefined) out.maximum = compileNumber('maximum', node.maximum);
    return out as CompiledSchema;
  };

  return walk(schema);
}

const isCompiled = (schema: Schema | CompiledSchema): schema is CompiledSchema =>
  (schema as CompiledSchema)[COMPILED] === true;

/** Keep absurdly long lexemes (already over budget) from flooding an issue message. */
const display = (raw: string): string =>
  raw.length > 120 ? `${raw.slice(0, 117)}... (${raw.length} characters)` : raw;

const typeOf = (node: JsonValue): string => {
  if (node instanceof JsonNumber) return 'number';
  if (node === null) return 'null';
  if (Array.isArray(node)) return 'array';
  return typeof node === 'object' ? 'object' : typeof node;
};

/**
 * Validate a JSON document (as raw text, so number literals keep their
 * precision) against a schema. multipleOf, minimum and maximum are
 * evaluated with exact decimal arithmetic; issue messages quote the
 * instance's original number text.
 */
export function validateJson(
  schema: Schema | CompiledSchema,
  text: string,
  budget: NumberBudget = DEFAULT_BUDGET,
): Issue[] {
  const compiled = isCompiled(schema) ? schema : compileSchema(schema, budget);
  const root = parseJson(text);
  const issues: Issue[] = [];

  const checkNumber = (cs: CompiledSchema, node: JsonNumber, path: string): void => {
    if (cs.multipleOf === undefined && cs.minimum === undefined && cs.maximum === undefined) return;
    let decimal: Decimal;
    try {
      decimal = parseDecimal(node.raw, budget);
    } catch (error) {
      if (error instanceof NumberBudgetError) {
        issues.push({ path, message: `number ${display(node.raw)} cannot be validated exactly: ${error.message}` });
        return;
      }
      throw error; // parseJson only emits well-formed lexemes
    }
    if (cs.multipleOf !== undefined && !isMultipleOf(decimal, cs.multipleOf.decimal)) {
      issues.push({ path, message: `${node.raw} is not a multiple of ${cs.multipleOf.raw}` });
    }
    if (cs.minimum !== undefined && compareDecimal(decimal, cs.minimum.decimal) < 0) {
      issues.push({ path, message: `${node.raw} is less than minimum ${cs.minimum.raw}` });
    }
    if (cs.maximum !== undefined && compareDecimal(decimal, cs.maximum.decimal) > 0) {
      issues.push({ path, message: `${node.raw} is greater than maximum ${cs.maximum.raw}` });
    }
  };

  const walk = (cs: CompiledSchema, node: JsonValue, path: string): void => {
    if (cs.type !== undefined && typeOf(node) !== cs.type) {
      issues.push({ path, message: `expected ${cs.type}` });
    }
    if (node instanceof JsonNumber) {
      checkNumber(cs, node, path);
    } else if (Array.isArray(node)) {
      if (cs.items !== undefined) node.forEach((item, index) => walk(cs.items as CompiledSchema, item, `${path}/${index}`));
    } else if (node !== null && typeof node === 'object') {
      for (const key of cs.required ?? []) {
        if (!(key in node)) issues.push({ path: `${path}/${key}`, message: 'required' });
      }
      for (const [key, child] of Object.entries(cs.properties ?? {})) {
        if (key in node) walk(child, node[key], `${path}/${key}`);
      }
    }
  };

  walk(compiled, root, '#');
  return issues;
}
