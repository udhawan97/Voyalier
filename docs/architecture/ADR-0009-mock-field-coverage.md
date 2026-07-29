# ADR-0009: Hold the mock to the contract's fields, not only to the core's rules

- Status: Accepted — extends ADR-0004
- Date: 2026-07-29

## Context

ADR-0004 kept `packages/contracts/src/mock.ts` and made it honest with shared golden files,
after roughly 990 of its lines were found re-implementing `voyalier-core`'s rules in
TypeScript and drifting in five places. That decision has held: the goldens are asserted from
both languages, both sides pin exact case counts, and the rule-level drift it was built to
catch has not returned.

A sixth drift shipped anyway, and the goldens could not have caught it.

`VisaPrep.suggestedNationalityIso2` is declared in the contract, populated by
`AppService::get_visa_prep` from `latest_visa_nationality()`, and read by `NationalityPicker`
to prefill the passport field. `readVisaPrep` in the mock never set it, on either return path.
Every component test therefore exercised only the empty-suggestion branch: the prefill had no
coverage, and in mock mode it silently did nothing.

The goldens compare **behaviour on cases**. A field the mock never populates has no case, so
there is nothing to disagree about. ADR-0004 closed the gap between two implementations of a
rule; this is the gap between an implementation and the contract's own shape.

The failure is quiet in a specific way worth naming: an absent optional field is
indistinguishable from a legitimately-absent one. `VisaPrep.journey` is _correctly_ absent for
an uncurated route. Nothing separates "absent because that is the answer" from "absent because
nobody wrote it".

## Decision

**Keep the mock.** Two adapters at one seam is a real seam, and the mock still earns its place
— it needs no storage, keychain, or network, and the entire component suite runs against it in
seconds.

**Add a field-coverage guard.** Across a scripted workspace that exercises every `AppGateway`
method, every optional property the contract declares on a response type must be populated by
at least one response — or appear in an explicit exceptions table with a reason.

The property list is read from `packages/contracts/src/index.ts` at test time using the
TypeScript compiler API, which is already a dependency. Deriving it rather than maintaining it
is the whole point: a hand-written list of fields to check would fail exactly the way the
hand-written list of Tauri commands failed in 0.6.0, by never including the new one.

Reading a guard's expectations out of source is an established idiom here, not a new one:
`voyalier-server` parses `pub fn app` to compare the router against the route manifest, and
`voyalier-desktop` reads the identifiers out of `generate_handler!`. Both are accompanied by a
test that keeps the parsed form parseable, and this follows the same pattern.

## Alternatives considered

**Collapse the mock's rules — compile `voyalier-core` to WebAssembly and call it.** This is
the change that would delete the duplication rather than police it. Rejected for now on cost,
which `AGENTS.md` requires be stated: it puts `wasm-pack`/`wasm-bindgen` and a Rust toolchain
in the web build, ships a binary artifact into the browser bundle, and needs its licensing,
privacy, offline behaviour, and replacement cost documented. It also would not remove
`mock.ts` — most of its bulk is fixture state, latency, and failure injection, none of which
core provides. The duplication it removes is real; the price is a build-system dependency for
every web contributor. Revisit if rule-level drift returns despite the goldens.

**Run component tests against the real gateway.** Rejected: it makes a live Rust server a
precondition for every web unit test and trades a fast loop for a slow one.
`scripts/check.sh integration` already covers the real stack where that coverage belongs.

**Extend the visa golden with a suggestion case.** That is the fix for the bug, not for the
class, and it leaves the next omitted field exactly as invisible. Done as part of the repair;
insufficient as the decision.

## Consequences

- A contract field the mock forgets fails the web suite with the field named, rather than
  becoming an untested branch.
- The exceptions table becomes a short, reviewed list of fields the mock deliberately never
  populates, each with a reason. That is documentation the codebase does not currently have.
- The guard sees the contract's _declared_ shape, not the Rust gateway's behaviour. A field
  both implementations omit still passes. Closing that needs a cross-language comparison, and
  the route-parity manifest is the better precedent for it if it ever becomes necessary.
- Parsing `index.ts` is coupled to it staying parseable — plain `export interface`
  declarations. A companion assertion keeps that true, as with the two existing source-reading
  guards.
- ADR-0004 is not superseded. Its goldens keep doing the job they were chosen for; this adds
  the axis they do not cover.
