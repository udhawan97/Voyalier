# Visa preparation cockpit — design

**Date:** 2026-07-28
**Status:** Built and shipped in 0.6.0 (2026-07-28)
**Fills:** the hole `crates/voyalier-core/src/readiness.rs` names in its own header — _"that sourced
readiness is a later milestone and must be quoted from identified sources, never inferred here or by
a model."_

## The problem

A traveller who needs a visa faces the single highest-friction task in a trip, and Voyalier
currently offers one thing: a permanently `NotChecked` readiness item with three generic links to
government front pages. The traveller leaves the product to do the actual work, and the work is
where the mistakes happen — a form filled in a browser instead of Adobe Reader, a photo cropped to
the wrong national spec, a bank balance that appeared last week.

Meanwhile `AGENTS.md` states plainly: do not _"claim authority over visas."_ The naive version of
this feature — a table of requirements, fees, and processing times — is both the most useful-looking
and the most dangerous thing we could ship. A stale row costs someone a fee or a trip.

## What this is, and what it refuses to be

Voyalier never determines whether you need a visa, never states a fee, never states a processing
time, and never reports that your entry requirements are satisfied.

What it does own is the part no government publishes: **translation and warning.** For each step of
an application it says what the authority calls the thing, what that means in plain language, which
documents it takes, and the specific ways people commonly get it wrong — then links to the official
page for the requirement itself.

The division is absolute and testable: **every factual claim about a requirement is a link; every
sentence Voyalier authors is either a translation or a caution.**

## Decisions

| Question           | Decision                                                                      |
| ------------------ | ----------------------------------------------------------------------------- |
| How assertive?     | Pointer + preparation cockpit. Requirements are links, never assertions.      |
| Coverage           | Destination curated deeply once; nationality selects the path.                |
| Persistence        | Full per-trip cockpit — nationality, checkboxes, and notes persist.           |
| Readiness coupling | `EntryRequirements` stays `NotChecked` forever; gains a self-report sub-line. |
| Placement          | Its own trip-detail nav section, with a step rail inside it.                  |

### Why curated-and-bundled, not fetched

`canada.ca` returns HTTP 403 to automated fetches, and IRCC publishes no machine-readable feed. The
`AdviceFetcher` seam is therefore not applicable here. Curated data is compiled into the binary,
stamped with `curated_as_of`, and resolved fresh on every read so a corrected row never freezes into
a stored snapshot — the rule `tipping.rs` already follows.

## Architecture

### `crates/voyalier-core/src/visa.rs` — new, IO-free

Curated tables plus pure resolvers. Follows the `tipping.rs` precedent that per-country curated
English prose is **data**, co-located with the links it describes, and carries a `language` tag the
way `advisories.rs` does so the interface can mark it up.

```rust
pub enum EntryPath { VisaRequired, ElectronicAuthorization, Exempt, Unknown }

/// Quoted from the destination authority's own published list. Never inferred.
pub struct EntryPathQuote {
    pub path: EntryPath,
    pub source_name: String,
    pub source_url: String,
    pub curated_as_of: String,
    pub language: String,
}

pub struct VisaDocument {
    pub id: String,               // stable: "ca.trv.funds.statements"
    pub label: String,
    pub plain_explanation: String,
    pub gotchas: Vec<String>,
    pub links: Vec<SourceLink>,
}

pub struct VisaStep {
    pub id: String,               // "ca.trv.04-funds"
    pub ordinal: u8,
    pub title: String,
    pub authority_term: Option<String>,   // "proof of means of financial support"
    pub plain_explanation: String,
    pub documents: Vec<VisaDocument>,
    pub links: Vec<SourceLink>,
}

pub struct VisaJourney {
    pub destination_iso2: String,
    pub nationality_iso2: String,
    pub route_label: String,
    pub entry_path: EntryPathQuote,
    pub steps: Vec<VisaStep>,
    pub curated_as_of: String,
    pub language: String,
}

pub fn entry_path(destination_iso2: &str, nationality_iso2: &str) -> EntryPathQuote;
pub fn visa_journey(destination_iso2: &str, nationality_iso2: &str) -> Option<VisaJourney>;
```

