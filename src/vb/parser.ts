import type { CaseTest, Expr, Proc, Stmt, StmtBody, VbError, VbProgram } from "./ast";
import { lex, VbSyntaxError, type Tok } from "./lexer";

const UNSUPPORTED = new Set([
  "with", "goto", "gosub", "on", "redim", "open", "close", "print", "input", "end",
  "resume", "erase", "raiseevent", "load", "unload", "stop", "line", "get", "put",
]);

class P {
  pos = 0;
  /** Set while parsing a procedure body, for error recovery. */
  procKind: "sub" | "function" | null = null;

  constructor(private toks: Tok[]) {}

  get cur(): Tok {
    return this.toks[this.pos];
  }
  at(offset: number): Tok {
    return this.toks[Math.min(this.pos + offset, this.toks.length - 1)];
  }
  isId(w: string, t: Tok = this.cur): boolean {
    return t.t === "id" && t.v.toLowerCase() === w;
  }
  isOp(v: string, t: Tok = this.cur): boolean {
    return t.t === "op" && t.v === v;
  }
  atWords(words: string[]): boolean {
    return words.every((w, j) => this.isId(w, this.at(j)));
  }
  advance(): Tok {
    const t = this.cur;
    if (t.t !== "eof") this.pos++;
    return t;
  }
  err(msg: string, tok: Tok = this.cur): never {
    throw new VbSyntaxError(msg, tok.line);
  }
  describe(t: Tok): string {
    return t.t === "nl" ? "end of line" : t.t === "eof" ? "end of code" : `'${t.v}'`;
  }
  expectOp(v: string): void {
    if (!this.isOp(v)) this.err(`Expected '${v}' but found ${this.describe(this.cur)}`);
    this.advance();
  }
  expectId(): string {
    if (this.cur.t !== "id") this.err(`Expected a name but found ${this.describe(this.cur)}`);
    return this.advance().v;
  }
  skipNl(): void {
    while (this.cur.t === "nl") this.pos++;
  }
  endStmt(): void {
    if (this.cur.t === "nl") {
      this.pos++;
      return;
    }
    if (this.cur.t === "eof") return;
    this.err(`Unexpected ${this.describe(this.cur)}`);
  }

  // ---------- module level ----------

  parseModule(): VbProgram {
    const prog: VbProgram = { globals: [], init: [], procs: {}, errors: [] };
    for (;;) {
      this.skipNl();
      if (this.cur.t === "eof") break;
      const startPos = this.pos;
      try {
        this.parseTop(prog);
      } catch (e) {
        if (!(e instanceof VbSyntaxError)) throw e;
        prog.errors.push({ line: e.line, message: e.message });
        this.recover();
        if (this.pos === startPos) this.advance();
      }
    }
    return prog;
  }

  private recover(): void {
    if (this.procKind) {
      const kind = this.procKind;
      this.procKind = null;
      while (this.cur.t !== "eof") {
        if (this.atWords(["end", kind])) {
          this.pos += 2;
          return;
        }
        this.pos++;
      }
      return;
    }
    while (this.cur.t !== "nl" && this.cur.t !== "eof") this.pos++;
  }

  private parseTop(prog: VbProgram): void {
    const w = this.cur.t === "id" ? this.cur.v.toLowerCase() : "";
    if (w === "option" || w === "attribute") {
      while (this.cur.t !== "nl" && this.cur.t !== "eof") this.pos++;
      return;
    }
    while (["private", "public", "friend", "static", "global"].includes(this.cur.v.toLowerCase()) && this.cur.t === "id") {
      this.advance();
    }
    const kw = this.cur.t === "id" ? this.cur.v.toLowerCase() : "";
    if (kw === "sub" || kw === "function") {
      const proc = this.parseProc(kw);
      prog.procs[proc.name.toLowerCase()] = proc;
    } else if (kw === "const") {
      const s = this.parseConst();
      prog.init.push(s);
      prog.globals.push({ name: (s as { name: string }).name, type: "Variant" });
    } else if (kw === "dim" || (this.cur.t === "id" && this.isId("as", this.at(1)))) {
      if (kw === "dim") this.advance();
      const d = this.parseDimNames(this.cur.line);
      prog.globals.push(...d.names);
    } else if (kw === "declare" || kw === "type" || kw === "enum" || kw === "property" || kw === "event" || kw === "implements") {
      this.err(`Unsupported declaration: ${this.cur.v}`);
    } else {
      this.err(`Unexpected ${this.describe(this.cur)} outside a Sub or Function`);
    }
  }

