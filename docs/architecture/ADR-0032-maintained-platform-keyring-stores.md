# ADR-0032: Maintained platform keyring stores

## Context

The keyring 3 package retains its optional asynchronous Secret Service dependency in Cargo's lock graph, even though Voyalier selects the synchronous D-Bus backend. That dependency retains the unmaintained standalone zbus_names, zvariant and zvariant_derive packages. The keyring 4 convenience package still selects the asynchronous backend, so merely changing its major version does not remove this ownership path.

## Decision

Use the maintained keyring-core API with explicitly selected stores: apple-native-keyring-store's Keychain Services backend on macOS, windows-native-keyring-store on Windows, and dbus-secret-service-keyring-store with Rust cryptography on other supported Unix systems. Construct the selected production store at the existing entry boundary, so a transient initialization failure can be retried by the next operation. A failed initialization must remain an ordinary storage failure; it must not silently select an in-memory credential store. Tests continue to select the existing MemorySecretStore.

Keep `com.voyalier.keys`, all database-derived account names, the default login keychain, Windows target naming and Linux Secret Service service/user attributes unchanged. No credential enumeration, account migration, database migration, wire-contract change or encryption-format change is introduced. Native acceptance must verify that the installed replacement opens a fictional workspace encrypted by the previous keyring backend, and must exercise staged restore and restart through the real keychain.

The store packages retain the keyring project's MIT/Apache-2.0 licensing. They use OS-local credential services and add no hosted service or remote AI/network path. Offline builds require the locked registry sources to be cached, as before. The application-layer Rust minimum becomes 1.88, required by the synchronous Secret Service store; core retains the workspace's 1.85 declaration and desktop retains 1.90. Replacement cost is confined to the existing SecretStore adapter and its platform dependencies.

## Verification

Run the canonical full gate, Cargo audit and all required hosted checks including Linux and Windows. Bind installed artifact checksums and native observations to the same accepted source. Verify task-only keychain entries, encrypted stored fields, previous-backend compatibility, explicit restore staging and restart/apply. Never use audit ignores or disable a supported platform to clear a warning. Tauri's GTK3 dependency constraints remain a separately documented upstream issue unless a separately reviewed compatible repair is available.
