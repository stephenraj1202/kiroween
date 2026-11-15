import type { FrmNode } from "../frm/types";
import type { CaseTest, Expr, Proc, Stmt, VbProgram } from "./ast";
import { parseVb } from "./parser";

export type Value = number | string | boolean;
type Signal = undefined | "sub" | "for" | "do";
interface Slot {
  v: Value;
  type: string;
}
interface Env {
  locals: Map<string, Slot>;
}

export class VbRuntimeError extends Error {}

export interface ControlState {
  type: string;
  name: string;
  parent: string | null;
  children: string[];
  /** Property names are lower-case. */
  props: Record<string, Value>;
  items: string[];
}

export interface RuntimeOptions {
  random?: () => number;
  msgBox?: (text: string, title: string) => void;
}

const MAX_STEPS = 1_000_000;
const MAX_DEPTH = 100;

const DEFAULT_PROP: Record<string, string> = {
  textbox: "text",
  label: "caption",
  commandbutton: "caption",
  checkbox: "value",
  optionbutton: "value",
  listbox: "text",
  timer: "enabled",
  frame: "caption",
  form: "caption",
};

const CONSTANTS: Record<string, Value> = {
  vbcrlf: "\n",
  vbnewline: "\n",
  vblf: "\n",
  vbcr: "\r",
  vbtab: "\t",
  vbtrue: -1,
  vbfalse: 0,
  vbokonly: 0,
  vbok: 1,
  vbyesno: 4,
  vbyes: 6,
  vbno: 7,
  vbcritical: 16,
  vbquestion: 32,
  vbexclamation: 48,
  vbinformation: 64,
  vbchecked: 1,
  vbunchecked: 0,
};

function roundHalfEven(n: number): number {
  if (Math.abs(n % 1) === 0.5) return 2 * Math.round(n / 2);
  return Math.round(n);
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) throw new VbRuntimeError("Overflow");
  return String(Number(n.toPrecision(15))).replace("e", "E");
}

function str(v: Value): string {
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "True" : "False";
  return formatNumber(v);
}

function tryNum(v: Value): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? -1 : 0;
  const s = v.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

function num(v: Value): number {
  const n = tryNum(v);
  if (n === null) throw new VbRuntimeError("Type mismatch");
  return n;
}

function truthy(v: Value): boolean {
  if (typeof v === "boolean") return v;
  return num(v) !== 0;
}

function defaultFor(type: string): Value {
  switch (type.toLowerCase()) {
    case "string":
      return "";
    case "boolean":
      return false;
    default:
      return 0;
  }
}

function coerce(v: Value, type: string): Value {
  switch (type.toLowerCase()) {
    case "integer":
    case "long":
    case "byte":
      return roundHalfEven(num(v));
    case "single":
    case "double":
    case "currency":
      return num(v);
    case "string":
      return str(v);
    case "boolean":
      return truthy(v);
    default:
      return v;
  }
}

function valParse(s: string): number {
  const m = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(s);
  return m ? Number(m[0]) : 0;
}

export class Runtime {
  program: VbProgram;
  controls = new Map<string, ControlState>();
  formName: string;
  errors: string[] = [];
  messages: { text: string; title: string }[] = [];
  private globals = new Map<string, Slot>();
  private listeners = new Set<() => void>();
  private version = 0;
  private steps = 0;
  private depth = 0;
  private curLine = 0;
  private random: () => number;
  private msgBoxHook?: (text: string, title: string) => void;

  constructor(doc: { form: FrmNode; code: string }, opts: RuntimeOptions = {}) {
    this.random = opts.random ?? Math.random;
    this.msgBoxHook = opts.msgBox;
    this.formName = doc.form.name;
    this.addControl(doc.form, null);
    this.program = parseVb(doc.code);
    for (const g of this.program.globals) {
      this.globals.set(g.name.toLowerCase(), { v: defaultFor(g.type), type: g.type });
    }
    try {
      this.curLine = 0;
      this.execBlock(this.program.init, { locals: new Map() });
    } catch (e) {
      this.recordError(e);
    }
  }