  private parseProc(kind: "sub" | "function"): Proc {
    const line = this.cur.line;
    this.advance();
    this.procKind = kind;
    const name = this.expectId();
    const params: string[] = [];
    if (this.isOp("(")) {
      this.advance();
      while (!this.isOp(")")) {
        while (["optional", "byval", "byref", "paramarray"].includes(this.cur.v.toLowerCase()) && this.cur.t === "id") {
          this.advance();
        }
        params.push(this.expectId());
        if (this.isOp("(")) this.err("Array parameters are not supported");
        if (this.isId("as")) {
          this.advance();
          this.expectId();
        }
        if (this.isOp(",")) this.advance();
        else if (!this.isOp(")")) this.err(`Unexpected ${this.describe(this.cur)} in parameter list`);
      }
      this.advance();
    }
    let returnType = "Variant";
    if (this.isId("as")) {
      this.advance();
      returnType = this.expectId();
    }
    this.endStmt();
    const body = this.parseBlock([["end", kind]], `End ${kind === "sub" ? "Sub" : "Function"}`);
    this.pos += 2;
    this.procKind = null;
    this.endStmt();
    return { name, kind, params, returnType, body, line };
  }

  // ---------- statements ----------

  private parseBlock(stops: string[][], what: string): Stmt[] {
    const body: Stmt[] = [];
    for (;;) {
      this.skipNl();
      if (this.cur.t === "eof") this.err(`Missing '${what}'`);
      if (stops.some((s) => this.atWords(s))) return body;
      body.push(this.parseStatement());
    }
  }

  private mk(line: number, b: StmtBody): Stmt {
    return { ...b, line } as Stmt;
  }

  parseStatement(): Stmt {
    const t = this.cur;
    if (t.t !== "id") this.err(`Unexpected ${this.describe(t)}`);
    const w = t.v.toLowerCase();
    switch (w) {
      case "dim":
      case "static":
        this.advance();
        return this.parseDimNames(t.line);
      case "const":
        return this.parseConst();
      case "if":
        return this.parseIf();
      case "for":
        return this.parseFor();
      case "do":
        return this.parseDo();
      case "while":
        return this.parseWhile();
      case "select":
        return this.parseSelect();
      default: {
        if (UNSUPPORTED.has(w)) this.err(`Unsupported statement: ${t.v}`);
        const s = this.parseSimple();
        this.endStmt();
        return s;
      }
    }
  }

  private parseDimNames(line: number): Stmt {
    const names: { name: string; type: string }[] = [];
    for (;;) {
      const name = this.expectId();
      let type = "Variant";
      if (this.isOp("(")) this.err("Arrays are not supported");
      if (this.isId("as")) {
        this.advance();
        if (this.isId("new")) this.err("'As New' is not supported");
        type = this.expectId();
      }
      names.push({ name, type });
      if (this.isOp(",")) this.advance();
      else break;
    }
    this.endStmt();
    return this.mk(line, { k: "dim", names });
  }

  private parseConst(): Stmt {
    const line = this.cur.line;
    this.advance();
    const name = this.expectId();
    if (this.isId("as")) {
      this.advance();
      this.expectId();
    }
    this.expectOp("=");
    const value = this.parseExpr();
    this.endStmt();
    return this.mk(line, { k: "const", name, value });
  }

  private parseIf(): Stmt {
    const line = this.cur.line;
    this.advance();
    const cond = this.parseExpr();
    if (!this.isId("then")) this.err("Expected 'Then'");
    this.advance();
    if (this.cur.t !== "nl") {
      const body = [this.parseSimpleOrIf()];
      let els: Stmt[] = [];
      if (this.isId("else")) {
        this.advance();
        els = [this.parseSimpleOrIf()];
      }
      this.endStmt();
      return this.mk(line, { k: "if", branches: [{ cond, body }], else: els });
    }
    const stops = [["elseif"], ["else"], ["end", "if"]];
    const branches = [{ cond, body: this.parseBlock(stops, "End If") }];
    let els: Stmt[] = [];
    for (;;) {
      if (this.atWords(["elseif"])) {
        this.advance();
        const c = this.parseExpr();
        if (!this.isId("then")) this.err("Expected 'Then'");
        this.advance();
        branches.push({ cond: c, body: this.parseBlock(stops, "End If") });
      } else if (this.atWords(["else"])) {
        this.advance();
        els = this.parseBlock([["end", "if"]], "End If");
      } else break;
    }
    this.pos += 2;
    this.endStmt();
    return this.mk(line, { k: "if", branches, else: els });
  }

