import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseFrm } from "./parser";
import { serializeFrm } from "./serializer";
import { SUPPORTED_CONTROLS, type FrmDocument, type FrmNode } from "./types";

const ident = fc
  .stringMatching(/^[A-Za-z][A-Za-z0-9_]{0,8}$/)
  .filter((s) => s.toLowerCase() !== "end");

// Printable text including quotes; no newlines (a .frm string is one line).
const text = fc.string({ minLength: 0, maxLength: 20 }).map((s) => s.replace(/[\r\n]/g, " "));

const propValue = fc.oneof(
  fc.integer({ min: -100000, max: 100000 }),
  text,
);

const props = fc.dictionary(ident, propValue, { maxKeys: 5 });

const childType = fc.constantFrom(...SUPPORTED_CONTROLS.filter((t) => t !== "Form"));

const nodeWith = (children: fc.Arbitrary<FrmNode[]>): fc.Arbitrary<FrmNode> =>
  fc.record({ type: childType, name: ident, props, children });

// Fixed depth (3 levels) keeps generation bounded.
const leaf = nodeWith(fc.constant([] as FrmNode[]));
const level2 = nodeWith(fc.array(leaf, { maxLength: 2 }));
const node = nodeWith(fc.array(level2, { maxLength: 2 }));

const docArb: fc.Arbitrary<FrmDocument> = fc.record({
  version: fc.constantFrom("5.00", "6.00"),
  form: fc.record({
    type: fc.constant("Form"),
    name: ident,
    props,
    children: fc.array(node, { maxLength: 4 }),
  }),
  attributes: fc.constant({ VB_Name: "Form1" } as Record<string, string>),
  code: fc.constantFrom("", "Private Sub Command1_Click()\n   MsgBox \"hi\"\nEnd Sub"),
  warnings: fc.constant([] as string[]),
  unsupported: fc.constant([] as string[]),
});

describe("frm round trip (property-based)", () => {
  it("parse(serialize(doc)) equals doc", () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const r = parseFrm(serializeFrm(doc));
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.doc).toEqual(doc);
      }),
      { numRuns: 500 },
    );
  });
});