`EntryPath::Unknown` is a first-class result, not a failure: an uncurated destination or nationality
yields no journey and the official links only. There is no fallback that guesses.

The step-1 branch needs no special type. It is an ordinary `VisaStep` whose title is a question and
whose links point at the authority's own eligibility list.

### `crates/voyalier-app` — storage

One appended `MIGRATIONS` step. Two tables, modelled directly on ADR-0005's traveler-owned planning
records so a ticked box can never read as confirmed evidence:

```sql
CREATE TABLE visa_prep (
  id               TEXT PRIMARY KEY,
  trip_id          TEXT NOT NULL UNIQUE REFERENCES trips(id) ON DELETE CASCADE,
  nationality_iso2 TEXT,                      -- sealed
  updated_at       TEXT NOT NULL
);

CREATE TABLE visa_prep_items (
  id          TEXT PRIMARY KEY,
  trip_id     TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL,                  -- a curated VisaDocument.id
  checked     INTEGER NOT NULL DEFAULT 0,
  note        TEXT,                           -- sealed
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (trip_id, document_id)
);
```

`visa_prep.nationality_iso2` and `visa_prep_item.note` are added to `SEALED_COLUMNS`. Nationality is
personal data; notes will contain application numbers. Both read and write paths are wired, per the
rule that there is no `seal`/`open` escape hatch outside `Records`.

A `visa_prep_item` row exists only after an explicit tick or note — exactly as `PackingItem` exists
only after an explicit add. The curated checklist is computed output and enters storage by itself
never.

### `packages/contracts` — three methods

| Method                | Verb  | Path                                                 | Command                  |
| --------------------- | ----- | ---------------------------------------------------- | ------------------------ |
| `getVisaPrep`         | `GET` | `/api/v1/trips/{tripId}/visa`                        | `get_visa_prep`          |
| `setVisaNationality`  | `PUT` | `/api/v1/trips/{tripId}/visa/nationality`            | `set_visa_nationality`   |
| `setVisaItemProgress` | `PUT` | `/api/v1/trips/{tripId}/visa/items/{visaDocumentId}` | `set_visa_item_progress` |

Each lands in all eight required places: `AppService`, the Axum route, the Tauri command,
`contracts/src/index.ts`, `contracts/src/mock.ts`, `gateway/http.ts`, `gateway/tauri.ts`, and a
`parity/routes.json` row. `getVisaPrep` returns the resolved journey and the stored progress
together, so the interface cannot pair a journey with someone else's checkboxes.

Note text is bounded and counted with `countChars()`, never `.length`.

### `apps/web` — the cockpit

`views/VisaPanel.tsx`, mounted as a fifth `DeferredSection id="section-visa"` between Prepare and
Discover, with the step rail inside it. The nav array gains `{ label: "tripnav.visa", target:
"section-visa" }` and the scroll-spy guard becomes
`/^section-(plan|prepare|visa|discover|ai)$/`.

`ReadinessPanel`'s `EntryRequirements` row gains a sub-line reading the traveller's own count — _"You
marked 8 of 8 prep steps done. Voyalier has not verified any of them."_ Its status stays
`NotChecked` and it continues to be excluded from the overall rollup, unchanged.

Nationality is stored per trip. A trip with none prefills from the most recently set one, so a
traveller picks their passport once rather than once per trip.

## The curated Canada journey

Route: visitor visa (temporary resident visa) from outside Canada. Eight steps. The four marked
**high-value** are the ones that save real money or a refusal; they are the reason the feature earns
its keep.

1. **Do you even need one?** — **high-value.** IRCC lets citizens of _some_ visa-required countries
   skip the visa for a far cheaper eTA if they have held a Canadian visa in the last ten years or
   hold a valid US non-immigrant visa. The eligible list is short and it moves (Indonesia and
   Malaysia were added 2026-05-26). Voyalier asks the question and links the list. It never answers
   it.
2. **Your passport** — validity, blank pages, and carrying old passports for travel history.
3. **Photo** — **high-value.** IRCC's digital photo specification is not the Indian passport photo
   specification; dimensions and head height differ. Reused photos get applications returned.
