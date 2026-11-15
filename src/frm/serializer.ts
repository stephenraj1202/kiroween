import type { FrmDocument, FrmNode, PropValue } from "./types";

function fmtValue(v: PropValue): string {
  if (typeof v === "number") return String(v);
  // Raw tokens (True, &H80000005&, ...) are emitted bare; everything else quoted.
  // Strings that would re-parse as numbers or raw tokens must stay quoted, so we
  // always quote strings.
  return `"${v.replace(/"/g, '""')}"`;
}

function writeNode(node: FrmNode, indent: number, out: string[]): void {
  const pad = " ".repeat(indent);
  out.push(`${pad}Begin VB.${node.type} ${node.name}`);
  for (const [k, v] of Object.entries(node.props)) {
    out.push(`${pad}   ${k} = ${fmtValue(v)}`);
  }
  for (const c of node.children) writeNode(c, indent + 3, out);
  out.push(`${pad}End`);
}

export function serializeFrm(doc: FrmDocument): string {
  const out: string[] = [`VERSION ${doc.version}`];
  writeNode(doc.form, 0, out);
  for (const [k, v] of Object.entries(doc.attributes)) {
    out.push(`Attribute ${k} = "${v.replace(/"/g, '""')}"`);
  }
  if (doc.code) out.push(doc.code);
  return out.join("\n") + "\n";
}
