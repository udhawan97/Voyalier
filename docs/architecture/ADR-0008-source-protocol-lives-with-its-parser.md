# ADR-0008: A source's URL belongs beside its parser

- Status: Accepted
- Date: 2026-07-29

## Context

`crates/voyalier-core/src/source.rs` opens with the rule:

> Building a source's URL is part of knowing that source's protocol, so it belongs beside the
> parser that reads the reply rather than at the call site that happens to need it.

Ten production URL literals in `crates/voyalier-app/src/lib.rs` disagree with it — UK FCDO,
US State, Canada GAC, Germany AA, CDC notices, Open-Meteo forecast, Open-Meteo archive,
Open-Meteo air quality, NWS alerts, and the ECB rate feed. Every one of those has its parser
in `voyalier-core`, so knowing how to talk to a source is currently split across the crate
seam: core knows how to read the reply, the application layer knows what to ask.

Three distinct shapes have grown up around the same idea, and which one a source uses is an
accident of when it was written:

- **Fetch-injected** — `weather::geocode` and `holidays::public_holidays` take a fetch closure
  and own their URL. `geocode`'s doc comment is a retro on the older shape: assembling the URL
  at the call site "meant four call sites each deciding it again — three of them
  character-for-character identical".
- **Request-as-value** — `provider::build_key_validation_request` and
  `assist::build_assist_request` return a URL and headers for the caller to execute. Both are
  right for their case: the key and the provider choice live in the application layer.
- **Slug-gate only** — `advice::validate_country_slug` and `advisories::advisory_country`
  resolve a submitted slug against a curated table and hand back a row, leaving the caller to
  interpolate it into a URL it wrote itself.

The third shape is the one that leaks. The gate exists so that "arbitrary strings are
rejected, never interpolated" — and then the interpolation happens somewhere else, in a crate
that cannot see the table the gate consulted.

Two further observations, recorded so they stop being re-raised:

- `provider.rs` and `assist.rs` build **identical** provider auth headers — `Bearer {key}` for
  OpenAI, `x-api-key` plus `anthropic-version` for Anthropic — in two separate `match` arms.
  Both modules document that they own "which pairs with which provider"; they now own it
  independently.
- The four advisory parsers share a signature to the letter and one line of body, and
  `unreadable_source()` is duplicated across `advisories.rs`, `advice.rs`, `weather.rs`, and
  `climate.rs` — the last of these documented as "deliberately identical" wording.

## Decision

Move URL construction into the module that owns the parser, following the shape
`weather::geocode` already established: the core function owns the endpoint and the encoding,
and the application layer supplies only the fetch and the error flavour.

This is a core-internal change. No contract type, stored column, or wire payload moves.

`build_assist_request` and `build_key_validation_request` keep the request-as-value shape —
they are not the leak, and the key material genuinely belongs to the caller. The duplicated
provider auth headers collapse into one function shared by both.

## What this deliberately does not do

**It does not add a `confidence` field to retrieved snapshots.** `AGENTS.md` lists confidence
among the things to preserve, and an architecture review flagged its absence as a gap. On
inspection that reading is wrong, and acting on it would be a defect: a scalar confidence for
a government advisory feed would be a number Voyalier invented about someone else's
publication, which is precisely the overreach ADR-0006 exists to prevent. Confidence belongs
to the **extraction** path, where a parser really does have a basis for it, and it is already
there and categorical — `ExtractionMethod` (`Structured` / `Inferred` / `Manual` / `Assisted`)
paired with `WarningCode` and `FieldSpan`. That is the honest encoding, and it stays.

**It does not content-hash retrieved snapshots.** `sha256_hex` covers imported documents,
where the hash backs a `UNIQUE (trip_id, content_hash)` constraint and stops the same
confirmation being imported twice. A fetch-path hash would answer "has this changed since last
time", which is a real question, but nothing in the product asks it yet. Adding storage for an
unasked question is how a schema grows fields nobody reads.

**It does not introduce a generic `RetrievedSnapshot<T>`.** `docs/architecture/RETRIEVED_SNAPSHOTS.md`
rejected that, and it was right: the sources are not interchangeable, and flattening their
typed payloads and per-source persistence would hide fewer rules than it exposes. Nothing here
reopens it. Provenance stays per-source and hand-assembled, because the six construction sites
genuinely differ — Germany publishes no per-country URL and stamps epoch seconds, so its entry
records `source_updated_at: None` with a comment saying why. A shared constructor would have
to accept that as a parameter anyway.

## Consequences

- A source's endpoint, its encoding, and its parser can be read in one place, and changing how
  Voyalier addresses a source stops being a two-crate edit.
- `advisory_country` and `validate_country_slug` become what their doc comments already claim:
  the only door to a fetch URL, with no interpolation reachable past them.
- `voyalier-app` keeps the `AdviceFetcher` seam and the error flavouring, which is the part it
  genuinely owns. It stops holding ten string literals about protocols it does not implement.
- The advisory panel's multi-source fan-out stays in `AppService`. Which sources answer for a
  country, and what a partial answer means, is application choreography rather than any one
  source's protocol.
