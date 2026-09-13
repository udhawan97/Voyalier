# ADR-0024: Concierge state is local and provider handoffs are explicit

Status: accepted, 2026-09-12

Extends ADR-0005, ADR-0006, ADR-0012 and ADR-0018.

## Decision

Add one versioned concierge profile per trip. It stores traveler-supplied party context, area and stay preferences, traveler profiles, task progress, money entries and links from wallet labels to imported sources. The app layer seals the complete profile as one authenticated value in SQLite. Core validates it and derives next actions, per-person preparation steps, exact same-currency totals and provider handoffs on read.

Add encrypted attachment custody for PDF, JPEG and PNG files. Each file is limited to 20 MiB, each trip to 100 attachments, and raw attachments are limited to 500 MiB across the workspace. The workspace limit leaves headroom under the 2 GiB portable-backup container after the base64 transport and sealed-storage expansion. The app validates the declared MIME type against the file signature before writing. The original base64 payload is sealed through `Records`; listing returns metadata only, opening returns one decrypted file on explicit request, and deletion is explicit. The web UI creates short-lived object URLs for an explicit save or preview action. PDF previews use a sandboxed frame and image previews use the browser's inert image decoder; closing, replacing, or leaving a pending preview invalidates its request and revokes any materialized object URL. Attachments never receive script or same-origin privileges.

The shared gateway exposes one read and one whole-profile update. Both HTTP and Tauri call the same `AppService` methods and the hand-maintained route manifest declares their payloads. Whole-profile updates are bounded and validated; they are not an untyped command bus.

Provider actions carry an official provider domain, a verification class, the fields transferred, the fields still to enter, an evidence link and a plain-text search brief. Only documented or visibly verified templates may claim to transfer filters. Initial Airbnb, Expedia, Google Flights, Yelp, Reddit and AllTrails actions are link-only or observed destination links. They never claim live price, availability or a universal consumer ranking.

The per-person preparation projection is an execution guide, not a determination of admissibility. It distinguishes domestic U.S. preparation from foreign entry and return review, keeps unknown status unknown, and links to the authority that decides. A traveler-completed step is labeled as the traveler's report.

## Consequences

- Traveler and wallet metadata remain encrypted at rest and enter backups with the SQLite database.
- Binary originals are encrypted inside the same SQLite backup boundary. The 500 MiB raw-attachment workspace cap reserves room for their sealed representation inside the portable-backup format; the UI also shows each trip's current use.
- Imported document bodies keep their existing evidence, review, amendment and restore semantics. Wallet rows organize those documents rather than copying their content.
- Currency totals are grouped by ISO code. Voyalier does not invent exchange rates, taxes or affordability.
- A trip route, date or traveler edit causes derived actions to change immediately while retaining the traveler-authored profile and progress history.
- Provider research continues through the existing bounded network seam and rights policy. A provider without approved access stays an external handoff.

## Limits

This decision does not add autonomous booking, account inspection, background scraping, visa submission, fee payment, appointment booking, OCR, thumbnail generation, annotation, or selected-file redaction. Preview uses the installed webview's PDF/image support and has no custom renderer or persistence. The browser and Tauri JSON transports still allocate base64 before the app service validates decoded size; the HTTP route caps the encoded request at 30 MiB, while Tauri relies on the UI's preflight limit plus the service's authoritative decoded limit. Moving large attachments through a native streamed file handle needs a later contract and migration if measured use shows this bound is insufficient.
