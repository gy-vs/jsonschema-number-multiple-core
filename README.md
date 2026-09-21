# JSON Schema core

TypeScript library for schema validation.

Run `npm install`, then `npm test` and `npm run build`.

## Exact decimal numeric keywords

`multipleOf`, `minimum` and `maximum` are evaluated with exact decimal
arithmetic, never through a binary `Number`. Numbers are parsed from their
JSON lexical form into `sign × coefficient (BigInt) × 10^exponent`, so
`0.29` is a multiple of `0.01`, `0.29000000000000001` is not, and integers
beyond `Number.MAX_SAFE_INTEGER` stay precise.

```ts
import { compileSchema, validateJson } from 'jsonschema-number-multiple-core';

const schema = compileSchema({ type: 'number', multipleOf: 0.01 });
validateJson(schema, '0.29');   // []
validateJson(schema, '0.295');  // [{ path: '#', message: '0.295 is not a multiple of 0.01' }]
```

- `validateJson` takes the **raw JSON text** (not a parsed value), because
  `JSON.parse` would already have lost the precision being checked. Issue
  messages quote the instance's original number text (`2.95e-1`, `-0`, …).
- Schema keywords accept a JS number (read via shortest round-trip, so
  `0.01` means `0.01`) or a string lexeme (`'0.010'`, `'1e-500'`) for full
  control over the decimal.
- `compileSchema` rejects a zero or negative `multipleOf`, non-finite
  numbers, malformed lexemes and over-budget literals at compile time.
- Resource budget (`{ maxCoefficientDigits: 1000, maxExponent: 100000 }` by
  default) bounds mantissa digits and the decimal exponent; instance
  numbers outside the budget are reported as issues instead of being
  approximated. Pass a custom budget as the last argument to
  `compileSchema` / `validateJson`.

The legacy `validate(schema, value)` API for already-parsed values is
unchanged.
