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

## Amendment: execution carries a request class

Accepted 2026-09-01. Owning a source URL does not by itself authorize every destination that URL can
resolve or redirect to. The application IO layer therefore attaches a request class when it executes
a core-owned request through `AdviceFetcher`. This deepens the existing network seam; it does not add
a second fetch abstraction or move DNS, sockets, redirects, or response reading into core.

An untrusted saved-page capture uses the `PublicResource` class. Its initial authority and every
redirect are parsed and canonicalized, every DNS answer is checked at the resolver used for the
actual connection, and the whole request is rejected if any answer is loopback, private,
link-local, shared, documentation-only, multicast, reserved, unspecified, or otherwise non-public.
Rejecting the whole answer set matters: filtering a private address while retaining a public one
would let connection retry become a DNS-rebinding path. HTTPS-to-HTTP redirects are also rejected.
The page body keeps its existing 2 MiB read ceiling.

Trusted, application-constructed sources use their own named request class and their existing
allowlisted protocol builders. They do not inherit the saved-page destination policy by accident,
but each ordinary response must have an explicit body and time budget appropriate to that source.
A generic unlimited `read_to_string` is not the default.

Local AI is deliberately separate:

- Ollama detection, inference, and chat remain restricted to the explicit loopback Ollama
  authorities and never pass through `PublicResource`.
- A traveler-initiated model installation may take many minutes, so it keeps a distinct long-running
  request class rather than inheriting an ordinary global deadline. Its endpoint stays loopback and
  its control/progress response remains explicitly bounded.
- Cloud-provider requests keep their provider-owned URL and authentication construction, their
  explicit-consent preview, and their own response budgets. No request class broadens the content or
  credentials a provider receives.

Consequences of the amendment:

- Redirect and DNS policy is enforced below the `AdviceFetcher` seam against the addresses the
  transport can actually connect to, not by a host-string precheck in a caller.
- Encoded IP literals, IPv4-mapped IPv6, mixed public/private answer sets, and repeated resolution
  require deterministic tests.
- The production resolver API is version-sensitive. If the chosen HTTP client exposes it outside
  its stable surface, that dependency is pinned exactly and its compile and behavior checks become
  part of the repository gate.
- Response ceilings remain request-specific. Resource safety must not make local inference or an
  explicit model pull silently stop working.
