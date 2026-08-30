# Trip-search source continuity plan

`searchTrip` already returns imported documents, confirmed facts, and saved
research resources with the local record id that produced each match. The
current **Find in this trip** interface still models only its original two
sources: it renders every resource match as a generic confirmed stay and offers
only Copy, leaving the traveler to find the owning record again by hand. This
phase corrects that drift and lets every result return to its exact local source.

## Product and architecture boundary

- Search remains deterministic, local, and read-only. Opening a result performs
  no write, fetch, provider call, or background action.
- Imported documents remain untrusted evidence, confirmed facts remain
  traveler-approved facts, and resources remain reading material. The interface
  names those three lanes separately and never promotes one into another.
- Existing `SearchHit.source` and `SearchHit.recordId` fields are sufficient.
  No contract, gateway method, route-manifest row, Tauri command, Axum handler,
  migration, sealed column, provider, source license, or consent surface changes.
- Record ids remain transient in-page navigation state. They do not enter the
  URL, history, clipboard, log output, or durable settings.
- English and Spanish copy, keyboard focus, screen-reader naming, reduced
  motion, contrast, and 200% zoom/reflow remain gates.
- No ADR is required: this composes the source identities already accepted by
  the search contract and the existing continuity navigator.

## Slice 1 - Tell the truth about research matches

Render a resource hit from its traveler-authored label and name its source as a
research resource. Update the trip-search introduction and empty state to say
that saved research is searched alongside imported documents and confirmed
facts. Preserve the raw snippet as the evidence for why the hit matched.

Acceptance:

- A resource hit never falls through to the generic Stay label or the confirmed
  plan source label.
- Product-owned labels are localized in English and Spanish; traveler-authored
  titles and matched snippets are preserved verbatim.
- Existing document and confirmed-fact labels, ranking, typeahead, copy, stale
  response guards, and failure states remain unchanged.

## Slice 2 - Return each result to its local source

Add a localized **Show source** action to every trip-search result. The parent
trip view routes the existing source discriminant and record id through the
same transient continuity navigator already used by Today, disruption, and
workspace search.

Acceptance:

- A confirmed-fact result focuses the exact Blueprint card.
- A document result mounts the deferred preparation section and focuses the
  exact imported-document row without fetching its sealed body.
- A resource result mounts the deferred preparation section and focuses the
  exact saved-resource row without fetching the page.
- If the record disappeared between search and activation, focus falls back to
  the owning Blueprint, Imported documents, or Saved reading heading and an
  honest localized announcement names the missing source.
- The query and result list remain available after the in-page detour. Record ids
  and query text never enter the URL.
- Repeated result controls have source-specific accessible names and remain
  usable by keyboard at 320 pixels and 200% zoom.

## Verification and delivery

The pre-agreed test seam is the rendered web interface using the shipped
`AppGateway` mock through `renderApp`; this is the repository's public UI seam,
not a private component or database side channel. Work one vertical red-green
slice at a time in `tripSearch.test.tsx`, then retain focused coverage for
resource labeling, all three exact-source journeys, missing-record fallback,
Spanish copy, URL privacy, and unchanged Copy behavior.

After the focused suite passes:

1. Update the planning/search guide, roadmap wording, and Unreleased changelog
   with the bounded behavior and unchanged trust boundary.
2. Run the web gate, full `make check`, production dependency audit, repository
   credential-string scan, locked Cargo metadata, and `git diff --check`.
3. Refresh Graphify and verify a scoped query joining `SearchHit`, `TripSearch`,
   `ContinuityNavigator`, `DocumentsPanel`, and `ResourcesPanel`.
4. Run exactly two four-role council rounds and resolve every valid blocker.
5. Close the branch with `Merge: trip-search source continuity`, fast-forward
   verified `main`, push `main`, and wait for required exact-SHA checks. This
   phase does not authorize a version bump, tag, release, artifact publication,
   provider call, or deployment beyond workflows already triggered by `main`.

## Commit order

1. `Docs: plan trip-search source continuity`
2. `Web+test: return trip search to its sources`
3. `Docs: record trip-search source continuity`
4. Council-driven corrective commits, named by their affected layer
5. `Merge: trip-search source continuity`
