# Hero punctuation fix plan

Date: 2026-07-20
Status: approved

## Defect

The homepage hero ends “Folded into focus.” with both a semantic period in the heading text and a coral circular `::after` decoration. At narrow widths the decoration separates from the punctuation and reads as a second, stray dot.

## Fix

- Keep the semantic period in the heading text.
- Remove only the redundant `span::after` decoration.
- Preserve the indigo headline treatment, layout, responsive behavior, and accessibility tree.

## Verification

- Re-run the browser assertion that detects a terminal period plus a generated circular pseudo-element and prove the duplicate is gone.
- Inspect the hero at the reported 720 × 854 viewport in dark mode.
- Run the docs build, repository gate, and `git diff --check` before pushing `main`.
