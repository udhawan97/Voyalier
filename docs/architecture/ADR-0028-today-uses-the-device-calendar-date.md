# ADR-0028: Today uses the device calendar date

Status: accepted, 2026-10-08

Extends ADR-0012. Addresses DR-ea305767-012; the traveler chose device-local date.

## Decision

Current UI callers send their device-local `YYYY-MM-DD` through the additive
`getToday(tripId, referenceDate?)` contract. HTTP uses the optional `referenceDate`
query key; Tauri uses that optional key in its sole `input` envelope. Core
validates strict shape and a real calendar date before projecting the result.
The response records the exact reference date used.

Today compares floating event dates to that calendar date. It does not infer a
destination time zone, convert a confirmation's local time to an instant, or
claim that a device date establishes when an event occurs in another zone.

The UI refreshes on local midnight and visible resume/focus, recomputes after
clock or zone changes, and cleans up its listeners/timers. A previous-day
retained response is shown as updating until the current date's response lands.

## Compatibility

Older callers omitting the date keep the service's existing UTC-date fallback.
The mock keeps its deterministic fixture-date fallback when omitted. Current UI
callers always supply the device date. Invalid supplied dates fail rather than
silently using either fallback. No storage or API version change is needed.

## Verification

Pin explicit dates through HTTP, Tauri and the mock; validate leap days and
malformed/impossible dates; preserve omitted requests; exercise UTC/device-day
differences, midnight, daylight-saving transitions, hidden/resume and zone
changes with controlled clocks. Existing source labels and floating-date
projections retain their authority and lineage.