  // ---------- public API ----------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = (): number => this.version;
  private notify(): void {
    this.version++;
    this.listeners.forEach((f) => f());
  }

  getControl(name: string): ControlState | undefined {
    return this.controls.get(name.toLowerCase());
  }

  get(name: string, prop: string): Value | undefined {
    return this.getControl(name)?.props[prop.toLowerCase()];
  }

  start(): void {
    this.fire(this.formName, "Load");
  }

  fire(control: string, event: string): void {
    const names = [`${control}_${event}`];
    if (control.toLowerCase() === this.formName.toLowerCase()) names.push(`form_${event}`);
    for (const n of names) {
      const proc = this.program.procs[n.toLowerCase()];
      if (!proc) continue;
      this.steps = 0;
      this.depth = 0;
      try {
        this.callProc(proc, []);
      } catch (e) {
        this.recordError(e);
      }
      break;
    }
    this.notify();
  }

  userSetText(name: string, text: string): void {
    const c = this.getControl(name);
    if (!c) return;
    c.props.text = text;
    this.fire(name, "Change");
  }

  userSetCheck(name: string, checked: boolean): void {
    const c = this.getControl(name);
    if (!c) return;
    c.props.value = checked ? 1 : 0;
    this.fire(name, "Click");
  }

  userSelectOption(name: string): void {
    const c = this.getControl(name);
    if (!c) return;
    this.setProp(c, "value", true);
    this.fire(name, "Click");
  }

  userSelectItem(name: string, index: number): void {
    const c = this.getControl(name);
    if (!c) return;
    c.props.listindex = index;
    this.fire(name, "Click");
  }

  timers(): { name: string; interval: number }[] {
    const out: { name: string; interval: number }[] = [];
    for (const c of this.controls.values()) {
      if (c.type !== "Timer") continue;
      const interval = Number(c.props.interval ?? 0);
      if (c.props.enabled === true && interval > 0) out.push({ name: c.name, interval });
    }
    return out;
  }

  /** Calls a Sub/Function directly. Throws on any error. Used by tests and helpers. */
  callFunction(name: string, args: Value[] = []): Value {
    if (this.program.errors.length) throw new Error(this.program.errors[0].message);
    const proc = this.program.procs[name.toLowerCase()];
    if (!proc) throw new Error(`No such procedure: ${name}`);
    this.steps = 0;
    this.depth = 0;
    return this.callProc(proc, args);
  }

  // ---------- control state ----------

  private addControl(node: FrmNode, parent: string | null): void {
    const props: Record<string, Value> = {
      caption: "",
      text: "",
      enabled: true,
      visible: true,
    };
    for (const [k, v] of Object.entries(node.props)) props[k.toLowerCase()] = v;
    const asBool = (v: Value): boolean => !(v === 0 || v === "0" || String(v).toLowerCase() === "false");
    props.enabled = asBool(props.enabled);
    props.visible = asBool(props.visible);
    props.caption = String(props.caption);
    props.text = String(props.text);
    if (node.type === "CheckBox") props.value = (tryNum(props.value ?? 0) ?? 0) !== 0 ? 1 : 0;
    if (node.type === "OptionButton") props.value = asBool(props.value ?? false) && props.value !== undefined;
    if (node.type === "ListBox") props.listindex = -1;
    if (node.type === "Timer") props.interval = Number(props.interval ?? 0) || 0;
    const state: ControlState = {
      type: node.type,
      name: node.name,
      parent,
      children: node.children.map((c) => c.name),
      props,
      items: [],
    };
    this.controls.set(node.name.toLowerCase(), state);
    for (const c of node.children) this.addControl(c, node.name);
  }

  private ctl(name: string): ControlState {
    const lower = name.toLowerCase();
    const c = this.controls.get(lower === "me" ? this.formName.toLowerCase() : lower);
    if (!c) throw new VbRuntimeError(`Object required: ${name}`);
    return c;
  }

