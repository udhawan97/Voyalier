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
