# Dependency and SBOM release gates

Date: 2026-11-25 America/Chicago (audit artifacts recorded 2026-11-26 UTC).
Status: research and gate assessment only. No dependency, feature, lockfile,
advisory-ignore, framework or release-policy change is selected by this note.

## Result and evidence identity

The newly authorized audit reports **three Rust vulnerability entries** and
**two Astro entries (one low, one moderate)**. These dependencies predate the
selected updater/localization work: the inspected `Cargo.toml`, `Cargo.lock`,
`pnpm-lock.yaml` and docs package manifest are unchanged from `ab278527` through
web commit `4d50288`. They are current gate findings, not regressions introduced
by that web repair. A scanner match establishes an affected resolved version;
it does not establish a reachable exploit in this application.

The senior supplied the fresh private scanner outputs. This worker read those
outputs, the checked-out official RustSec advisory files, application/manifests,
and cached dependency source; it ran only offline Cargo dependency-tree queries.
No vulnerable input, native binary, production credential or user database was
executed. The following hashes make the evidence distinguishable from historical
October/November scans:

| Evidence              | Identity                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| RustSec database      | `b9b8a3c2cb1f2a3c76ab17a551193568c9f8b7a4`, commit time `2026-11-25T12:10:30+01:00`                         |
| `rust-audit.json`     | SHA-256 `a668373beefc7e3e829f28f3d3ed85c255d3f1bd1f8f6a6d1baa088d4988eb5f`; recorded `2026-11-26T03:13:54Z` |
| `pnpm-audit-all.json` | SHA-256 `bca9af240ecab3ab6a192e5e1134bd99b463cdfc1c46c27fd1dee5321fb9e53f`; recorded `2026-11-26T03:14:27Z` |
| `Cargo.lock`          | SHA-256 `3ba73944f49912b203c8f07a5f495de52bd65fce6b25313598299687de6602fe`                                  |
| `pnpm-lock.yaml`      | SHA-256 `b4b468e7e70d5235d9b7fd9a085da1060cd07c24ccd3bdb0e56633b7e7043596`                                  |

Recorded times above are artifact filesystem times, not registry/database
freshness guarantees. The Rust JSON itself reports null database update/commit
fields; the independent checked-out database identity supplies that missing
provenance. Preserve the senior's command/tool receipts beside these private
outputs. No private local paths are needed in a published report.

## Rust findings and bounded reachability

