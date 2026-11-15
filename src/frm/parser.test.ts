import { describe, expect, it } from "vitest";
import counter from "../../samples/counter.frm?raw";
import { parseFrm } from "./parser";

describe("parseFrm", () => {
  it("parses the counter sample", () => {
    const r = parseFrm(counter);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.version).toBe("5.00");
    expect(r.doc.form.name).toBe("Form1");
    expect(r.doc.form.props.Caption).toBe("Crypt Counter");
    expect(r.doc.form.children.map((c) => c.name)).toEqual(["cmdAdd", "cmdReset", "lblCount"]);
    expect(r.doc.form.children[0].props.Width).toBe(1455);
    expect(r.doc.attributes.VB_Name).toBe("Form1");
    expect(r.doc.code).toContain("Private Sub cmdAdd_Click()");
    expect(r.doc.code).not.toContain("Attribute");
    expect(r.doc.unsupported).toEqual([]);
  });

  it("nests children inside a Frame and unescapes quotes", () => {
    const r = parseFrm(`VERSION 5.00
Begin VB.Form F
   Begin VB.Frame fra
      Caption = "Say ""boo"""
      Begin VB.CheckBox chk
         Caption = "ok"
      End
   End
End`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const fra = r.doc.form.children[0];
    expect(fra.props.Caption).toBe('Say "boo"');
    expect(fra.children[0].name).toBe("chk");
  });

  it("warns on binary resources and reports unsupported controls", () => {
    const r = parseFrm(`VERSION 5.00
Begin VB.Form F
   Icon = "F.frx":0000
   Begin VB.PictureBox pic
      Caption = "x"
   End
End`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.warnings.length).toBe(1);
    expect(r.doc.unsupported).toEqual(["PictureBox pic"]);
    expect(r.doc.form.props.Icon).toBeUndefined();
  });

  it("strips trailing VB comments from values", () => {
    const r = parseFrm(`VERSION 5.00
Begin VB.Form F
   Visible = 0 'False
   Caption = "Hi" 'comment
   Enabled = -1  'True
End`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.form.props).toEqual({ Visible: 0, Caption: "Hi", Enabled: -1 });
  });

  it("fails with a line number on a missing header", () => {
    const r = parseFrm("Begin VB.Form F\nEnd");
    expect(r).toEqual({ ok: false, error: { message: expect.any(String), line: 1 } });
  });

  it("fails when End is missing", () => {
    const r = parseFrm("VERSION 5.00\nBegin VB.Form F\n   Caption = \"x\"\n");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.line).toBe(2);
  });

  it("fails on a malformed line", () => {
    const r = parseFrm("VERSION 5.00\nBegin VB.Form F\n   garbage here\nEnd");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.line).toBe(3);
  });
});