  private setProp(c: ControlState, prop: string, v: Value): void {
    switch (prop) {
      case "caption":
      case "text":
      case "tag":
        c.props[prop] = str(v);
        break;
      case "enabled":
      case "visible":
        c.props[prop] = truthy(v);
        break;
      case "value":
        if (c.type === "OptionButton") {
          const on = truthy(v);
          if (on) {
            for (const other of this.controls.values()) {
              if (other.type === "OptionButton" && other.parent === c.parent) other.props.value = false;
            }
          }
          c.props.value = on;
        } else if (c.type === "CheckBox") {
          c.props.value = num(v) !== 0 ? 1 : 0;
        } else c.props.value = v;
        break;
      case "listindex":
      case "interval":
      case "left":
      case "top":
      case "width":
      case "height":
        c.props[prop] = num(v);
        break;
      default:
        c.props[prop] = v;
    }
  }

  private getMember(obj: string, prop: string, args: Value[]): Value {
    const c = this.ctl(obj);
    const p = prop.toLowerCase();
    if (c.type === "ListBox") {
      if (p === "listcount") return c.items.length;
      if (p === "list") return c.items[num(args[0] ?? 0)] ?? "";
      if (p === "text") return c.items[Number(c.props.listindex)] ?? "";
    }
    const v = c.props[p];
    if (v !== undefined) return v;
    if (["left", "top", "width", "height", "tabindex", "index"].includes(p)) return 0;
    if (p === "tag") return "";
    throw new VbRuntimeError(`Property '${prop}' is not supported on ${c.name}`);
  }

  private callMethod(obj: string, method: string, args: Value[]): void {
    const c = this.ctl(obj);
    const m = method.toLowerCase();
    if (c.type === "ListBox") {
      if (m === "additem") {
        const item = str(args[0] ?? "");
        if (args[1] === undefined) c.items.push(item);
        else c.items.splice(num(args[1]), 0, item);
        return;
      }
      if (m === "removeitem") {
        const i = num(args[0] ?? -1);
        if (i < 0 || i >= c.items.length) throw new VbRuntimeError("Invalid procedure call or argument");
        c.items.splice(i, 1);
        c.props.listindex = -1;
        return;
      }
      if (m === "clear") {
        c.items = [];
        c.props.listindex = -1;
        return;
      }
    }
    if (["setfocus", "refresh", "move", "zorder"].includes(m)) return;
    throw new VbRuntimeError(`Method '${method}' is not supported on ${c.name}`);
  }

  // ---------- execution ----------

  private recordError(e: unknown): void {
    const msg = e instanceof Error ? e.message : String(e);
    this.errors.push(this.curLine ? `${msg} (line ${this.curLine})` : msg);
    if (this.errors.length > 20) this.errors.shift();
  }

  private fail(msg: string): never {
    throw new VbRuntimeError(msg);
  }

  private callProc(proc: Proc, args: Value[]): Value {
    if (++this.depth > MAX_DEPTH) this.fail("Out of stack space");
    const env: Env = { locals: new Map() };
    proc.params.forEach((p, i) => env.locals.set(p.toLowerCase(), { v: args[i] ?? 0, type: "Variant" }));
    if (proc.kind === "function") {
      env.locals.set(proc.name.toLowerCase(), {
        v: defaultFor(proc.returnType),
        type: proc.returnType,
      });
    }
    try {
      this.execBlock(proc.body, env);
    } finally {
      this.depth--;
    }
    return proc.kind === "function" ? env.locals.get(proc.name.toLowerCase())!.v : 0;
  }

  private execBlock(body: Stmt[], env: Env): Signal {
    for (const s of body) {
      const sig = this.exec(s, env);
      if (sig) return sig;
    }
    return undefined;
  }

  private slot(name: string, env: Env): Slot | undefined {
    const l = name.toLowerCase();
    return env.locals.get(l) ?? this.globals.get(l);
  }

  private setVar(name: string, v: Value, env: Env): void {
    const s = this.slot(name, env);
    if (s) s.v = coerce(v, s.type);
    else env.locals.set(name.toLowerCase(), { v, type: "Variant" });
  }

