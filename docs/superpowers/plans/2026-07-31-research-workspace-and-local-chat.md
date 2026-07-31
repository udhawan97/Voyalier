# Research workspace and local chat

**Date:** 2026-07-31
**Scope:** trip-scoped research resources, a local-only grounded chat, and the curation
track the open-data list named as the highest-value remaining work.

Decided in a grilling session; every branch below was put to the owner and answered.
This plan is the record of those answers, and it is committed before the work.

## What this is

Two features and one curation pass.

**Resources** turn a trip into the place research lands: links and files kept with the
trip, each with the traveler's own note and tags, searchable offline, readable in-app.

**Chat** is a local-only conversation with the trip's own material — grounded through the
existing deterministic search, redacted exactly as today's assist is, and answered by
Ollama on the traveler's machine.

**Curation** extends visa journeys past Canada and adds the offline-map manifest entries
that were already built but never enabled.

## Decisions taken, and what they rule out

1. **Trip-scoped, not a general note base.** A resource belongs to a trip. Voyalier does
   not become a topic-organized knowledge tool; the product contract's "trip workspace"
   holds. Loose early research lives on a draft trip.
2. **A Resource is reading material, never evidence.** It yields no candidate facts and
   touches no readiness item. Dropping an airline confirmation into Resources is a
   mis-file, so the panel offers "Looks like a confirmation? Import it instead" and
   never parses a resource on its own.
3. **Capture is paste-then-consent.** Saving is local and instant. Fetching a title and
   readable text is a network call, so it needs consent — taken once as a reversible
   standing preference, not per link. Auto-fetching on paste without consent would break
   the ground rule in `docs/data/DATA_SOURCES.md` for the sake of a title.
4. **The fetch stores readable text, not just a card.** One `GET` either way; storing the
   text is what makes a resource searchable offline and groundable by chat. It is a
   **retrieved snapshot** in the existing sense — dated, attributed, stale-able, never
   evidence.
5. **Chat is local-only in v1.** Ollama only. Cloud providers keep the existing one-shot
   preview→consent→run assist, unchanged. Per-message cloud consent is unusable and a
   standing "always send" consent is a trust-contract change; **cloud chat is an explicit
   non-goal requiring its own ADR.**
6. **Grounding is deterministic retrieval, not a bigger prompt.** Each message runs the
   existing search scan; the top hits plus today's redacted trip baseline form the
   prompt. Bounded, transparent, testable without a model.
7. **The redaction line does not move because it is local.** Confirmation codes,
   traveler names, and raw imported document text stay out of the prompt. One posture
   for every AI path. The accepted cost: chat cannot answer "what is my booking
   reference" and will say so.
8. **Transcripts persist, sealed, and stay out of search, brief, and exports.** Sealed
   because the traveler's own messages are free-form and may contain anything. Out of
   search because a searchable transcript would be retrieved into the next prompt — the
   model would cite itself as local knowledge.
9. **High-stakes questions get a deterministic pointer, never a block.** App-authored,
   keyword-triggered, rendered above the reply with real links. Keyword false positives
   must not silence an answer.

## Domain language

`CONTEXT.md` gains one term, already written:

> **Resource** — A link or file the traveler deliberately keeps with a trip for reading,
> together with their own note and tags. It is reading material, not evidence: it never
> yields candidate facts and never affects readiness.

Chat introduces no glossary term. A transcript is a conversation, not a category of
truth — it is deliberately outside the evidence/approved/authored split.

## Build order

Layer order per AGENTS.md, each stage green before the next.

### 1. Core — resources (`crates/voyalier-core/src/resource.rs`)

- `ResourceKind` = `Link | File`.
- `Resource`, `ResourceSnapshot`, `CreateResourceInput`, `UpdateResourceInput`.
- `validate_create_resource` — `http`/`https` only (rejects `javascript:`, `data:`,
  `file:`), character-counted limits, tags trimmed/lowercased/deduped/capped.
- `resource_url_identity` — the duplicate key. Lowercases scheme and host, drops the
  default port, the fragment, a trailing slash, and `utm_*`/`fbclid`/`gclid`.
