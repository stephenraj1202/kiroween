import {
  SUPPORTED_CONTROLS,
  type FrmDocument,
  type FrmNode,
  type ParseResult,
  type PropValue,
} from "./types";

class FrmError extends Error {
  constructor(
    message: string,
    public line: number,
  ) {
    super(message);
  }
}

const BEGIN_RE = /^Begin\s+(?:VB\.)?([A-Za-z_][\w.]*)\s+([A-Za-z_]\w*)\s*$/i;
const PROP_RE = /^([A-Za-z_]\w*(?:\([^)]*\))?)\s*=\s*(.*)$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

/** Parses a raw value token. Returns undefined for binary resource references. */
function parseValue(raw: string): PropValue | undefined {
  const v = raw.trim();
  if (v.startsWith('"')) {
    const m = /^"((?:[^"]|"")*)"\s*(.*)$/.exec(v);
    if (!m) throw new Error("bad string literal");
    const rest = m[2];
    // binary resource: "Form1.frx":0000
    if (/^:\s*[0-9A-Fa-f]+/.test(rest)) return undefined;
    // a trailing VB comment (e.g. 'False) is allowed
    if (rest !== "" && !rest.startsWith("'")) throw new Error("bad string literal");
    return m[1].replace(/""/g, '"');
  }
  // Real forms write e.g. `Visible = 0 'False`; drop the trailing comment.
  const bare = v.replace(/\s*'.*$/, "");
  if (NUMBER_RE.test(bare)) return Number(bare);
  // True/False/hex etc. are kept as raw text.
  return bare;
}

export function parseFrm(text: string): ParseResult {
  try {
    return { ok: true, doc: parse(text) };
  } catch (e) {
    if (e instanceof FrmError) {
      return { ok: false, error: { message: e.message, line: e.line } };
    }
    throw e;
  }
}

function parse(text: string): FrmDocument {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  const warnings: string[] = [];
  const unsupported: string[] = [];
  let i = 0;

  while (i < lines.length && lines[i].trim() === "") i++;
  const versionMatch = /^VERSION\s+(\d+\.\d+)/i.exec(lines[i]?.trim() ?? "");
  if (!versionMatch) {
    throw new FrmError("Missing VERSION header (expected 'VERSION 5.00').", i + 1);
  }
  const version = versionMatch[1];
  i++;

  while (i < lines.length && lines[i].trim() === "") i++;
  const first = BEGIN_RE.exec(lines[i]?.trim() ?? "");
  if (!first || first[1].toLowerCase() !== "form") {
    throw new FrmError("Expected 'Begin VB.Form Name' after the header.", i + 1);
  }

  const parseBlock = (type: string, name: string, startLine: number): FrmNode => {
    const node: FrmNode = { type, name, props: {}, children: [] };
    if (!SUPPORTED_CONTROLS.includes(type as (typeof SUPPORTED_CONTROLS)[number])) {
      unsupported.push(`${type} ${name}`);
    }
    while (i < lines.length) {
      const raw = lines[i];
      const line = raw.trim();
      const lineNo = i + 1;
      i++;
      if (line === "") continue;
      if (/^End$/i.test(line)) return node;
      const begin = BEGIN_RE.exec(line);
      if (begin) {
        node.children.push(parseBlock(canonicalType(begin[1]), begin[2], lineNo));
        continue;
      }
      if (/^BeginProperty\b/i.test(line)) {
        // skip nested property groups (fonts, images)
        warnings.push(`Line ${lineNo}: nested property group skipped.`);
        let depth = 1;
        while (i < lines.length && depth > 0) {
          const t = lines[i].trim();
          if (/^BeginProperty\b/i.test(t)) depth++;
          if (/^EndProperty$/i.test(t)) depth--;
          i++;
        }
        continue;
      }
      const prop = PROP_RE.exec(line);
      if (!prop) {
        throw new FrmError(`Cannot understand line: ${line}`, lineNo);
      }
      let value: PropValue | undefined;
      try {
        value = parseValue(prop[2]);
      } catch {
        throw new FrmError(`Bad value for ${prop[1]}: ${prop[2]}`, lineNo);
      }
      if (value === undefined) {
        warnings.push(`Line ${lineNo}: binary resource for ${prop[1]} skipped.`);
      } else {
        node.props[prop[1]] = value;
      }
    }
    throw new FrmError(`Missing 'End' for ${type} ${name}.`, startLine);
  };

  const startLine = i + 1;
  i++;
  const form = parseBlock("Form", first[2], startLine);

  const attributes: Record<string, string> = {};
  const codeLines: string[] = [];
  for (; i < lines.length; i++) {
    const m = /^Attribute\s+([\w.]+)\s*=\s*(.*)$/i.exec(lines[i].trim());
    if (m) {
      const v = m[2].trim();
      attributes[m[1]] = v.startsWith('"') ? v.slice(1, -1).replace(/""/g, '"') : v;
    } else {
      codeLines.push(lines[i]);
    }
  }

  return {
    version,
    form,
    attributes,
    code: codeLines.join("\n").replace(/^\s*\n+/, "").replace(/\s+$/, ""),
    warnings,
    unsupported,
  };
}

function canonicalType(t: string): string {
  const found = SUPPORTED_CONTROLS.find((c) => c.toLowerCase() === t.toLowerCase());
  return found ?? t;
}