| Advisory / resolved version                                                                                                   | Upstream patched range                                                                  | Application evidence and limit                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [RUSTSEC-2026-0459](https://rustsec.org/advisories/RUSTSEC-2026-0459.html), `libsqlite3-sys 0.38.2` through `rusqlite 0.40.2` | `libsqlite3-sys >=0.39.0`; advisory identifies `rusqlite 0.41` and SQLite 3.54.0/3.54.1 | Root Cargo manifest explicitly enables `rusqlite/bundled`; offline feature tree confirms `voyalier-app -> rusqlite/bundled -> libsqlite3-sys/bundled`. AppService opens workspace database files and uses WAL. The vulnerable SQLite implementation is selected. No crafted database/WAL exploit was attempted.                                                                                                        |
| [RUSTSEC-2026-0594](https://rustsec.org/advisories/RUSTSEC-2026-0594.html), `cookie 0.18.1`                                   | `>=0.18.3`                                                                              | Comes through Tauri/runtime/Wry, not a direct application cookie-authentication dependency. Both host macOS and Windows-target feature trees show only cookie's default feature. Cached cookie source makes `private`/`secure` opt-in; the affected `PrivateJar` encryption routines are not enabled in these inspected resolutions. This bounds current reachability, but the lockfile audit still flags the version. |
| [RUSTSEC-2026-0592](https://rustsec.org/advisories/RUSTSEC-2026-0592.html), `url 2.5.8`                                       | `>=2.5.9`                                                                               | Direct core/app dependency and transitive Tauri/Wry/reqwest dependency. The advisory concerns `Url::origin()`/`url::quirks::origin()` on deeply nested blob URLs, not parsing every ordinary URL. First-party Rust search found parse/file-path construction but no call to those origin methods. This is not a complete dependency or native webview reachability proof.                                              |

The SQLite advisory needs a database and sibling WAL whose page sizes differ,
written by a less trusted party and opened by the victim. Workspace opening in
[`open_path_with_deps`](../../crates/voyalier-app/src/lib.rs) reaches SQLite;
filesystem custody and authenticated portable backups do not establish that the
bundled parser is patched. Conversely, this observation does not prove that an
ordinary imported travel document can supply a database/WAL pair. The
[`backup_recovery::readonly`](../../crates/voyalier-app/src/backup_recovery.rs)
helper uses a bounded header-checked immutable SQLite URI for local snapshots;
do not generalize that narrower path to every live database open.

The cookie advisory additionally requires Unix fork-without-exec, pre-fork RNG
state and private cookies generated on the forking thread with a shared key in
multiple processes. Its upstream description excludes Windows. No first-party
PrivateJar or fork call was found. Do not enable private-cookie features or add
forking deployment to reproduce an irrelevant application path; prefer a patched
compatible resolution and retain the feature-tree evidence.

The app's [`validate_resource_destination`](../../crates/voyalier-app/src/network_policy.rs)
accepts only HTTP/HTTPS and rejects credential-bearing/private destinations before
resource fetch. That source check narrows one URL entry point; it is not a claim
that all Tauri, updater or dependency URL paths are safe. Keep a current patch
review even where no direct call was found.

The same Rust audit also reports seven informational entries: five unmaintained
(`chrono`, `proc-macro-error`, `zbus_names`, `zvariant`, `zvariant_derive`) and two
unsound (`glib`, `rustix`). They require individual platform/usage dispositions;
this note does not silently accept or suppress them.

## Astro findings and shipped surface

The registry audit resolves `astro 7.4.1` through the docs site's direct Astro and
Starlight/MDX/expressive-code paths:

- [GHSA-mh32-jxcr-mh9f](https://github.com/advisories/GHSA-mh32-jxcr-mh9f): dynamic-tag attribute-injection XSS, low; reported affected `<=7.4.4`, patched `>=7.4.5`.
- [GHSA-r3h5-4585-7x3w](https://github.com/advisories/GHSA-r3h5-4585-7x3w): Node image-endpoint case-variant sibling-directory file read, moderate; reported affected `>=5.14.3 <=7.4.6`, patched `>=7.4.7`.

These versions/ranges/severities come from the fresh registry receipt; this worker
has not independently tested either exploit or fetched a patched package.
[`docs-site/astro.config.mjs`](../../docs-site/astro.config.mjs) has no server output
or adapter configured. The package manifest has no `@astrojs/node` adapter, and
[the docs workflow](../../.github/workflows/docs.yml) uploads the generated
`docs-site/dist` artifact to GitHub Pages. That configured public surface is
static; this is evidence against a deployed Node image-endpoint path, not proof
about an uninspected deployment. First-party docs source search found no dynamic
`<{...}>` tag or request-derived Astro server input. Starlight/integration internals
and arbitrary contributor-controlled build content were not exhaustively audited.

The security workflow's `pnpm audit --prod --audit-level high` threshold can pass
with these low/moderate entries. Report the entries and their scoped assessment;
do not translate that threshold pass into “zero vulnerabilities.” A compatible
Astro resolution at least 7.4.7 addresses both reported ranges, subject to reviewed
lockfile changes, integration peer constraints and a successful static docs build.

## Remediation selection and verification

Running fresh audits and recording these findings discharges part of S4's
investigation, not its pass condition. The selected updater/localization fixes
remain independently useful. The newly identified pre-existing dependency repairs
need an explicit bounded selection before edits in this execution; no blanket
ignore, feature weakening, storage redesign or public deployment follows from
this research task.

Recommended next selection:

1. Review targeted `cookie >=0.18.3` and `url >=2.5.9` lockfile updates, retaining
   existing features and the reviewed updater source pin. Check all supported
   target resolutions rather than applying an unconstrained dependency refresh.
2. Review `rusqlite 0.41` with patched bundled SQLite as a separate compatibility
   change. Current `rusqlite = "0.40"` cannot admit it as a lockfile-only update.
   Upstream declares Rust 1.89 for rusqlite and 1.88 for libsqlite3-sys; workspace
   crates currently declare 1.85, while desktop declares 1.90. Resolve and document
   the supported compiler contract before editing. Preserve WAL, append-only
   migrations, snapshot authentication and Windows recovery semantics.
3. Review the compatible Astro patch resolution, retaining the existing static
   architecture and dependency integrations. Never introduce a server adapter to
   fix a static site's audit finding.
4. Re-run fresh audits with tool/database identities and no new ignores. Run the
   repository's web, Rust, desktop and integration stages, locked metadata,
   credential scan, snapshot/migration/restore tests and both platform native
   upgrade/recovery acceptance. Feature/source evidence cannot replace those gates.

The offline all-target feature query initially could not resolve an uncached
`webpki-root-certs 1.0.10`; it performed no download. Narrowed host/workspace queries
and an explicit Windows cookie query succeeded. No all-target completeness claim
is made. This worker did not compile native code or alter dependency files.

## SBOM and license gate

[RELEASE_CHECKLIST](../release/RELEASE_CHECKLIST.md) requires secrets, SBOM,
dependency, license and provenance checks, while
[THREAT_MODEL](../security/THREAT_MODEL.md) explicitly defers SBOM. Inspected
release/security/check scripts generate checksums and provenance but no SBOM.
Lockfiles and a successful build are inputs to an inventory, not evidence that this
required SBOM/license review passed. The inconsistency remains a release gate.

Select either a documented scoped release exception from the owner, or a bounded
inventory implementation with these acceptance criteria:

- Record the exact commit, target, feature selection, tool/version and both lock
  hashes. Produce a standard SPDX or CycloneDX document with dependency versions,
  sources/checksums and dependency relationships; pin the generator before use.
- Distinguish shipped Rust/frontend components from build-only documentation and
  tooling dependencies. Preserve immutable Git revision identity for the updater
  pin; identify native bundled libraries such as SQLite instead of treating only
  Rust wrapper crates as the complete artifact.
- Record bundled data/pack license and attribution obligations separately where
  the package inventory cannot express them. An SPDX identifier alone is not
  proof that notices or redistribution obligations are satisfied.
- Validate output schema, coverage and determinism against exact lockfiles and
  built artifacts; manually disposition unknown licenses and scan warnings.
  Keep verification in `scripts/check.sh` so local/CI behavior agrees.
- Attach only reviewed inventory to a separately authorized release. Never include
  provider keys, private paths, user workspaces or signing secrets. Do not upload
  source or dependency inventories to a hosted service implicitly.

No generator was installed, SBOM created, license exception accepted or artifact
published here. Production remains Hold until the applicable security,
inventory/license, native and artifact gates have concrete final-candidate evidence.
