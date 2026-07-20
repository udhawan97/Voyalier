# Save discoveries for a trip

Status: ready for implementation

## Trigger

The traveler asks Voyalier for deterministic recommendations from a downloaded
city pack, changes their interest weights, saves a recommendation, edits its
note, removes it, or promotes it into a scheduled trip item.

## Outcome

The traveler has a durable, offline shortlist whose places retain their original
pack provenance and whose interest profile survives restarts, backups, and use
through either transport.

## Confirmed behavior

- The five existing interest weights become a persisted per-trip interest
  profile. A new trip starts Balanced at `0.5` for every weight.
- Moving a weight saves deliberately through one **Save interests** action; it
  does not write on every slider movement.
- Recommendation scoring remains deterministic and uses the saved profile unless
  the traveler is currently previewing unsaved slider changes.
- **Save place** copies the recommendation's name, pack id, category, dimension,
  coordinates, source, license, score reasons, and wildcard flag into the
  shortlist. Saving the same pack/place/coordinates twice is idempotent.
- A saved place may carry an optional traveler note. Notes are sealed at rest,
  included in encrypted workspace backups, and excluded from AI and sharing.
- Removing a downloaded pack does not remove saved places. Their captured source
  and license remain visible; the UI says the source pack is no longer stored.
- **Plan this place** opens the manual trip-item form prefilled with the place's
  name and location. Nothing is scheduled until that form is submitted.
- Removing a saved place does not remove a trip item previously created from it.
  The traveler authored that plan and owns it independently.

## Boundaries

- Saving is not booking, confirmation, endorsement, or proof of opening hours,
  availability, price, accessibility, or safety.
- Recommendation output never writes durable state without the traveler clicking
  a mutation control.
- Saved-place notes never enter the brief, calendar export, or AI payload.
- Shortlist mutations remain entirely local and trigger no network request.

## Checkpoint

The save, remove, note-save, and promotion controls are the checkpoints. No
additional confirmation is needed for save; remove uses the repository's
reversible/two-step control pattern where appropriate.

## Verification

- Core validation tests use literal accepted/rejected examples.
- `AppService` tests save, reload, deduplicate, edit, delete, remove the source
  pack, and restore a backup through public methods.
- Contract, route-parity, mock, HTTP, and Tauri surfaces expose the same methods.
- React tests exercise the shortlist using roles and visible text.
- The browser workflow proves save → restart/reload → promote without reaching
  into storage.

## Definition of done

An implementer can build the workflow without another product decision; saved
places and interests are durable, offline, provenance-preserving, accessible,
backed up, tested through confirmed seams, documented, and release-ready.
