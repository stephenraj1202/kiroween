# How Kiro was used (running log)

- Steering: `.kiro/steering/` holds product, tech, and VB6 format notes so every session starts with the same context.
- Spec-driven: `.kiro/specs/frm-parser/` (requirements, design, tasks) was written before the parser code. Requirement IDs (R1-R5) map to the unit tests in `src/frm/parser.test.ts`.
- Property-based testing: `src/frm/roundtrip.test.ts` checks `parse(serialize(doc)) == doc` over 500 generated forms. The first run failed with a stack overflow, caused by an unbounded recursive generator in the test (not by the parser). Fixed with a fixed-depth generator.
