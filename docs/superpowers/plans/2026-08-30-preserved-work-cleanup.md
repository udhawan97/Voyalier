# 2026-08-30 — Integrate preserved work before the next phase

Base: `7f8fbae`. Integration branch:
`stay-calm-its-codex/main-cleanup-20260830`.

## Goal

Complete the repository-wide cleanup before selecting another product phase.
Preserve every user-owned dirty worktree while recovering only the changes that
remain unique, relevant, and compatible with current `main`.

## Inventory decisions

- `friendly-wizard-claude/hopeful-darwin-64fdcc`: integrate the reserved
  ADR-0018 `vault/unreadable` contract through core, app, transports, and web.
- `friendly-wizard-claude/amazing-zhukovsky-e98240`: integrate the stronger
  Visa Missions and Visa Stats heading-order coverage.
- `friendly-wizard-claude/sad-wilbur-595eb6`: integrate the unique Public
  Holidays school-term heading fix. Its Visa scan is superseded by the broader
  `amazing-zhukovsky` case.
- `friendly-wizard-claude/recursing-jennings-6c02d7`: classify by current-tree
  evidence; its timeout, repeated-control naming, and changelog behavior are
  already present on `main`.
- Preserve every dirty worktree and every open pull-request head. Delete refs
  only after their tips are proven reachable or patch-equivalent and the
  integrated result is on `origin/main`.

## Implementation order

1. Keep the rescued ADR and original vault implementation plan intact.
2. Drive the remaining vault app and web behavior through focused failing
   tests, then implement the smallest changes at the documented seams.
3. Drive the three heading corrections through rendered axe scans before
   changing the heading levels.
4. Add concise Unreleased notes for the two user-visible corrections.
5. Run the complete repository gate, production dependency audit, credential
   scan, Cargo metadata check, and refreshed Graphify query.
6. Review the resulting diff, run the required two-round council, fast-forward
   `main`, push it, and verify the exact hosted SHA before pruning safe refs.

## Boundaries

- Do not edit, clean, reset, or remove any dirty user worktree.
- Do not merge open Dependabot pull-request branches as cleanup.
- Do not tag, publish a release, or trigger a manual deployment.
- `vault/unreadable` identifies an unreadable encrypted value; it does not
  guess whether the cause was a replaced key or tampering and adds no recovery
  mechanism.
