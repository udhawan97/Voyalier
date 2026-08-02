# Audited user-flow repairs — 0.9.3

Eleven findings from the 2026-08-02 browser audit of 0.9.2 (`9c3b49a`), which
aimed at the flow the 0.9.2 notes named as unexercised: import → candidate
review → evidence. All eleven were reproduced against a real loopback Axum
server in Chromium. The audit changed no application code; this plan does.

Order below is layer order, which is also commit order.

## App — H1, the one that can lose data

**`VOYALIER_DATA_DIR` moves the database but not the vault key.**
`KEYRING_SERVICE` (`lib.rs:295`) and `VAULT_KEY_ACCOUNT` (`lib.rs:558`) are
compile-time constants and the crate has exactly one env override
(`VOYALIER_DATA_DIR`, `lib.rs:1149`), so every data directory belonging to one
OS user reads and writes one key. Opening a passphrase-protected directory
deletes it (`lib.rs:608-612`), setting a passphrase deletes it
(`service_vault.rs:52`), and restoring a backup overwrites it
(`lib.rs:1093`/`1095`). Everything in `SEALED_COLUMNS` in the _other_ directory
then fails to open, and because `load_or_init` folds keychain errors into
"vault inactive", nothing names the cause.

Fix: derive the keychain account from the database path.

- The platform default path keeps the legacy account `vault.data_key`
  unchanged, so no shipped install migrates or notices.
- Any other path gets `vault.data_key.<16 hex of sha256(path)>`.
- **Adopt-on-first-use**: if a non-default path finds no namespaced account but
  a legacy one exists, copy the legacy value into the namespaced account rather
  than generating a new key. Data already sealed under the legacy key stays
  readable, the default install keeps its key, and from then on this directory
  owns an account nobody else deletes.

Copy, never move — a move would be the same data-loss bug pointing the other
way. ADR-0016 carries the reasoning.

## Core — the evidence spans

Two independent defects in `parser.rs`, neither of which fixes the other.

**G2 · the span points at the wrong occurrence.** `span_for_value`
(`parser.rs:571`) anchors with `raw.find(value)` — the first textual occurrence
anywhere — and the JSON-LD path hands it the whole HTML document
(`parser.rs:387`). A presentational `data-flight="LX0318"` earlier in the file
therefore wins over the JSON-LD `flightNumber` the value was actually read from,
and `FieldSpan.start`/`end` — persisted in a sealed column, shipped on the wire —
record provenance the fact does not have. Fix: search within the JSON-LD block
the reservation was parsed from and rebase the offset, so spans stay
raw-document-relative and the contract is unchanged.

**G3 · the quote shows markup instead of words.** `excerpt()` slices ±40
characters and _then_ calls `strip_tags_and_collapse`, which starts with
`in_tag = false`. A window opening inside a tag emits the tag's attribute text
as prose; one closing inside a tag swallows everything after the `<`, including
the value it evidences. Fix: strip first, then take the window from the cleaned
text.

**G6 · a clipped quote does not say it was clipped.** `search.rs` already does
this correctly for the same job (`…` at both clipped ends, line 447-452). The
parser gets the same treatment. Ellipsis only — neither file snaps to word
boundaries and this plan does not add that.

Non-goal, recorded because it is the tempting fix: do not slice the excerpt into
HTML to highlight the match. `injection.test.tsx` guards the inert blockquote.

## Web — the dialog, the import form, the visa copy

**G1 · a closing dialog steals focus from the one that replaced it.** P0. The
unmount cleanup's `queueMicrotask` (`Dialog.tsx:127-152`) restores focus after
the next dialog has already focused itself; the line-136 guard tests the closing
dialog's own removed node, which covers StrictMode replay only. One condition
inside the microtask, after 136 and before 137: bail when `document
.activeElement` already sits inside a live `[role="dialog"]`. All three
documented guards stay.

**G7 · the dialog body does not scroll by keyboard.** `initialFocus="dialog"`
parks focus on `.voy-dialog`, whose scroller `.voy-dialog__body` is a
_descendant_; browsers scroll the nearest scrollable _ancestor_. Make the body
focusable and focus it instead, so there is one.

**G4 · a failed import shows nothing.** The banner mounts above the user's
scroll position and nothing moves it. Scroll it into view and focus it on
failure. `bodyRef` is the node `Dialog` never manages, which is also G7's
shape — but these are two fixes, not one.

**G5 · pasted HTML is read as plain text.** Format is inferred from a file's
extension but never from pasted content, and it selects the parser
(`parse_import`, `parser.rs:52-58`), so a pasted booking page runs the plaintext
parser over markup. Offer the switch rather than taking it: a hint beside the
Format control when the pasted content looks like HTML. Inference stays a
prompt, so untrusted content never picks its own parser.

**G8 · "Neither is published for this passport" has no antecedent.** Name both
instruments and keep the verb; ADR-0006 forbids turning a publication state into
an entry outcome, so "no visa required" is a regression, not a fix. `en` and
`es` move together.

**G9 · the import label truncates silently, in the wrong units.** `maxLength`
counts UTF-16 while AGENTS.md requires `countChars()`. Unlike the 0.9.1
origin/destination fix there is no engine limit to align to, so this is a
product decision: keep 200 as the product's own limit, count it the way the rest
of the app counts, and show the count.

**G10 · the empty import result is a soft dead end.** Both onward destinations
already exist in the same view. Offer hand entry from the zero-result state.

## Verification

Each fix lands with a test that fails without it. The parser fixes go in
`crates/voyalier-core/fixtures/parser/` where a directory registers itself; G1
goes in `review.keyboard.test.tsx`, which already has the helper and currently
only exercises the control path. `make check` is the gate.

## Explicitly not in this release

- Word-boundary snapping in either excerpt builder.
- The visa-statistics error code that cannot separate "unreachable" from
  "unreadable" — already recorded as needing its own ADR.
- The 31 view files and the states the audit never opened, including the AI
  assist consent gate and the Plan panel. They are listed in the report and are
  the next pass, not this one.