  private exec(s: Stmt, env: Env): Signal {
    if (++this.steps > MAX_STEPS) this.fail("Infinite loop banished (too many steps)");
    this.curLine = s.line;
    switch (s.k) {
      case "dim":
        for (const n of s.names) {
          env.locals.set(n.name.toLowerCase(), { v: defaultFor(n.type), type: n.type });
        }
        return undefined;
      case "const": {
        const v = this.eval(s.value, env);
        const key = s.name.toLowerCase();
        const existing = this.globals.get(key);
        if (existing) existing.v = v;
        else env.locals.set(key, { v, type: "Variant" });
        return undefined;
      }
      case "assign": {
        const v = this.eval(s.value, env);
        const t = s.target;
        if (t.k === "var") this.setVar(t.name, v, env);
        else if (t.k === "member") this.setProp(this.ctl(t.obj), t.prop.toLowerCase(), v);
        return undefined;
      }
      case "call": {
        const args = s.args.map((a) => this.eval(a, env));
        this.callNamed(s.name, args, true);
        return undefined;
      }
      case "mcall":
        this.callMethod(s.obj, s.method, s.args.map((a) => this.eval(a, env)));
        return undefined;
      case "if": {
        for (const b of s.branches) {
          if (truthy(this.eval(b.cond, env))) return this.execBlock(b.body, env);
        }
        return this.execBlock(s.else, env);
      }
      case "for": {
        const from = num(this.eval(s.from, env));
        const to = num(this.eval(s.to, env));
        const step = s.step ? num(this.eval(s.step, env)) : 1;
        if (step === 0) this.fail("Invalid procedure call or argument");
        this.setVar(s.v, from, env);
        for (;;) {
          const i = num(this.slot(s.v, env)!.v);
          if (step > 0 ? i > to : i < to) break;
          const sig = this.execBlock(s.body, env);
          if (sig === "for") break;
          if (sig) return sig;
          this.setVar(s.v, num(this.slot(s.v, env)!.v) + step, env);
          if (++this.steps > MAX_STEPS) this.fail("Infinite loop banished (too many steps)");
        }
        return undefined;
      }
      case "do": {
        const test = (): boolean => {
          if (!s.cond) return true;
          const c = truthy(this.eval(s.cond, env));
          return s.until ? !c : c;
        };
        if (!s.post && !test()) return undefined;
        for (;;) {
          const sig = this.execBlock(s.body, env);
          if (sig === "do") break;
          if (sig) return sig;
          if (++this.steps > MAX_STEPS) this.fail("Infinite loop banished (too many steps)");
          if (!test()) break;
        }
        return undefined;
      }
      case "select": {
        const subject = this.eval(s.subject, env);
        for (const c of s.cases) {
          if (c.tests === null || c.tests.some((t) => this.matches(t, subject, env))) {
            return this.execBlock(c.body, env);
          }
        }
        return undefined;
      }
      case "exit":
        return s.what === "function" ? "sub" : s.what;
    }
  }

  private matches(t: CaseTest, subject: Value, env: Env): boolean {
    switch (t.k) {
      case "eq":
        return this.compare("=", subject, this.eval(t.e, env));
      case "range":
        return (
          this.compare(">=", subject, this.eval(t.lo, env)) &&
          this.compare("<=", subject, this.eval(t.hi, env))
        );
      case "is":
        return this.compare(t.op, subject, this.eval(t.e, env));
    }
  }

  private compare(op: string, a: Value, b: Value): boolean {
    let x: number | string;
    let y: number | string;
    const na = tryNum(a);
    const nb = tryNum(b);
    if (typeof a === "string" && typeof b === "string") {
      x = a;
      y = b;
    } else if (na !== null && nb !== null) {
      x = na;
      y = nb;
    } else {
      x = str(a);
      y = str(b);
    }
    switch (op) {
      case "=":
        return x === y;
      case "<>":
        return x !== y;
      case "<":
        return x < y;
      case ">":
        return x > y;
      case "<=":
        return x <= y;
      case ">=":
        return x >= y;
    }
    return this.fail(`Unknown operator ${op}`);
  }

