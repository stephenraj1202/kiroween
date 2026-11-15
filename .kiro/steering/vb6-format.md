# VB6 `.frm` format notes

```
VERSION 5.00
Begin VB.Form Form1
   Caption         =   "Hello"
   ClientHeight    =   3000
   ClientWidth     =   4000
   Begin VB.CommandButton Command1
      Caption         =   "Click me"
      Height          =   495
      Left            =   600
      Top             =   600
      Width           =   1215
   End
End
Attribute VB_Name = "Form1"
Private Sub Command1_Click()
   MsgBox "Hi"
End Sub
```

- Positions and sizes are in **twips** (15 twips = 1 pixel at 96 DPI).
- Properties are `Name = Value`; strings are double-quoted (`""` escapes a quote).
- Controls nest via `Begin VB.X Name` ... `End`. Frames contain children.
- Binary values look like `"Form1.frx":0000`; treat them as unsupported (warn, do not crash).
- Code section starts after the closing `End` of the form; `Attribute` lines are metadata.
- Event handlers are named `ControlName_Event`.
