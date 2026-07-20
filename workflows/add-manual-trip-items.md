# Add manual activities and transfers

Status: ready for implementation

## Trigger

The traveler adds, edits, or removes an activity, rail journey, or transfer, or
promotes a saved place into the trip-item form.

## Outcome

The trip can represent important plans beyond flights and lodging without
pretending those plans came from imported evidence or a live booking provider.

## Confirmed behavior

- `TripItem` has one of three kinds: activity, rail, or transfer.
- Required: bounded title. Optional: location, local start, local end, and notes.
  Start/end use the trip's local-wall-clock convention; if both exist, end must
  not precede start.
- A saved-place promotion prefills title and location and retains an optional
  saved-place link. Submission is still required.
- Trip items appear in the itinerary, Today, local calendar export, printable
  brief preview, and workspace search. Notes appear only inside the workspace.
- Deterministic notices flag time overlap between trip items and confirmed
  flights, and between two trip items. Notices never block saving or clear/
  worsen readiness by themselves.
- Editing or deleting a trip item updates those projections immediately.
- All traveler-authored text is sealed, included in backup/restore, and removed
  when its trip is deleted.

## Boundaries

- Trip items are plans, not reservations, tickets, availability, or provider
  confirmations. The UI labels them **Planned by you**.
- This release is manual-first. Parsers and AI do not create trip items.
- Notes are excluded from brief, calendar, and AI payloads. Title, location, and
  time are included only in the visible export preview the traveler initiates.
- No route optimization, live transit status, booking, or price data is added.

## Checkpoint

Submitting the form creates or changes a trip item. Export previews remain the
late checkpoint before anything is printed, saved, or handed to a calendar.

## Verification

- Core tests cover validation, stable ordering, Today projection, export-safe
  projection, and literal overlap cases.
- `AppService` tests CRUD, source-link survival, deletion, restart, vault, and
  backup/restore through public methods.
- All transports and the mock satisfy route parity.
- React tests cover dialog keyboard behavior, errors, edit/delete, source labels,
  Today, brief, and calendar results.
- The browser workflow creates an item and observes it in Today and an export.

## Definition of done

Activities, rail journeys, and transfers are durable traveler-owned plans with
honest labels, deterministic projections, safe exports, complete transports,
and no provider or parser ambiguity.