  // ---------- expressions ----------

  eval(e: Expr, env: Env): Value {
    switch (e.k) {
      case "num":
      case "str":
      case "bool":
        return e.v;
      case "var": {
        const s = this.slot(e.name, env);
        if (s) return s.v;
        const lower = e.name.toLowerCase();
        if (this.program.procs[lower]) return this.callProc(this.program.procs[lower], []);
        if (lower in CONSTANTS) return CONSTANTS[lower];
        const b = BUILTINS[lower];
        if (b) return b(this, []);
        const c = this.controls.get(lower === "me" ? this.formName.toLowerCase() : lower);
        if (c) return this.getMember(c.name, DEFAULT_PROP[c.type.toLowerCase()] ?? "caption", []);
        return 0; // undeclared variable: VB's Empty
      }
      case "member":
        return this.getMember(e.obj, e.prop, e.args.map((a) => this.eval(a, env)));
      case "call": {
        const slot = this.slot(e.name, env);
        if (slot) this.fail("Arrays are not supported");
        return this.callNamed(e.name, e.args.map((a) => this.eval(a, env)), false);
      }
      case "un": {
        const v = this.eval(e.e, env);
        if (e.op === "-") return -num(v);
        return typeof v === "boolean" ? !v : ~roundHalfEven(num(v));
      }
      case "bin":
        return this.binary(e.op, this.eval(e.l, env), this.eval(e.r, env));
    }
  }

  private binary(op: string, l: Value, r: Value): Value {
    switch (op) {
      case "+":
        if (typeof l === "string" && typeof r === "string") return l + r;
        return num(l) + num(r);
      case "-":
        return num(l) - num(r);
      case "*":
        return num(l) * num(r);
      case "/": {
        const d = num(r);
        if (d === 0) this.fail("Division by zero");
        return num(l) / d;
      }
      case "\\": {
        const d = roundHalfEven(num(r));
        if (d === 0) this.fail("Division by zero");
        return Math.trunc(roundHalfEven(num(l)) / d);
      }
      case "mod": {
        const d = roundHalfEven(num(r));
        if (d === 0) this.fail("Division by zero");
        return roundHalfEven(num(l)) % d;
      }
      case "^":
        return Math.pow(num(l), num(r));
      case "&":
        return str(l) + str(r);
      case "=":
      case "<>":
      case "<":
      case ">":
      case "<=":
      case ">=":
        return this.compare(op, l, r);
      case "and":
      case "or":
      case "xor": {
        if (typeof l === "boolean" && typeof r === "boolean") {
          return op === "and" ? l && r : op === "or" ? l || r : l !== r;
        }
        const a = roundHalfEven(num(l));
        const b = roundHalfEven(num(r));
        return op === "and" ? a & b : op === "or" ? a | b : a ^ b;
      }
    }
    return this.fail(`Unknown operator ${op}`);
  }

  private callNamed(name: string, args: Value[], asStatement: boolean): Value {
    const lower = name.toLowerCase();
    const proc = this.program.procs[lower];
    if (proc) return this.callProc(proc, args);
    const b = BUILTINS[lower];
    if (b) return b(this, args);
    return this.fail(`${asStatement ? "Sub" : "Function"} not defined: ${name}`);
  }

  // used by builtins
  rnd(): number {
    return this.random();
  }
  showMessage(text: string, title?: string): void {
    const t = title ?? String(this.get(this.formName, "caption") ?? "");
    this.messages.push({ text, title: t });
    this.msgBoxHook?.(text, t);
  }
}

type Builtin = (rt: Runtime, a: Value[]) => Value;

const s = (a: Value[], i: number): string => str(a[i] ?? "");
const n = (a: Value[], i: number): number => num(a[i] ?? 0);

