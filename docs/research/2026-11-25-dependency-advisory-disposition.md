# Dependency advisory disposition

Date: 2026-11-25 (America/Chicago). This is the implementation follow-up to the [dependency and SBOM assessment](2026-11-25-dependency-and-sbom-gates.md).

The production JavaScript audit at low severity returned zero advisories. The RustSec audit returned zero vulnerabilities and six informational warnings. Both reports were generated on the locks below. RustSec used its fresh database revision `b9b8a3c2cb1f2a3c76ab17a551193568c9f8b7a4`. Follow-up scans can report different results when the advisory feeds change.

| Input          | SHA-256                                                            |
| -------------- | ------------------------------------------------------------------ |
| Cargo.lock     | `ff24e49528a46f61b9e51be8d04a6a434603ab199b426cf1dfc5d0cda2d25099` |
| pnpm-lock.yaml | `535f37063224aa49cb8398533e7cd647d85566a623e8baf6a63bc4ed155e7d53` |

## Patched resolutions

- Bundled SQLite is 3.54.1, verified from the amalgamation in `libsqlite3-sys 0.39.1`, through `rusqlite 0.41.1`. The bundled feature stays enabled. Database, migration and backup formats are preserved. The core, app and server crates now declare Rust 1.89 in line with the locked rusqlite and uuid requirements. Desktop continues to declare Rust 1.90. The checked toolchain was stable Rust 1.97. [SQLite advisory](https://rustsec.org/advisories/RUSTSEC-2026-0459.html)
- `cookie 0.18.3`, `url 2.5.9` and `rustix 1.1.6` remove their respective advisory matches. [cookie](https://rustsec.org/advisories/RUSTSEC-2026-0594.html) · [url](https://rustsec.org/advisories/RUSTSEC-2026-0592.html) · [rustix](https://rustsec.org/advisories/RUSTSEC-2026-0486.html)
- The temporary Git source for the updater was replaced by the published `tauri-plugin-updater 2.14.1`. Its Rust sources match the pinned subtree, with zip 9 retained for Windows. [ADR-0031 amendment](../architecture/ADR-0031-updater-security-source-pin.md#amendment-2026-11-25)
- Astro resolves to 7.4.7 in the static docs site. Its direct Rolldown dependency resolves to 1.2.16, the lowest version Astro 7.4.7 declares compatible. This keeps the web Vite toolchain's own Rolldown version and avoids a beta WASM peer selected via newer Astro build tooling. [Astro release](https://github.com/withastro/astro/releases/tag/astro%407.4.7) · [Dynamic tag advisory](https://github.com/advisories/GHSA-mh32-jxcr-mh9f) · [Image endpoint advisory](https://github.com/advisories/GHSA-r3h5-4585-7x3w)

## Retained informational warnings

These warnings remain visible in the audit. The version and path assessment used Cargo.lock and offline, locked normal and build dependency trees for Apple Silicon macOS, x64 Windows and x64 Linux. The supported shipped desktop artifacts are macOS and Windows. The Linux target remains part of source CI.

| RustSec warning                                                                                                   | Path and disposition                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [RUSTSEC-2026-0543](https://rustsec.org/advisories/RUSTSEC-2026-0543.html), unmaintained `chrono 0.4.45`          | Lockfile option of `serde_with`. No active normal/build path in the three inspected target trees. Recheck if its feature gets enabled.                                                                                                                                                         |
| [RUSTSEC-2026-0371](https://rustsec.org/advisories/RUSTSEC-2026-0371.html), unmaintained `zbus_names 3.0.0`       | Optional locked `keyring → secret-service → zbus` path. The configured Linux credential backend in the active tree is synchronous `dbus-secret-service`, with no active path to this crate on any of the three targets. Track an upstream keyring refresh before changing credential backends. |
| [RUSTSEC-2026-0370](https://rustsec.org/advisories/RUSTSEC-2026-0370.html), unmaintained `zvariant 4.2.0`         | Optional locked `zbus → zvariant` path. The same synchronous credential selection leaves it inactive.                                                                                                                                                                                          |
| [RUSTSEC-2026-0372](https://rustsec.org/advisories/RUSTSEC-2026-0372.html), unmaintained `zvariant_derive 4.2.0`  | Optional locked `zvariant → zvariant_derive` path. No active build or runtime path in inspected targets.                                                                                                                                                                                       |
| [RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html), unmaintained `proc-macro-error 1.0.4` | Linux desktop build dependency through GTK/GLib macros. Migrate with the upstream Tauri/Wry GTK stack instead of overriding a proc-macro API.                                                                                                                                                  |
| [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html), unsound `glib 0.18.5`                 | Linux desktop dependency through Tauri/Wry, GTK and WebKitGTK. Fixed in GLib 0.20, outside the current GTK 0.18 cohort. Voyalier does not call the affected iterator APIs directly. A patched Linux desktop stack is still needed before shipping a Linux desktop artifact.                    |

Cargo audit checks every package in the lockfile, including inactive options. The surface assessment neither ignores entries nor establishes exhaustive transitive unreachability. Reevaluate target trees and upstream changes on each release. Installed recovery and artifact inventories are separate gates.
