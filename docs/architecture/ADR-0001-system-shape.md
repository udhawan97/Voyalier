# ADR-0001: Shared Rust core with web and Tauri shells

- Status: Accepted for foundation
- Date: 2026-07-09

## Decision

Use React/Vite for the interface, Rust for the shared domain and local service, Axum for browser mode, and Tauri 2 for desktop distribution.

## Rationale

This keeps the base application compact, fast, and independently distributable without Node or Python installed. It also provides a clear desktop security boundary and a single deterministic core.

## Consequences

Advanced OCR and document understanding may require an optional Docling-based pack. The first feasibility gate must compare its size, cold start, licensing, and packaging against lighter native extraction.

FastAPI plus pywebview remains the fallback if the Rust document pipeline or Tauri release matrix fails measured product requirements.

## Amendment — future workspaces require a compatible app (2026-10-21)

Ordinary startup refuses a SQLite `user_version` above the current append-only
migration target. It checks the existing database through a read-only connection
under workspace custody before recovery, migrations, or credential changes.
Connection initialization repeats the check before WAL configuration or schema
creation. The refusal tells the traveler to update Voyalier; it preserves the
database, pending generation evidence, and credentials rather than attempting a
downgrade. New databases and supported legacy schemas retain their existing path.

A synthetic current-shaped database stamped one version ahead previously opened
and accepted a note write. That establishes missing compatibility refusal, not
corruption under an actual future schema. Verify refusal and unchanged evidence
with and without a staged restore, plus existing migrations and restore checks.