const BUILTINS: Record<string, Builtin> = {
  msgbox: (rt, a) => {
    rt.showMessage(s(a, 0), a[2] === undefined ? undefined : s(a, 2));
    return 1;
  },
  val: (_, a) => valParse(s(a, 0)),
  str: (_, a) => (n(a, 0) >= 0 ? " " : "") + formatNumber(n(a, 0)),
  cstr: (_, a) => s(a, 0),
  cint: (_, a) => roundHalfEven(n(a, 0)),
  clng: (_, a) => roundHalfEven(n(a, 0)),
  cdbl: (_, a) => n(a, 0),
  csng: (_, a) => n(a, 0),
  cbool: (_, a) => truthy(a[0] ?? 0),
  len: (_, a) => s(a, 0).length,
  mid: (_, a) => {
    const start = n(a, 1) - 1;
    if (start < 0) throw new VbRuntimeError("Invalid procedure call or argument");
    return a[2] === undefined ? s(a, 0).slice(start) : s(a, 0).substr(start, n(a, 2));
  },
  left: (_, a) => s(a, 0).slice(0, Math.max(0, n(a, 1))),
  right: (_, a) => {
    const k = Math.max(0, n(a, 1));
    return k === 0 ? "" : s(a, 0).slice(-k);
  },
  ucase: (_, a) => s(a, 0).toUpperCase(),
  lcase: (_, a) => s(a, 0).toLowerCase(),
  trim: (_, a) => s(a, 0).trim(),
  ltrim: (_, a) => s(a, 0).replace(/^\s+/, ""),
  rtrim: (_, a) => s(a, 0).replace(/\s+$/, ""),
  space: (_, a) => " ".repeat(Math.max(0, n(a, 0))),
  string: (_, a) => s(a, 1).charAt(0).repeat(Math.max(0, n(a, 0))),
  replace: (_, a) => (s(a, 1) === "" ? s(a, 0) : s(a, 0).split(s(a, 1)).join(s(a, 2))),
  instr: (_, a) => {
    if (typeof a[0] === "number" && a.length >= 3) return s(a, 1).indexOf(s(a, 2), a[0] - 1) + 1;
    return s(a, 0).indexOf(s(a, 1)) + 1;
  },
  chr: (_, a) => String.fromCharCode(n(a, 0)),
  asc: (_, a) => s(a, 0).charCodeAt(0) || 0,
  abs: (_, a) => Math.abs(n(a, 0)),
  int: (_, a) => Math.floor(n(a, 0)),
  fix: (_, a) => Math.trunc(n(a, 0)),
  sgn: (_, a) => Math.sign(n(a, 0)),
  sqr: (_, a) => {
    if (n(a, 0) < 0) throw new VbRuntimeError("Invalid procedure call or argument");
    return Math.sqrt(n(a, 0));
  },
  sin: (_, a) => Math.sin(n(a, 0)),
  cos: (_, a) => Math.cos(n(a, 0)),
  tan: (_, a) => Math.tan(n(a, 0)),
  atn: (_, a) => Math.atan(n(a, 0)),
  exp: (_, a) => Math.exp(n(a, 0)),
  log: (_, a) => {
    if (n(a, 0) <= 0) throw new VbRuntimeError("Invalid procedure call or argument");
    return Math.log(n(a, 0));
  },
  round: (_, a) => {
    const f = Math.pow(10, a[1] === undefined ? 0 : n(a, 1));
    return roundHalfEven(n(a, 0) * f) / f;
  },
  rnd: (rt) => rt.rnd(),
  randomize: () => 0,
  beep: () => 0,
  doevents: () => 0,
  isnumeric: (_, a) => tryNum(a[0] ?? "") !== null,
  timer: () => {
    const d = new Date();
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
  },
};

/** Evaluates a single VB expression. Handy for tests and the code panel. */
export function evalVbExpression(src: string, opts?: RuntimeOptions): Value {
  const rt = new Runtime(
    { form: { type: "Form", name: "F", props: {}, children: [] }, code: `Function f()\n f = ${src}\nEnd Function` },
    opts,
  );
  return rt.callFunction("f");
}
