export const SUPPORTED_CONTROLS = [
  "Form",
  "Label",
  "TextBox",
  "CommandButton",
  "CheckBox",
  "OptionButton",
  "ListBox",
  "Timer",
  "Frame",
] as const;

export type PropValue = string | number;

export interface FrmNode {
  /** VB control type without the "VB." prefix, e.g. "CommandButton". */
  type: string;
  name: string;
  props: Record<string, PropValue>;
  children: FrmNode[];
}

export interface FrmDocument {
  version: string;
  form: FrmNode;
  attributes: Record<string, string>;
  code: string;
  warnings: string[];
  unsupported: string[];
}

export interface ParseError {
  message: string;
  line: number;
}

export type ParseResult =
  | { ok: true; doc: FrmDocument }
  | { ok: false; error: ParseError };
