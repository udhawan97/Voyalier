# Prepare a traveler-owned packing checklist

Status: ready for implementation

## Trigger

The traveler opens preparation, adds a weather- or itinerary-derived suggestion,
writes a custom item, checks or unchecks an item, renames it, or removes it.

## Outcome

The traveler turns transparent suggestions into a durable personal checklist
without Voyalier silently deciding what they will pack.

## Confirmed behavior

- Existing deterministic packing suggestions remain computed from confirmed
  facts, climate, UV, air quality, and trip duration.
- Suggestions appear in a separate **Suggested** group with their existing
  checkable reason. They are never checklist entries automatically.
- **Add to checklist** creates a traveler-owned item carrying the suggestion code
  as optional provenance. Adding the same current suggestion twice is idempotent.
- Custom items require a non-empty bounded label.
- Checklist items can be checked, unchecked, renamed, and removed. Ordering is
  stable: unchecked before checked, then creation order within each group.
- A later weather fetch or trip edit may change the suggestions but never
  rewrites, checks, or deletes an existing item.
- Labels are sealed at rest, included in encrypted workspace backups, and
  excluded from AI prompts and the shared brief.
- The checklist works completely offline after its items exist.

## Boundaries

- Suggestions are planning texture, not medical, legal, safety, or airline
  requirements.
- No model generates or edits checklist items.
- Checking an item never changes readiness; readiness concerns plan completeness,
  not whether the traveler packed socks.

## Checkpoint

Adding a suggestion or custom label is the checkpoint that creates durable
state. Removing an item uses the established deliberate-delete interaction.

## Verification

- Core tests cover validation, ordering, and idempotent suggestion identity.
- `AppService` tests mutation/readback, restart, trip deletion, vault sealing,
  and backup/restore through public interfaces plus integrity-only storage checks.
- React tests cover keyboard entry, live announcements, checked state, reasons,
  and the separation between Suggested and Checklist.
- The browser workflow proves that weather refresh cannot delete an accepted item.

## Definition of done

The checklist is durable, explicit, offline, accessible, encrypted where
appropriate, backed up, and insulated from later suggestion changes.
