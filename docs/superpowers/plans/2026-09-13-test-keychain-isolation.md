# Test keychain isolation

## Problem

A stale `voyalier-app` unit-test process remained blocked for hours behind a macOS Keychain authorization dialog for `com.voyalier.keys`. The current concierge tests inject `MemorySecretStore` and pass cleanly, but `AppService::open_path` and `AppService::open_path_with_fetcher` still select `KeyringSecretStore` when the library is compiled by its unit-test harness. A future test that uses either convenience constructor can therefore reach the developer's real keychain and stall unattended checks.

## Change

1. Add a private default-secret-store selector in `voyalier-app`.
2. Compile the selector to `MemorySecretStore` for the crate's unit-test build and to `KeyringSecretStore` for every non-test build.
3. Route `open_path_with_fetcher` through that selector.
4. Add a focused regression test proving the unit-test default is non-persistent and that the convenience constructor can open a disposable workspace without the OS keychain.

This is a compile-time test boundary. It adds no environment flag and cannot disable the production keychain at runtime.

## Verification

- Run the focused regression test and all `voyalier-app` tests.
- Run the exact concierge test chain that previously stalled.
- Run `make check`, refresh Graphify, and query the updated constructor path.
- Confirm no Voyalier test process remains after the checks finish.
