# JSON Schema core

TypeScript library for schema validation with **exact decimal arithmetic** for
numeric keywords.

Run `npm install`, then `npm test` and `npm run build`.

## Exact numeric validation

Numbers are parsed directly from their JSON lexeme into
`sign * coefficient * 10^exponent` (coefficient is a `BigInt`). A JS `Number`
is never involved, so:

- `0.29` is accepted for `multipleOf: 0.01` (no binary-float remainder);
- `0.29999999999999999` is rejected for `multipleOf: 0.01` — there is no
  epsilon that can wave a non-multiple through;
- integers beyond `Number.MAX_SAFE_INTEGER` keep every digit.

Compile a schema from raw JSON text and validate an instance from raw JSON
text, so the source spelling of every number is available for error messages:

```ts
import { compileSchema, validateJson } from './dist/index.js';

const schema = compileSchema('{"type":"number","multipleOf":0.01}');
validateJson(schema, '0.29');
// []
validateJson(schema, '0.291');
// [{ path: '#', message: '0.291 is not a multiple of 0.01' }]
```

`minimum`, `maximum`, `type`, `required`, `properties` and `items` are
supported as well; `minimum`/`maximum` are compared exactly and use the same
integer-ratio logic. Malformed instance JSON is reported as one issue at `#`.

Schemas can also be built programmatically; numeric constraints must be wrapped
in `num()` (a branded JSON number lexeme) — a JS `number` is never accepted
silently:

```ts
import { compileSchema, num } from './dist/index.js';

const schema = compileSchema({
  type: 'number',
  multipleOf: num('0.05'),
  minimum: num('-1e2'),
});
```

A **zero or negative `multipleOf`** (including `-0` and `-0.000`) is rejected
when the schema is compiled, before any instance is seen:

```text
SchemaCompileError: multipleOf must be a strictly positive number, got -0
```

## Resource budgets

Parsing untrusted input must stay bounded:

| Limit | Value | Meaning |
| --- | --- | --- |
| `MAX_DIGITS` | 1000 | coefficient digits per number lexeme |
| `MAX_EXPONENT_ABS` | 1 000 000 | bound on both the explicit and the adjusted exponent |

Both are exported from the package. Violations raise `NumberLexemeError`
(when parsing a lexeme directly) or `JsonSyntaxError` (inside a document).

## Lexical forms

Scientific notation (`1e-3`, `2.50E2`), trailing zeros (`1.00`), leading
zeros after the fraction point, negatives and `-0` are all supported. Lexical
equivalents (`1`, `1.0`, `100e-2`, `0.1e1`) validate identically; error
messages always quote the instance's original number text verbatim.

## Legacy API

`validate(schema, value, path?)` for plain JS values is retained for
compatibility. It does not perform numeric keyword comparisons (those require
the raw-text pipeline above).
