# Design: FRM parser

```ts
type FrmNode = { type: string; name: string; props: Record<string, string | number>; children: FrmNode[] };
type FrmDocument = { version: string; form: FrmNode; attributes: Record<string,string>; code: string; warnings: string[]; unsupported: string[] };
type ParseResult = { ok: true; doc: FrmDocument } | { ok: false; error: { message: string; line: number } };
```

- `parseFrm(text): ParseResult` - line-based recursive descent, no regex over the whole file.
- `serializeFrm(doc): string` - emits canonical text; round trip `parse(serialize(doc))` equals `doc` for valid docs (PBT).
- Pure module under `src/frm`, no DOM or React.
- Value encoding: numbers when the raw token is an integer or decimal, otherwise strings. Strings are always serialized quoted.
