# ADR-0002: Direct Tauri IPC for desktop transport

- Status: Accepted
- Date: 2026-07-10

## Context

The foundation desktop shell starts a fixed-port Axum listener and has the webview call it over loopback HTTP. That unnecessarily exposes an in-process desktop service to other local processes and web origins, and it makes port ownership part of desktop startup reliability.

Voyalier still needs Axum for browser development, while the desktop release needs a narrow, testable bridge to the same application services.

## Decision

The desktop application will call application services through direct Tauri IPC. Desktop release builds will start zero TCP listeners. Axum remains a development-only browser surface outside the desktop crate.

Every Tauri command will use its snake_case contract name and take exactly one argument named `input`, including commands whose input is an empty object. This keeps invocation shapes uniform and prevents parameter-name drift between TypeScript and Rust.

The integration will temporarily set `app.withGlobalTauri` to `true` so the existing web package can invoke the command bridge without adding package dependencies during the contract freeze.

## Consequences

- The desktop shell stays thin and contains only one-line mappings to application services.
- `AppError` is the serialized Tauri command error payload, matching the HTTP error body.
- Desktop command names and the single `input` key require round-trip tests with `tauri::test::mock_builder`.
- CSP does not need a loopback `connect-src` exception for the desktop product.
- Browser development can continue to use the versioned Axum API.

## Post-integration task

Adopt `@tauri-apps/api` in the web package and then disable `app.withGlobalTauri`. This is intentionally deferred until the UI integration owner can update package metadata and the lockfile atomically.

## Documented fallback

If `tauri::test` coverage proves inadequate for reliable command-contract testing, use a secured loopback transport with all of these controls: an OS-assigned port, a cryptographically random per-launch token, and strict Host and Origin validation. The fixed port and unauthenticated listener must not return.
