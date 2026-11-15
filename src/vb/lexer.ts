export interface Tok {
  t: "num" | "str" | "id" | "op" | "nl" | "eof" | "bad";
  v: string;
  n?: number;
  line: number;
}

export class VbSyntaxError extends Error {
  constructor(
    message: string,
    public line: number,
  ) {
    super(message);
  }
}

const TWO_CHAR = ["<>", "<=", ">="];
const ONE_CHAR = "+-*/\\^&=<>(),.";

export function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  const push = (t: Tok["t"], v: string, n?: number) => toks.push({ t, v, n, line });
  const atStatementStart = () => {
    const last = toks[toks.length - 1];
    return !last || last.t === "nl";
  };

  while (i < src.length) {
    const c = src[i];
    if (c === "\r") {
      i++;
    } else if (c === "\n") {
      push("nl", "\n");
      line++;
      i++;
    } else if (c === " " || c === "\t") {
      i++;
    } else if (c === "_" && /^_[ \t]*\r?\n/.test(src.slice(i, i + 40)) && /[ \t]/.test(src[i - 1] ?? "")) {
      // line continuation
      i = src.indexOf("\n", i) + 1;
      line++;
    } else if (c === "'") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === '"') {
      let j = i + 1;
      let s = "";
      let closed = false;
      while (j < src.length && src[j] !== "\n") {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            s += '"';
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        s += src[j++];
      }
      push(closed ? "str" : "bad", closed ? s : "unterminated string");
      i = j;
    } else if (/[0-9]/.test(c)) {
      const m = /^\d+(\.\d+)?([eE][-+]?\d+)?/.exec(src.slice(i))!;
      push("num", m[0], Number(m[0]));
      i += m[0].length;
    } else if (c === "&" && /^&[hH][0-9A-Fa-f]+&?/.test(src.slice(i))) {
      const m = /^&[hH]([0-9A-Fa-f]+)&?/.exec(src.slice(i))!;
      push("num", m[0], parseInt(m[1], 16));
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      i += m[0].length;
      if (src[i] === "$" || src[i] === "%") i++; // type suffix, ignored
      if (m[0].toLowerCase() === "rem" && atStatementStart()) {
        while (i < src.length && src[i] !== "\n") i++;
      } else {
        push("id", m[0]);
      }
    } else if (c === ":") {
      push("nl", ":");
      i++;
    } else if (TWO_CHAR.includes(src.slice(i, i + 2))) {
      push("op", src.slice(i, i + 2));
      i += 2;
    } else if (ONE_CHAR.includes(c)) {
      push("op", c);
      i++;
    } else {
      push("bad", c);
      i++;
    }
  }
  push("nl", "\n");
  push("eof", "");
  return toks;
}
