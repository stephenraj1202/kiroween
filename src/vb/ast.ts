export type Expr =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "var"; name: string }
  | { k: "member"; obj: string; prop: string; args: Expr[] }
  | { k: "call"; name: string; args: Expr[] }
  | { k: "un"; op: "-" | "not"; e: Expr }
  | { k: "bin"; op: string; l: Expr; r: Expr };

export type CaseTest =
  | { k: "eq"; e: Expr }
  | { k: "range"; lo: Expr; hi: Expr }
  | { k: "is"; op: string; e: Expr };

export type StmtBody =
  | { k: "assign"; target: Expr; value: Expr }
  | { k: "call"; name: string; args: Expr[] }
  | { k: "mcall"; obj: string; method: string; args: Expr[] }
  | { k: "dim"; names: { name: string; type: string }[] }
  | { k: "const"; name: string; value: Expr }
  | { k: "if"; branches: { cond: Expr; body: Stmt[] }[]; else: Stmt[] }
  | { k: "for"; v: string; from: Expr; to: Expr; step?: Expr; body: Stmt[] }
  | { k: "do"; cond?: Expr; until: boolean; post: boolean; body: Stmt[] }
  | { k: "select"; subject: Expr; cases: { tests: CaseTest[] | null; body: Stmt[] }[] }
  | { k: "exit"; what: "sub" | "function" | "for" | "do" };

export type Stmt = StmtBody & { line: number };

export interface Proc {
  name: string;
  kind: "sub" | "function";
  params: string[];
  returnType: string;
  body: Stmt[];
  line: number;
}

export interface VbError {
  line: number;
  message: string;
}

export interface VbProgram {
  globals: { name: string; type: string }[];
  init: Stmt[];
  /** Keyed by lower-case name. */
  procs: Record<string, Proc>;
  errors: VbError[];
}
