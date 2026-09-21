// Public entry point.
//
// Exact numeric validation:
//   const schema = compileSchema('{"type":"number","multipleOf":"0.01"}');
//   validateJson(schema, '{"price":0.29}', ...) works from raw JSON text and
//   never converts numbers to JS Number.
//
// Legacy `validate` (plain JS values, no numeric keyword support) is retained
// for compatibility.

export {
  MAX_DIGITS,
  MAX_EXPONENT_ABS,
  NumberLexemeError,
  compareDecimal,
  isMultipleOf,
  parseJsonNumber,
  type Decimal,
  type Sign,
} from './decimal.js';
export { JsonSyntaxError, parseJson, type JsonNode } from './json.js';
export {
  SchemaCompileError,
  compileSchema,
  num,
  validateJson,
  type JsonNumber,
  type SchemaSpec,
} from './schema.js';
import type { Issue } from './schema.js';
export type { Issue };

// --- Legacy validator (JS values; numbers are NOT exactly compared) ---

/** @deprecated Prefer {@link compileSchema} + {@link validateJson}. */
export type Schema = {
  type?: 'string' | 'number' | 'object' | 'array';
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
};

/**
 * @deprecated Legacy validator for plain JS values. Numeric keywords
 * (multipleOf/minimum/maximum) are only supported through {@link validateJson},
 * where the instance is read from raw JSON text.
 */
export function validate(schema: Schema, value: unknown, path = '#'): Issue[] {
  const issues: Issue[] = [];
  if (schema.type === 'string' && typeof value !== 'string')
    issues.push({ path, message: 'expected string' });
  if (schema.type === 'number' && typeof value !== 'number')
    issues.push({ path, message: 'expected number' });
  if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    for (const key of schema.required ?? [])
      if (!(key in row)) issues.push({ path: path + '/' + key, message: 'required' });
    for (const [key, child] of Object.entries(schema.properties ?? {}))
      if (key in row) issues.push(...validate(child, row[key], path + '/' + key));
  }
  return issues;
}
