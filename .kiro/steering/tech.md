# Tech conventions

- Vite + React 18 + TypeScript (strict). Tests: Vitest + fast-check.
- Layout: `src/frm` (parser/serializer), `src/vb` (lexer/parser/interpreter),
  `src/ui` (renderer + haunted shell), `samples/` (original forms).
- Pure logic modules (`frm`, `vb`) must not import React or touch the DOM.
- Parsers return typed results with line numbers in errors; never throw raw strings.
- Property-based tests (fast-check) for parse/serialize round trips and expressions.
- Run `npm test` and `npm run build` before finishing any task.
