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

## Amendment: the source browser has a protected launch channel

Accepted 2026-09-01. This amendment applies only to the supported browser-from-source workflow. It
does not move the packaged desktop application away from direct Tauri IPC.

The source launcher binds Axum to an OS-assigned loopback port and gives it a cryptographically
random bearer for that launch. The bearer travels from the launcher to Axum through an inherited
anonymous pipe, while Axum returns only its assigned address through a separate anonymous pipe. The
bearer must not appear in a command argument, process environment, file, URL, log, response body,
browser storage, cookie, or screenshot.

This protected launcher is supported on Unix hosts (macOS and Linux); Windows source launch is not
supported and must use the packaged Tauri app. The launcher opens the repository's managed,
disposable Chromium session and injects the address
and bearer into that exact loopback document before application code runs. The HTTP gateway consumes
and removes the non-enumerable bootstrap value, then retains it only in its request closure. The
injection is origin-scoped and is not repeated for a document that navigates elsewhere. A manually
opened arbitrary browser is not an equivalent supported route: ordinary loopback HTTP has no secure
way to deliver a secret to that browser while excluding an arbitrary process running as the same
user.

Vite serves the interface but does not proxy `/api`. Browser calls go directly to the random Axum
origin with the bearer, so an unauthenticated Vite request cannot inherit server authority. Axum
requires the bearer for reads and mutations in addition to the existing loopback bind, `Host`,
`Origin`, and CORS controls. Missing and incorrect credentials fail closed.

The source document also receives its own response CSP. A per-launch nonce admits Vite's injected
development scripts without admitting arbitrary inline script; development HMR, MapLibre workers,
and the named tile source receive only their required directives. `object-src`, `base-uri`, frames,
and forms remain denied. This browser policy is separate from, and must not weaken or rewrite, the
Tauri CSP.

Consequences of the amendment:

- `make dev` owns the server, Vite, and managed-browser lifetimes as one launch; closing or
  interrupting it removes the disposable browser context and invalidates the bearer.
- Integration fixtures may use a conspicuously synthetic credential, but production source startup
  has no environment-variable credential fallback.
- The random port is availability hygiene, not authentication. The bearer and protected bootstrap
  channel are the authorization boundary.
- Direct Tauri IPC, command parity, and the desktop zero-listener guarantee remain unchanged.

## Post-integration task

Adopt `@tauri-apps/api` in the web package and then disable `app.withGlobalTauri`. This is intentionally deferred until the UI integration owner can update package metadata and the lockfile atomically.

## Documented fallback

If `tauri::test` coverage proves inadequate for reliable command-contract testing, use a secured loopback transport with all of these controls: an OS-assigned port, a cryptographically random per-launch token, and strict Host and Origin validation. The fixed port and unauthenticated listener must not return.
