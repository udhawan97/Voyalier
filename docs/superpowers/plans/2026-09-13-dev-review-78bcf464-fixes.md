# Plan: Dev Review run 78bcf464 selected fixes

Base: `b24e226`, HEAD at start: `19d2c55`. Mode: Audit and improve. Selected by the user
("implement it all and merge") = all eligible Fix candidates from run `20260913T080635Z-78bcf464`,
plus DR-010 as an ADR (user chose "keep fallback, record ADR") and DR-005 as the small mitigation
("small mitigation now").

## Slices (layered commit order)

1. **App — DR-004** `service_attachments.rs`: reject `content_base64` longer than the largest
   base64 a 20 MiB file can produce (`MAX_ATTACHMENT_BYTES.div_ceil(3)*4`) _before_ base64-decoding,
   so a Tauri caller bypassing the UI preflight cannot peak memory decoding an oversized payload.
   The HTTP route separately caps the request body at 30 MiB. Test: oversized (invalid-base64)
   payload rejected with `DocumentTooLarge` before decode, via the public API.

2. **Contract — DR-003** align `mock.ts` derivation to `concierge.rs`. Two drifts fixed: (a)
   compare-stay no-dates reason text; (b) preparation document-requirement id space
   (`${travelerId}-${suffix}` in core vs `${stepId}-document-N` in mock). **Delivered:** both
   values realigned (all 8 suffixes matched to core), verified by the existing mock-backed suites.
   **Follow-up (NOT in this change):** a shared `concierge-derivation.json` golden asserted from
   both `crates/voyalier-core/src/tests.rs` and `apps/web/src/parity.test.ts` — the values match
   now, but no automated guard yet fails on future re-drift.

3. **Web — DR-005 (mitigation)** wrap the concierge cockpit + guide roots in `lang="en"` so English
   copy is not served under `<html lang="es">` (WCAG 3.1.2). Full i18n is a follow-up.

4. **Web — DR-006** move `id="concierge-people"` from SetupPanel to PeoplePanel (nav target fix);
   give SetupPanel `id="concierge-setup"`.

5. **Web — DR-007** dedupe provider handoffs by `providerActionId` in `saveHandoff` so repeat
   "Prepare X" clicks reuse the existing handoff instead of appending duplicates.

6. **Desktop — DR-001 (P1)** add `blob:` to `img-src` and add `frame-src 'self' blob:` in
   `tauri.conf.json` CSP so attachment previews (blob: object URLs) render on the packaged webview.
   Iframe stays `sandbox=""`. **Owes packaged-app runtime verification before the v0.12.0 desktop
   release.**

7. **Desktop — DR-002 (P1, partial)** replace the `open_default().expect(...)` startup panic with a
   graceful path: structured diagnostic + clean exit instead of an opaque crash. Full in-window
   recovery dialog remains owed and must be verified on the packaged app. Status: Partially resolved.

8. **Docs — DR-010** ADR-0025 recording the decision to keep the ADR-0007 plaintext fallback for
   structured PII (concierge profile + visa nationality), consistent across both, rather than
   gating them like binary attachments.

## Not in this change

- DR-008 (per-currency total > MAX_SAFE_INTEGER): Deferred, not reachable with realistic data.
- DR-009 (sandbox="" PDF paint): Research, needs packaged-app runtime verification.

## Gate

`make check` (web + rust + desktop), then a fresh peer review of the diff, then the council-review
two-round gate on the final tree + report, then merge per user authority. DR-001/DR-002 acceptance
on the packaged desktop app is explicitly owed and recorded as a follow-up.
