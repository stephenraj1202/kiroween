import { useState } from "react";
import { parseFrm } from "../frm/parser";
import type { FrmNode, ParseResult } from "../frm/types";
import counterSample from "../../samples/counter.frm?raw";

function Tree({ node, depth = 0 }: { node: FrmNode; depth?: number }) {
  return (
    <ul style={{ marginLeft: depth ? 16 : 0 }}>
      <li>
        <strong>{node.type}</strong> {node.name}
        {node.children.map((c) => (
          <Tree key={c.name} node={c} depth={depth + 1} />
        ))}
      </li>
    </ul>
  );
}

export function App() {
  const [result, setResult] = useState<ParseResult | null>(null);

  const load = (text: string) => setResult(parseFrm(text));

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) load(await file.text());
  };

  return (
    <main className="crypt">
      <h1>Necro-Compiler</h1>
      <p className="tagline">Raise dead Visual Basic 6 forms from the grave.</p>
      <div
        className="dropzone"
        role="button"
        tabIndex={0}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        Drop a dead form here
      </div>
      <button type="button" onClick={() => load(counterSample)}>
        Try the sample
      </button>
      {result && !result.ok && (
        <p role="alert">
          This spirit cannot be raised (line {result.error.line}): {result.error.message}
        </p>
      )}
      {result && result.ok && (
        <section className="tree">
          <h2>{String(result.doc.form.props.Caption ?? result.doc.form.name)}</h2>
          <Tree node={result.doc.form} />
        </section>
      )}
    </main>
  );
}
