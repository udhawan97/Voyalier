# Download & install docs — design

Date: 2026-07-16
Status: approved (owner), ready for an implementation plan

## Why now

`v0.4.3` is published with real assets — `Voyalier_0.4.3_aarch64.dmg`,
`Voyalier_0.4.3_x64_en-US.msi`, `Voyalier_0.4.3_x64-setup.exe`, their `.sig`
files, per-platform `SHA256SUMS-*.txt`, and a `latest.json` that resolves at
`releases/latest/download/latest.json`.

Until this release, the docs deliberately did not point at a download, because
no release carried artifacts (the publish-order rule: never point at a missing
download). That constraint is now lifted, and the docs are the last thing still
describing Voyalier as unavailable.

Every user-facing surface still says the opposite of what is true:

- `README.md` carries a `status-source--only_beta` badge and a NOTE calling the
  project a "source-only beta"; its release badge is hardcoded to `v0.4.1`, two
  releases stale.
- `README.md` `## Run it` opens with "There is no polished installer yet."
- The website's primary hero button is **Start from source**.
- `getting-started.mdx` documents `git clone` as step one.
- No install page exists anywhere.

## What ships

Docs and website only. No app code, no contract change, no Rust.

### 1. New page — `docs-site/src/content/docs/download.mdx`

The page presents **three ways to run Voyalier**, all first-class:

| Way         | Artifact                        | Who it is for                       |
| ----------- | ------------------------------- | ----------------------------------- |
| **macOS**   | `.dmg` (Apple Silicon, aarch64) | Apple Silicon Macs                  |
| **Windows** | `.msi` or `.exe` (x64)          | 64-bit Windows                      |
| **Browser** | built from source, `make dev`   | Any OS — including Intel Mac, Linux |

The browser path is not a consolation prize and must not read as one. It is the
supported answer for every platform without a packaged build, and it is the only
honest thing to offer an Intel Mac or Linux user. The release matrix in
`.github/workflows/release.yml` builds `macos-latest` (aarch64 only, owner
decision D4 — not a universal binary) and `windows-latest` (x64) and nothing
else. The page states this plainly rather than letting a user discover it by
finding no file to click.

Page sections, in order:

1. **Choose your way** — the three-way table above. macOS and Windows link to
   `https://github.com/udhawan97/Voyalier/releases/latest`; browser links to
   Getting started.
2. **Install on macOS** — open the `.dmg`, drag to `/Applications`. Dragging to
   `/Applications` is load-bearing, not tidiness: the updater cannot swap an app
   running from Downloads or a mounted disk image, which `guides/updates.mdx`
   already documents. Then the unsigned-build path: the "unidentified developer"
   warning, right-click → **Open**, or System Settings → **Privacy & Security** →
   **Open Anyway**.
3. **Install on Windows** — run the `.exe` (or `.msi`), then the SmartScreen
   path: **More info** → **Run anyway**.
4. **Run it in a browser** — short pointer to Getting started for the
   `make bootstrap` / `make dev` path at `127.0.0.1:5173`, naming who it is for
   (Intel Mac, Linux, or anyone who would rather read the source than trust a
   binary). Notes that this path has no in-app updater — you pull.
5. **Why the warning appears** — one honest paragraph: the bundles are not yet
   OS-code-signed or notarized, because that needs paid Apple ($99/yr) and
   Windows certificates. Explains what the OS is and is not telling you. This
   section must not train the reader to click through warnings as a habit; it
   explains this specific warning, once.
6. **Check the download (optional)** — see below.
7. **After install** — links onward to the Guides and to `guides/updates.mdx`,
   which takes over from here.

#### Verification section — exact constraints

Both files have **stable names**, so they resolve under `latest/download/` even
though the bundles themselves are version-named:

- `https://github.com/udhawan97/Voyalier/releases/latest/download/SHA256SUMS-macos.txt`
- `https://github.com/udhawan97/Voyalier/releases/latest/download/SHA256SUMS-windows.txt`

The two files are **not** in the same shape, and the page must not pretend they
are:

```
# SHA256SUMS-macos.txt — paths are prefixed
32b19515…  ./dmg/Voyalier_0.4.3_aarch64.dmg

# SHA256SUMS-windows.txt — bare filenames
37ecd067…  Voyalier_0.4.3_x64_en-US.msi
```

Because of the `./dmg/` prefix, `shasum -a 256 -c SHA256SUMS-macos.txt` fails
unless the user recreates that directory layout. The page therefore documents a
**manual compare** — `shasum -a 256 <file>` on macOS, `Get-FileHash <file>` on
Windows, then eyeball it against the sums file. Do not print a `-c` command that
does not work.

Hashes are **not** copied into the docs. Doing so would reintroduce exactly the
rot this design removes.

