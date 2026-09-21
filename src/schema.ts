// Schema compilation and exact numeric validation.
//
// Schemas are read from raw JSON text so that multipleOf/minimum/maximum are
// parsed from their lexemes too. `compileSchema` additionally accepts a
// programmatic spec whose numeric constraints must be built with `num()`
// (branded lexeme strings) — a JS `number` is never silently accepted, since
// that would reintroduce the binary floating-point ambiguity.

import { compareDecimal, isMultipleOf, parseJsonNumber, type Decimal } from './decimal.js';
import { JsonSyntaxError, parseJson, type JsonNode } from './json.js';

/** Branded JSON number lexeme, e.g. num("0.01"). Never a JS Number. */
export type JsonNumber = string & { readonly __jsonNumber: unique symbol };

/** Wrap a JSON number lexeme for use inside a programmatic SchemaSpec. */
export function num(lexeme: string): JsonNumber {
  parseJsonNumber(lexeme); // validate eagerly
  return lexeme as JsonNumber;
}

export interface SchemaSpec {
  type?: 'string' | 'number' | 'object' | 'array';
  required?: string[];
  properties?: Record<string, SchemaSpec>;
  items?: SchemaSpec;
  /** Exact divisibility constraint; must parse to a strictly positive number. */
  multipleOf?: JsonNumber;
  minimum?: JsonNumber;
  maximum?: JsonNumber;
}

export interface Issue {
  path: string;
  message: string;
}

/** A schema constraint problem detectable before any instance is seen. */
export class SchemaCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaCompileError';
  }
}

interface CompiledNumberConstraints {
  multipleOf?: { divisor: Decimal };
  minimum?: { bound: Decimal };
  maximum?: { bound: Decimal };
}

interface CompiledSchema {
  type?: SchemaSpec['type'];
  required?: string[];
  properties?: Array<[string, CompiledSchema]>;
  items?: CompiledSchema;
  number?: CompiledNumberConstraints;
}

/**
 * Compile a schema from raw JSON text (recommended) or a programmatic spec
 * built with `num()`. A zero or negative multipleOf — including `-0` and
 * `"0e10"` — fails here rather than at validation time.
 */
export function compileSchema(source: string | SchemaSpec): CompiledSchema {
  if (typeof source === 'string') {
    let tree: JsonNode;
    try {
      tree = parseJson(source);
    } catch (err) {
      if (err instanceof JsonSyntaxError) {
        throw new SchemaCompileError(`invalid schema JSON: ${err.message}`);
      }
      throw err;
    }
    if (tree.kind !== 'object') {
      throw new SchemaCompileError('schema root must be an object');
    }
    return compileFromNode(tree);
  }
  return compileFromSpec(source);
}

/**
 * Validate an instance given as raw JSON text. Document-level parse failures
 * are reported as a single issue at '#'; per-number constraint failures
 * preserve the instance's original number lexeme in the message.
 */
export function validateJson(schema: CompiledSchema, instanceJson: string, path = '#'): Issue[] {
  let root: JsonNode;
  try {
    root = parseJson(instanceJson);
  } catch (err) {
    if (err instanceof JsonSyntaxError) {
      return [{ path: '#', message: `invalid instance JSON: ${err.message}` }];
    }
    throw err;
  }
  return validateNode(schema, root, path);
}

function compileFromNode(node: JsonNode, pointer = ''): CompiledSchema {
  if (node.kind !== 'object') {
    throw new SchemaCompileError(`schema at ${pointer || '#'} must be an object`);
  }
  const out: CompiledSchema = {};

  for (const [key, value] of node.entries) {
    const field = pointer ? `${pointer}/${key}` : `/${key}`;
    switch (key) {
      case 'type': {
        if (value.kind !== 'string') {
          throw new SchemaCompileError(`${field} must be a string`);
        }
        if (!isKnownType(value.value)) {
          throw new SchemaCompileError(`${field} has unsupported type ${value.value}`);
        }
        out.type = value.value;
        break;
      }
      case 'required': {
        if (value.kind !== 'array' || value.items.some((it) => it.kind !== 'string')) {
          throw new SchemaCompileError(`${field} must be an array of strings`);
        }
        out.required = value.items.map((it) => (it.kind === 'string' ? it.value : ''));
        break;
      }
      case 'properties': {
        if (value.kind !== 'object') {
          throw new SchemaCompileError(`${field} must be an object`);
        }
        out.properties = value.entries.map(([prop, child]) => [prop, compileFromNode(child, field)]);
        break;
      }
      case 'items': {
        out.items = compileFromNode(value, field);
        break;
      }
      case 'multipleOf':
      case 'minimum':
      case 'maximum': {
        if (value.kind !== 'number') {
          throw new SchemaCompileError(`${field} must be a JSON number`);
        }
        out.number ??= {};
        applyNumberConstraint(out.number, key, value.value);
        break;
      }
      default:
        // Unknown keywords are ignored, as in the original validator.
        break;
    }
  }
  return out;
}