4. **Prove you can pay** — IRCC's term is "proof of means of financial support". Plainly: show the
   money has _been_ there, not that it _is_ there. No fixed amount is published for visitors.
   Documents: 4–6 months of bank-stamped statements; sponsor's statements and letter if someone else
   is paying; income proof tying the balance to something recurring. Gotcha: a large deposit just
   before applying needs an explanation letter or it counts against you, and an invitation letter is
   not a legal sponsorship.
5. **Prove you'll come back** — employment letter, leave approval, property, family, enrolment.
   Framed as the question the officer is actually asking: what pulls you home?
6. **Fill the forms** — **high-value.** IMM 5257 plus IMM 5645 family information. IMM 5257 must be
   opened in Adobe Reader and _Validate_ pressed to generate the barcode; filled in a browser it
   silently produces a form IRCC rejects.
7. **Submit, pay, biometrics** — **high-value.** IRCC account, fees, then the visa application
   centre. Biometrics last ten years, so an earlier Canadian application may mean skipping the
   appointment entirely. Thirty days to attend once the request letter arrives.
8. **Wait, then send passport** — the processing-time tool, how to answer a request for more
   documents, and what a passport request (PPR) letter means.

Curated links: IRCC's visa-or-eTA check tool, the eTA-X eligibility list, Guide 5256, IMM 5257,
IMM 5484, the photo specification, the biometrics page, and the processing-times tool. Every URL is
verified by hand at authoring time and stamped `curated_as_of: "2026-07-28"`.

**Amended during the build:** per-nationality biometrics pointers were dropped. IRCC publishes one
visa-application-centre finder covering every country rather than per-country pages, so the fifteen
curated rows would all have resolved to the same URL — a distinction the source does not make.

**Also amended:** `visa_prep` carries an `id` column despite `trip_id` being its natural key.
`migrate_encrypt_sensitive_columns` re-seals legacy rows by `SELECT id, <column>`, so every sealed
table needs one; matching `trip_notes` costs a column where teaching that helper per-table keys would
cost a branch on every future sealed table. The item route's path placeholder is
`{visaDocumentId}`, not `{documentId}` — the manifest already uses the latter for an imported source
document.

## Testing

- **`visa.rs` inline `#[cfg(test)] mod tests`** — every curated link is a well-formed `https` URL;
  every journey's steps are contiguously ordered from 1; every `VisaDocument.id` is unique within
  its journey and prefixed by its destination; every nationality in `countries.tsv` resolves to some
  `EntryPath` without panicking; `Unknown` yields no journey.
- **`packages/contracts/parity/visa.json`** — golden asserted from both `crates/voyalier-core/src/tests.rs`
  and `apps/web/src/parity.test.ts`, pinning exact case counts on both sides, per the standing rule.
- **`apps/web/src/visaPanel.test.tsx`** — feature-named, rendered through `src/test/helpers.tsx`.
  Covers: nationality selection persists; ticking an item persists; the disclaimer is always
  present; an uncurated nationality shows links and no journey; the readiness sub-line reports the
  traveller's own count and the status stays `NotChecked`.
- **`apps/web/src/routeParity.test.ts`** — three new manifest rows, asserted in both directions from
  the web gateways, `voyalier-server`, and `voyalier-desktop`'s `generate_handler!`.
- **Vault coverage** — a round-trip test proving `nationality_iso2` and `note` are unreadable in the
  raw database file, matching the existing sealed-column tests.

## Out of scope for this slice

- Travelling parties. One applicant per trip; family and group applications are a later slice.
- Any destination other than Canada. The second journey is the real test of whether the abstraction
  holds, and it should be added deliberately, not speculatively.
- Live fetching or refreshing of curated data — not possible against IRCC, as above.
- Export or print of the guide.

## Required ADR

This slice changes the contract and storage, so per `AGENTS.md` it opens
`docs/architecture/ADR-0006-visa-preparation-pointers.md`, recording the pointer-not-authority rule
and the sealed-nationality decision as binding constraints rather than implementation notes.