  private parseSimpleOrIf(): Stmt {
    if (this.isId("if")) {
      this.err("Nested single-line If is not supported");
    }
    const w = this.cur.v.toLowerCase();
    if (this.cur.t === "id" && UNSUPPORTED.has(w)) this.err(`Unsupported statement: ${this.cur.v}`);
    return this.parseSimple();
  }

  private parseFor(): Stmt {
    const line = this.cur.line;
    this.advance();
    if (this.isId("each")) this.err("'For Each' is not supported");
    const v = this.expectId();
    this.expectOp("=");
    const from = this.parseExpr();
    if (!this.isId("to")) this.err("Expected 'To'");
    this.advance();
    const to = this.parseExpr();
    let step: Expr | undefined;
    if (this.isId("step")) {
      this.advance();
      step = this.parseExpr();
    }
    this.endStmt();
    const body = this.parseBlock([["next"]], "Next");
    this.advance();
    if (this.cur.t === "id") this.advance();
    this.endStmt();
    return this.mk(line, { k: "for", v, from, to, step, body });
  }

  private parseDo(): Stmt {
    const line = this.cur.line;
    this.advance();
    let cond: Expr | undefined;
    let until = false;
    let post = false;
    if (this.isId("while") || this.isId("until")) {
      until = this.isId("until");
      this.advance();
      cond = this.parseExpr();
    }
    this.endStmt();
    const body = this.parseBlock([["loop"]], "Loop");
    this.advance();
    if (!cond && (this.isId("while") || this.isId("until"))) {
      until = this.isId("until");
      post = true;
      this.advance();
      cond = this.parseExpr();
    }
    this.endStmt();
    return this.mk(line, { k: "do", cond, until, post, body });
  }

  private parseWhile(): Stmt {
    const line = this.cur.line;
    this.advance();
    const cond = this.parseExpr();
    this.endStmt();
    const body = this.parseBlock([["wend"]], "Wend");
    this.advance();
    this.endStmt();
    return this.mk(line, { k: "do", cond, until: false, post: false, body });
  }

  private parseSelect(): Stmt {
    const line = this.cur.line;
    this.advance();
    if (!this.isId("case")) this.err("Expected 'Case' after 'Select'");
    this.advance();
    const subject = this.parseExpr();
    this.endStmt();
    const cases: { tests: CaseTest[] | null; body: Stmt[] }[] = [];
    this.skipNl();
    while (this.isId("case")) {
      this.advance();
      let tests: CaseTest[] | null = null;
      if (this.isId("else")) {
        this.advance();
      } else {
        tests = [];
        for (;;) {
          if (this.isId("is")) {
            this.advance();
            const op = this.cur.t === "op" ? this.advance().v : this.err("Expected a comparison after 'Is'");
            tests.push({ k: "is", op, e: this.parseExpr() });
          } else {
            const e = this.parseExpr();
            if (this.isId("to")) {
              this.advance();
              tests.push({ k: "range", lo: e, hi: this.parseExpr() });
            } else tests.push({ k: "eq", e });
          }
          if (this.isOp(",")) this.advance();
          else break;
        }
      }
      const body = this.parseBlock([["case"], ["end", "select"]], "End Select");
      cases.push({ tests, body });
    }
    if (!this.atWords(["end", "select"])) this.err("Expected 'Case' or 'End Select'");
    this.pos += 2;
    this.endStmt();
    return this.mk(line, { k: "select", subject, cases });
  }

  /** assignment, call, method call, Exit. Does not consume the line end. */
  private parseSimple(): Stmt {
    const line = this.cur.line;
    if (this.isId("exit")) {
      this.advance();
      const what = this.expectId().toLowerCase();
      if (what !== "sub" && what !== "function" && what !== "for" && what !== "do") {
        this.err(`Unsupported 'Exit ${what}'`);
      }
      return this.mk(line, { k: "exit", what });
    }
    if (this.isId("call") || this.isId("set")) this.advance();
    const name = this.expectId();
    if (this.isOp(".")) {
      this.advance();
      const prop = this.expectId();
      if (this.isOp("=")) {
        this.advance();
        const value = this.parseExpr();
        return this.mk(line, {
          k: "assign",
          target: { k: "member", obj: name, prop, args: [] },
          value,
        });
      }
      const args = this.isOp("(") ? this.parseParenArgs() : this.parseBareArgs();
      return this.mk(line, { k: "mcall", obj: name, method: prop, args });
    }
    if (this.isOp("=")) {
      this.advance();
      const value = this.parseExpr();
      return this.mk(line, { k: "assign", target: { k: "var", name }, value });
    }
    const args = this.isOp("(") ? this.parseParenArgs() : this.parseBareArgs();
    return this.mk(line, { k: "call", name, args });
  }

