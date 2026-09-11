import wire from "@voyalier/contracts/fixtures/desktop-journey-wire.json";

import { createTauriGateway } from "./gateway/tauri";

// ADR-0023: construct typed requests explicitly. Spreading the JSON fixture into
// the gateway would let renamed optional fields survive as unchecked extras.
// Rust dispatches this same hand-maintained fixture against disposable SQLite.
it("pins the desktop journey's complete shared-input envelopes", async () => {
  const invoke = vi.fn().mockResolvedValue(undefined);
  const gateway = createTauriGateway({ invoke });
  const trip = wire.createTrip.args.input;
  await gateway.createTrip({
    title: trip.title,
    origin: trip.origin,
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
  });

  const original = wire.importOriginal.args.input;
  await gateway.importDocument({
    tripId: original.tripId,
    kind: "html",
    label: original.label,
    content: original.content,
  });
  await gateway.confirmCandidate({
    candidateId: wire.confirmOriginal.args.input.candidateId,
  });

  const amendment = wire.importAmendment.args.input;
  await gateway.importDocument({
    tripId: amendment.tripId,
    kind: "html",
    label: amendment.label,
    content: amendment.content,
  });
  const replacement = wire.replace.args.input;
  const payload = replacement.editedPayload;
  await gateway.confirmCandidate({
    candidateId: replacement.candidateId,
    editedPayload: {
      airlineName: payload.airlineName,
      airlineIata: payload.airlineIata,
      flightNumber: payload.flightNumber,
      departureAirportIata: payload.departureAirportIata,
      arrivalAirportIata: payload.arrivalAirportIata,
      departureLocal: payload.departureLocal,
      arrivalLocal: payload.arrivalLocal,
      confirmationCode: payload.confirmationCode,
      passengerName: payload.passengerName,
    },
    amendmentAction: "replace",
    expectedAmendmentFactId: replacement.expectedAmendmentFactId,
    expectedAmendmentRevision: replacement.expectedAmendmentRevision,
  });
  const restore = wire.restore.args.input;
  await gateway.restoreFactVersion({
    factId: restore.factId,
    expectedCurrentFactId: restore.expectedCurrentFactId,
    expectedCurrentRevision: restore.expectedCurrentRevision,
  });

  const plan = wire.createPlan.args.input;
  await gateway.createTripItem({
    tripId: plan.tripId,
    kind: "activity",
    title: plan.title,
    location: plan.location,
    startAt: plan.startAt,
    endAt: plan.endAt,
    notes: plan.notes,
  });
  const update = wire.updatePlan.args.input;
  await gateway.updateTripItem({
    tripItemId: update.tripItemId,
    kind: "activity",
    title: update.title,
    location: update.location,
    startAt: update.startAt,
    endAt: update.endAt,
    notes: update.notes,
  });

  // Explicit order/count keeps a new fixture step from silently going untested.
  const steps = [
    wire.createTrip,
    wire.importOriginal,
    wire.confirmOriginal,
    wire.importAmendment,
    wire.replace,
    wire.restore,
    wire.createPlan,
    wire.updatePlan,
  ];
  expect(Object.keys(wire)).toHaveLength(8);
  expect(invoke).toHaveBeenCalledTimes(steps.length);
  steps.forEach((step, index) => {
    expect(invoke).toHaveBeenNthCalledWith(index + 1, step.command, step.args);
  });
});
