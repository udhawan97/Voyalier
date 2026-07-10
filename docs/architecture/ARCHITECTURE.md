# Architecture

## Selected system shape

Voyalier uses a React/Vite interface, a framework-independent Rust domain core, an Axum loopback API for local web mode, and a thin Tauri 2 desktop shell.

```text
React UI
  ├─ browser → Axum loopback API
  └─ desktop → Tauri shell → in-process Axum API
                         ↓
                   voyalier-core
          ┌──────────────┼──────────────┐
       evidence       planner        providers
    SQLite/FTS5    rules/validator   travel/AI/risk
```

## Stable interfaces

The core will define replaceable interfaces for `AiProvider`, `TravelInventoryProvider`, `PlaceSource`, `RiskSource`, `VisaSource`, `DocumentParser`, `Retriever`, `Storage`, and `ReportRenderer`.

## Data boundary

All persistent user state lives outside the application bundle in an OS-appropriate application-data directory. Releases must never overwrite user data. Database encryption, attachment encryption, key rotation, migrations, backup, and deletion need fixture-backed tests before public beta.

## Retrieval

FTS5 is the baseline. Semantic embeddings are an optional local pack and operate on a trip-sized corpus. The evidence record retains provenance independently of any vector index.

## Current limitations

The scaffold uses a fixed loopback port and does not yet authenticate the local API session. Random port selection, a per-launch token, strict origin checks, and graceful collision handling are public-beta gates.