  private parseBareArgs(): Expr[] {
    if (this.cur.t === "nl" || this.cur.t === "eof" || this.isId("else")) return [];
    const args = [this.parseExpr()];
    while (this.isOp(",")) {
      this.advance();
      args.push(this.parseExpr());
    }
    return args;
  }

  private parseParenArgs(): Expr[] {
    this.expectOp("(");
    const args: Expr[] = [];
    if (this.isOp(")")) {
      this.advance();
      return args;
    }
    for (;;) {
      args.push(this.parseExpr());
      if (this.isOp(",")) this.advance();
      else break;
    }
    this.expectOp(")");
    return args;
  }

  // ---------- expressions ----------

  private matchOp(ops: string[]): string | null {
    const t = this.cur;
    if (t.t === "op" && ops.includes(t.v)) return t.v;
    if (t.t === "id" && ops.includes(t.v.toLowerCase())) return t.v.toLowerCase();
    return null;
  }

  private bin(next: () => Expr, ops: string[]): Expr {
    let l = next();
    for (;;) {
      const op = this.matchOp(ops);
      if (!op) return l;
      this.advance();
      l = { k: "bin", op, l, r: next() };
    }
  }

  parseExpr(): Expr {
    return this.bin(() => this.parseOr(), ["xor"]);
  }
  private parseOr(): Expr {
    return this.bin(() => this.parseAnd(), ["or"]);
  }
  private parseAnd(): Expr {
    return this.bin(() => this.parseNot(), ["and"]);
  }
  private parseNot(): Expr {
    if (this.isId("not")) {
      this.advance();
      return { k: "un", op: "not", e: this.parseNot() };
    }
    return this.bin(() => this.parseConcat(), ["=", "<>", "<", ">", "<=", ">="]);
  }
  private parseConcat(): Expr {
    return this.bin(() => this.parseAdd(), ["&"]);
  }
  private parseAdd(): Expr {
    return this.bin(() => this.parseMod(), ["+", "-"]);
  }
  private parseMod(): Expr {
    return this.bin(() => this.parseIntDiv(), ["mod"]);
  }
  private parseIntDiv(): Expr {
    return this.bin(() => this.parseMul(), ["\\"]);
  }
  private parseMul(): Expr {
    return this.bin(() => this.parseUnary(), ["*", "/"]);
  }
  private parseUnary(): Expr {
    if (this.isOp("-")) {
      this.advance();
      return { k: "un", op: "-", e: this.parseUnary() };
    }
    if (this.isOp("+")) {
      this.advance();
      return this.parseUnary();
    }
    return this.parsePow();
  }
  private parsePow(): Expr {
    return this.bin(() => this.parsePowOperand(), ["^"]);
  }
  private parsePowOperand(): Expr {
    if (this.isOp("-")) {
      this.advance();
      return { k: "un", op: "-", e: this.parsePowOperand() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const t = this.cur;
    if (t.t === "num") {
      this.advance();
      return { k: "num", v: t.n! };
    }
    if (t.t === "str") {
      this.advance();
      return { k: "str", v: t.v };
    }
    if (this.isOp("(")) {
      this.advance();
      const e = this.parseExpr();
      this.expectOp(")");
      return e;
    }
    if (t.t === "id") {
      this.advance();
      const w = t.v.toLowerCase();
      if (w === "true") return { k: "bool", v: true };
      if (w === "false") return { k: "bool", v: false };
      if (this.isOp(".") && this.at(1).t === "id") {
        this.advance();
        const prop = this.advance().v;
        const args = this.isOp("(") ? this.parseParenArgs() : [];
        return { k: "member", obj: t.v, prop, args };
      }
      if (this.isOp("(")) return { k: "call", name: t.v, args: this.parseParenArgs() };
      return { k: "var", name: t.v };
    }
    return this.err(`Unexpected ${this.describe(t)}`);
  }
}

export function parseVb(code: string): VbProgram {
  return new P(lex(code)).parseModule();
}

export function parseVbExpression(src: string): Expr {
  const p = new P(lex(src));
  const e = p.parseExpr();
  if (p.cur.t !== "nl" && p.cur.t !== "eof") p.err(`Unexpected ${p.describe(p.cur)}`);
  return e;
}

export type { VbError };