- `extract_readable_page` — a bounded, dependency-free HTML reader returning title,
  description, and text. Drops `<script>`/`<style>` bodies, decodes the five common
  entities plus numeric ones, collapses whitespace, caps output.
  _Why not a crate:_ adding a scraping dependency would need the licensing/privacy/
  replacement-cost note AGENTS.md demands, for something an evening's tested code does.
  The email extractor cannot be reused — it deliberately preserves HTML so JSON-LD parses.

### 2. Core — search widening

- `SearchHitSource::Resource`, `WorkspaceSearchSource::Resource`.
- `search_trip_corpus` takes resources as a third corpus.
- Resource labels **do** join the searchable haystack (the title is traveler-facing text,
  not a product noun) — unlike notes and facts.

### 3. Core — chat (`crates/voyalier-core/src/chat.rs`)

- `ChatRole`, `ChatMessage`, `ChatTurn`, `ChatGrounding`, `HighStakesTopic`.
- `high_stakes_topics` — deterministic keyword scan over the traveler's message.
- `build_chat_prompt` — reuses `build_trip_brief` with `RedactionPolicy::for_sharing()`,
  exactly as `build_assist_preview` does, then appends retrieved excerpts and a bounded
  slice of recent history.
- `CHAT_SYSTEM_PROMPT` — the assist prompt's discipline plus explicit deflection language
  for entry, visa, health, and safety questions.

### 4. App — persistence and services

- Migration 14 `trip_resources`; migration 15 `chat_messages`. Append-only, retry-safe.
- `SEALED_COLUMNS` gains `("trip_resources", "note")` and `("chat_messages", "text")`.
  The note is sealed for the same reason `trip_notes.body` and `saved_places.notes` are:
  it is whatever the traveler chose to write. Snapshot text is **not** sealed — it is
  public web material the traveler did not author.
- `service_resources.rs` — create, list, update, delete, `fetch_resource_details`.
- `service_chat.rs` — list, send, clear. Ollama-only, refuses cloud providers server-side.
- Research settings (`autoFetchDetails`) in the existing `app_settings` KV table.

### 5. Contract and transports

Every method lands in all six places in lockstep: `AppService`, the Axum route, the Tauri
command, `contracts/src/index.ts`, `contracts/src/mock.ts`, both gateways — plus a
`parity/routes.json` row and a bumped `counts.shared`.

New methods: `createResource`, `listResources`, `updateResource`, `deleteResource`,
`fetchResourceDetails`, `getResearchSettings`, `setResearchSettings`, `listChatMessages`,
`sendChatMessage`, `clearChat`. Ten methods → `counts.shared` 71 → 81.

"Save this reply to my notes" needs **no** method: the web calls the existing
`setTripNotes` with the appended text.

### 6. Web

- `ResourcesPanel` — quick-add, list, tag filter, duplicate warning, per-resource fetch.
- `ResourceReader` — renders a stored snapshot with its fetched date and source link.
- `ChatPanel` — thread, grounding citations, pointer cards, save-to-notes, clear.
- Guidance popovers, on by default and dismissible, covering: what a Resource is and is
  not, why fetching asks, what chat can and cannot see, and why a code is refused.
- Every string through `t()` in both `en` and `es`. Both panels lazily loaded.

### 7. Curation

- Visa journeys beyond Canada, using the machinery `visa.rs` already ships.
- Offline-map manifest entries for packs whose archives already build.

### 8. Release

Docs sync via `update-docs`, changelog prose, the four-file version bump, merge, push,
release.

## Testing

TDD throughout — the test before the code, per the superpowers gate.

- Rust inline `#[cfg(test)]`, cross-cutting cases in `crates/voyalier-core/src/tests.rs`.
- The redaction claim gets the same treatment the assist path got: capture the actual
  POST body and assert the confirmation code and traveler name are absent.
- `FakeFetcher::offline()` proves the no-consent path makes no request at all.
- Sealed columns are held by the existing `sealed_columns_round_trip_through_the_vault`.
- Web tests are feature-named and render through `src/test/helpers.tsx`.
- Parity goldens: exact case counts bumped on both sides.

## Explicit non-goals

- Cloud chat (needs its own ADR).
- Trip-less resources.
- Browser extension or OS share-sheet capture.
- Full-page archiving, screenshots, or PDF text extraction for search.
- Automatic parsing of a resource into candidate facts.
- Chat transcripts in search, the brief, or any export.