function applyNumberConstraint(target: CompiledNumberConstraints, key: string, decimal: Decimal): void {
  if (key === 'multipleOf') {
    // Exact sign test: -0 carries sign -1 and is rejected just like 0.
    if (decimal.coefficient === 0n || decimal.sign === -1) {
      throw new SchemaCompileError(
        `multipleOf must be a strictly positive number, got ${decimal.raw}`,
      );
    }
    target.multipleOf = { divisor: decimal };
  } else if (key === 'minimum') {
    target.minimum = { bound: decimal };
  } else {
    target.maximum = { bound: decimal };
  }
}

function compileFromSpec(spec: SchemaSpec): CompiledSchema {
  const out: CompiledSchema = {};
  if (spec.type !== undefined) out.type = spec.type;
  if (spec.required !== undefined) out.required = [...spec.required];
  if (spec.properties !== undefined) {
    out.properties = Object.entries(spec.properties).map(([key, child]) => [
      key,
      compileFromSpec(child),
    ]);
  }
  if (spec.items !== undefined) out.items = compileFromSpec(spec.items);
  if (spec.multipleOf !== undefined || spec.minimum !== undefined || spec.maximum !== undefined) {
    const constraints: CompiledNumberConstraints = {};
    if (spec.multipleOf !== undefined) {
      applyNumberConstraint(constraints, 'multipleOf', parseJsonNumber(spec.multipleOf));
    }
    if (spec.minimum !== undefined) {
      applyNumberConstraint(constraints, 'minimum', parseJsonNumber(spec.minimum));
    }
    if (spec.maximum !== undefined) {
      applyNumberConstraint(constraints, 'maximum', parseJsonNumber(spec.maximum));
    }
    out.number = constraints;
  }
  return out;
}

const KNOWN_TYPES = new Set(['string', 'number', 'object', 'array']);
function isKnownType(value: string): value is NonNullable<SchemaSpec['type']> {
  return KNOWN_TYPES.has(value);
}

function validateNode(schema: CompiledSchema, node: JsonNode, path: string): Issue[] {
  const issues: Issue[] = [];

  if (schema.type !== undefined) {
    const jsonType = nodeKindToType(node);
    if (jsonType !== schema.type) {
      issues.push({ path, message: `expected ${schema.type}` });
      return issues;
    }
  }

  if (schema.number && node.kind === 'number') {
    const decimal = node.value;
    const { multipleOf, minimum, maximum } = schema.number;
    if (multipleOf && !isMultipleOf(decimal, multipleOf.divisor)) {
      issues.push({
        path,
        message: `${decimal.raw} is not a multiple of ${multipleOf.divisor.raw}`,
      });
    }
    if (minimum && compareDecimal(decimal, minimum.bound) < 0) {
      issues.push({
        path,
        message: `${decimal.raw} is less than minimum ${minimum.bound.raw}`,
      });
    }
    if (maximum && compareDecimal(decimal, maximum.bound) > 0) {
      issues.push({
        path,
        message: `${decimal.raw} is greater than maximum ${maximum.bound.raw}`,
      });
    }
  }

  if (node.kind === 'object' && (schema.required || schema.properties)) {
    for (const key of schema.required ?? []) {
      if (!node.entries.some(([existing]) => existing === key)) {
        issues.push({ path: joinPath(path, key), message: 'required' });
      }
    }
    for (const [key, child] of schema.properties ?? []) {
      const found = node.entries.find(([existing]) => existing === key);
      if (found) issues.push(...validateNode(child, found[1], joinPath(path, key)));
    }
  }

  if (node.kind === 'array' && schema.items) {
    node.items.forEach((item, index) => {
      issues.push(...validateNode(schema.items!, item, `${path}/${index}`));
    });
  }

  return issues;
}

function nodeKindToType(node: JsonNode): SchemaSpec['type'] {
  switch (node.kind) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'array':
      return 'array';
    case 'object':
      return 'object';
    default:
      // booleans/null have no matching type keyword in this validator.
      return undefined as unknown as SchemaSpec['type'];
  }
}

function joinPath(path: string, key: string): string {
  return `${path}/${key}`;
}