Frame verification as optional and secondary: updates are already
minisign-verified on-device and the artifacts carry SLSA build provenance. The
hash check is for someone verifying a _first_ manual download, which signatures
do not cover.

### 2. Link policy — always-newest

Owner decision: docs link to `/releases/latest`, never to a version-pinned file.
No page states a version number in prose. Consequences, accepted:

- The page cannot show exact bundle filenames (they carry the version) — it
  names extensions and architectures instead.
- Nothing needs hand-editing at release time. A release cannot leave the docs
  pointing at an old build.

The one exception is the README release badge, which becomes shields.io's live
`github/v/release/udhawan97/Voyalier` badge — it reads the version from GitHub,
so it is always-newest by the same principle rather than a violation of it.

### 3. `README.md`

- Badge row: `status-source--only_beta` → **two** badges, `status-public_beta`
  plus `installers-unsigned`. Two badges, not one combined label, so the day the
  certificates land the unsigned badge is deleted rather than reworded.
- Badge row: hardcoded `release-v0.4.1` → live `github/v/release` badge.
- The NOTE: drop "source-only beta". State that Voyalier can be downloaded for
  Apple Silicon macOS or Windows x64, or run in a browser from source on any OS,
  and keep the existing (still true, still funny) line about installers waiting
  on paid certificates.
- `## Run it`: delete "There is no polished installer yet" — now false. Open with
  the download links, keep the `git clone` / `make dev` block below it as the
  browser path. Preserve the existing tone; this is an edit, not a rewrite.
- Nav chips: `🚀 Run it` continues to work; no anchor renames.

### 4. `docs-site/src/pages/index.astro`

The hero ends with exactly two buttons:

- Primary: **Download** → `/download/`.
- Secondary: `Start from source` → `/getting-started/` (was the primary).
- `Explore on GitHub` leaves the hero and is added to the top nav, beside
  `Read the docs`. The footer already carries a GitHub link and is left alone —
  putting it in the nav avoids two GitHub links in the same row.
- The closing `Enter the docs` / `View the repository` action pair is unchanged.

### 5. `astro.config.mjs`

Sidebar gains `{ label: "Download and install", link: "/download/" }` directly
after `Introduction` and before `Getting started`. Order encodes the audience:
most readers want the app, not the toolchain.

### 6. `getting-started.mdx`

- Retitle to the from-source / browser path (frontmatter `title` +
  `description`).
- First line: a pointer for anyone who just wants the app → the download page.
- Body content (requirements, `make bootstrap`, `make dev`, ports, the tour
  paragraph, `make check`) is otherwise **kept as-is**. This is a reframing, not
  a rewrite.

### 7. `troubleshooting.mdx`

Add a "Voyalier won't open on first launch" entry covering the macOS
unidentified-developer and Windows SmartScreen cases, linking to the download
page's bypass steps. Rationale: a user hitting that warning searches from the
symptom, not from the install page they already left.

### 8. `guides/updates.mdx`

One addition: the browser/source path has no in-app updater — `git pull`. The
guide currently assumes a packaged build throughout.

### 9. `CHANGELOG.md`

One `Unreleased` docs entry.

## Explicitly out of scope

- App code, contracts, Rust, the updater itself.
- `privacy.mdx` and `architecture.mdx` — their update/network coverage is already
  correct and was reconciled during the updater docs sweep.
- Signed/notarized installers (blocked on paid certificates — unchanged).
- Intel Mac or Linux bundles (would need a release-matrix change and its own
  decision; the browser path is the answer today).
- A hosted browser demo. "Browser" here means locally from source. The page must
  not imply a URL you can just visit.

## Verification

- `pnpm build` in `docs-site` succeeds; no broken internal links.
- Every claim on the page is checked against a real artifact of `v0.4.3`, not
  from memory: the platform table matches the release-matrix targets, and the two
  `SHA256SUMS-*.txt` shapes match what is actually published.
- `/releases/latest` resolves (it does today — verified: it redirects to
  `v0.4.3`).
- README badges render; the live release badge shows `v0.4.3`.
- No page anywhere states a hardcoded version number in prose.
- Homepage: primary button reaches the download page; no duplicate GitHub links
  sit adjacent after the move.

## Risks

- **Tone drift.** The README and site have a distinct, dry voice. Every edit here
  lands in high-visibility copy. Match the surrounding voice; do not add new
  jokes and do not flatten existing ones.
- **Overpromising.** The single biggest failure mode is a page implying a
  universal macOS build, a Linux build, or a hosted browser demo. Each is named
  above as out of scope precisely because the page must not imply it.
- **Warning fatigue.** Bypass instructions can read as "ignore your OS." Explain
  this one warning and why it is expected; do not generalize.
