# Architecture

## Selected system shape

Voyalier uses a React/Vite interface, a framework-independent Rust domain core, a SQLite-backed Rust application-service crate, an Axum loopback API for local web mode, and a thin Tauri 2 desktop shell.

```text
React UI
  ├─ browser → Axum loopback API ┐
  └─ desktop → direct Tauri IPC  ├─ voyalier-app → SQLite
                                 ↓
                           voyalier-core
                 ┌──────────────┼──────────────┐
              evidence       parsers        rules
            source spans   local-only    validation
```

## Stable interfaces

The frozen Phase 0 TypeScript contract is the app boundary. Rust wire structs use camelCase JSON and `AppError` is shared across HTTP bodies and Tauri command errors.

The core will define replaceable interfaces for `AiProvider`, `TravelInventoryProvider`, `PlaceSource`, `RiskSource`, `VisaSource`, `DocumentParser`, `Retriever`, `Storage`, and `ReportRenderer`.

## Data boundary

All persistent user state lives outside the application bundle in an OS-appropriate application-data directory. Releases must never overwrite user data. Database encryption, attachment encryption, key rotation, migrations, backup, and deletion need fixture-backed tests before public beta.

## Retrieval

Phase 1 stores source documents in SQLite but never returns raw document content through API surfaces. Parser output keeps field spans and excerpts so extracted facts remain reviewable.

FTS5 is deferred. Semantic embeddings are an optional local pack and operate on a trip-sized corpus. The evidence record retains provenance independently of any vector index.

## Current limitations

The Axum server still binds `127.0.0.1:8787` for browser development. It validates Host and Origin and allows Vite origins only. Desktop release builds use direct Tauri IPC and start no TCP listener.

The secured-loopback fallback remains a documented contingency only if Tauri command testing becomes inadequate.
