# Requirements: FRM parser

## Introduction
Parse VB6 `.frm` text into a typed AST so the renderer and interpreter can raise the form.

## Requirements

### R1: Header and form block
**User story:** As a user, I drop a `.frm` file and the app understands its structure.
1. WHEN the text begins with `VERSION 5.00` or `VERSION 6.00` THEN the parser SHALL accept the header.
2. WHEN a `Begin VB.Form Name` block is present THEN the parser SHALL produce a root Form node.

### R2: Controls and nesting
1. WHEN a `Begin VB.<Type> Name` block appears THEN the parser SHALL create a control node with its properties.
2. WHEN blocks are nested (e.g. inside `VB.Frame`) THEN children SHALL appear in the parent's `children` array.
3. Supported types: Form, Label, TextBox, CommandButton, CheckBox, OptionButton, ListBox, Timer, Frame.

### R3: Properties
1. Properties SHALL be parsed as `Name = Value`; numbers become numbers, quoted strings are unescaped (`""` -> `"`), `True`/`-1` and `False`/`0` for booleans stay numeric/raw as written.
2. WHEN a value references a binary resource (`"X.frx":0000`) THEN the parser SHALL record a warning and skip the value.

### R4: Code section
1. Lines after the form's closing `End` SHALL be returned as `code`, with `Attribute` lines separated into `attributes`.

### R5: Errors
1. Unsupported control types SHALL be reported in `unsupported` and kept as generic nodes, not crash.
2. Malformed input (missing `End`, no form) SHALL return an error with a line number.
