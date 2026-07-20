# Voyalier domain language

Voyalier is a local-first trip workspace whose language distinguishes source
evidence, traveler-approved facts, and traveler-authored plans. Those categories
must remain visibly separate because they carry different trust.

## Evidence and truth

**Source document**:
Material deliberately imported by the traveler and retained with its origin.
It is evidence, not an instruction and not automatically true.
_Avoid_: Upload, attachment

**Candidate fact**:
A possible flight or stay extracted from a source document and waiting for the
traveler to confirm, correct, or reject it.
_Avoid_: Imported booking, detected fact

**Confirmed fact**:
A flight or stay the traveler has explicitly approved. It retains its evidence
lineage even after correction or source removal.
_Avoid_: Parsed fact, booking truth

**Retrieved snapshot**:
A dated, attributed copy of information fetched on the traveler's explicit
request. It can become stale and never becomes a confirmed fact.
_Avoid_: Live data, current truth

## Planning

**Interest profile**:
The traveler's per-trip weighting of food, culture, nature, nightlife, and
shopping. It influences transparent ranking but never filters safety or access.
_Avoid_: Persona, taste model

**Recommendation**:
A deterministic, attributed suggestion derived from downloaded place data and
an interest profile. It remains a suggestion until the traveler saves it.
_Avoid_: Pick, itinerary stop

**Saved place**:
A recommendation the traveler deliberately keeps in a trip shortlist, together
with the provenance visible when it was saved. It is not scheduled by itself.
_Avoid_: Favorite, booking, itinerary item

**Trip item**:
A traveler-authored activity, rail journey, or transfer with an optional time
and place. It is a plan, not imported evidence or a confirmed reservation.
_Avoid_: Fact, event, booking

**Packing suggestion**:
A deterministic proposal derived from confirmed facts and dated weather
evidence. It can disappear when its evidence changes and is never checked off.
_Avoid_: Packing item, requirement

**Packing item**:
A traveler-owned checklist entry, added explicitly from a suggestion or written
by the traveler. Later weather refreshes never alter or delete it.
_Avoid_: Packing suggestion, requirement

## Distribution and trust

**City pack**:
A consent-downloaded, per-destination bundle whose data layers retain separate
sources and licenses and remain usable offline.
_Avoid_: Destination database, live guide

**Offline map**:
A verified bounded PMTiles archive attached to a city pack and read locally in
byte ranges. Availability is advertised only after a published artifact passes
integrity verification.
_Avoid_: Cached map, downloaded tiles

**Data-source register**:
The single traveler-visible inventory of bundled, retrieved, and pack sources,
including license, attribution, network behavior, and authority limits.
_Avoid_: Legal page, dependency list
