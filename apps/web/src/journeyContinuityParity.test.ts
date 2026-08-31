import {
  createMockGateway,
  mockBuildCalendarSnapshot,
  mockBuildJourneyBoard,
  mockClassifyAmendment,
  type ConfirmedFact,
  type ConfirmedFactVersion,
  type FlightSegmentPayload,
  type LodgingStayPayload,
} from "@voyalier/contracts";

describe("journey continuity mock parity", () => {
  it("reclassifies the final payload instead of trusting the import-time pointer", async () => {
    const gateway = createMockGateway();
    const detail = await gateway.getTrip("trip_kyoto");
    const current = detail.confirmedFacts.find(
      (fact) => fact.id === "fact_kyoto_outbound",
    )!;

    expect(
      mockClassifyAmendment(current.factType, current.payload, [current]),
    ).toEqual({ kind: "duplicate", factId: current.id });
    expect(
      mockClassifyAmendment(
        current.factType,
        { ...current.payload, confirmationCode: "A DIFFERENT BOOKING" },
        [current],
      ),
    ).toEqual({ kind: "ordinary" });

    await expect(
      gateway.confirmCandidate({
        candidateId: "candidate_kyoto_flight_clean",
        editedPayload: current.payload,
        amendmentAction: "replace",
        expectedAmendmentFactId: current.id,
        expectedAmendmentRevision: 0,
      }),
    ).rejects.toMatchObject({ code: "validation/invalid_input" });

    const ordinaryGateway = createMockGateway();
    await expect(
      ordinaryGateway.confirmCandidate({
        candidateId: "candidate_kyoto_flight_clean",
        editedPayload: {
          ...current.payload,
          confirmationCode: "A DIFFERENT BOOKING",
        },
        amendmentAction: "replace",
        expectedAmendmentFactId: current.id,
        expectedAmendmentRevision: 0,
      }),
    ).rejects.toMatchObject({ code: "validation/invalid_input" });
  });

  it("fails closed without identity and sorts stable ties by opaque locator", async () => {
    const detail = await createMockGateway().getTrip("trip_kyoto");
    const current = detail.confirmedFacts.find(
      (fact) => fact.id === "fact_kyoto_outbound",
    )!;
    expect(() =>
      mockBuildJourneyBoard(detail.trip, [current], [], new Map()),
    ).toThrow(/identity is missing/i);

    const payload = current.payload as FlightSegmentPayload;
    const facts: ConfirmedFact[] = [
      { ...current, id: "fact-z", payload: { ...payload } },
      { ...current, id: "fact-a", payload: { ...payload } },
    ];
    const identities = new Map([
      [
        "confirmed_fact:fact-z",
        {
          calendarLineage: "cal-z",
          focusLocator: "focus-z",
          revision: 0,
          semanticUpdatedAt: current.confirmedAt,
        },
      ],
      [
        "confirmed_fact:fact-a",
        {
          calendarLineage: "cal-a",
          focusLocator: "focus-a",
          revision: 0,
          semanticUpdatedAt: current.confirmedAt,
        },
      ],
    ]);
    const board = mockBuildJourneyBoard(detail.trip, facts, [], identities);
    expect(
      board.days
        .flatMap((day) => day.entries)
        .filter((entry) => entry.kind === "flight_departure")
        .map((entry) => entry.focusLocator),
    ).toEqual(["focus-a", "focus-z"]);
  });

  it("matches role transitions and includes lodging address in both roles", async () => {
    const trip = (await createMockGateway().getTrip("trip_kyoto")).trip;
    const base: ConfirmedFact = {
      id: "stay-current",
      tripId: trip.id,
      factType: "lodging_stay",
      payload: {
        propertyName: "Paper House",
        address: "1 Old Street",
        checkinDate: "2026-11-04",
        checkoutDate: "2026-11-06",
      },
      method: "manual",
      candidateId: null,
      correctedFields: [],
      confirmedAt: "2026-01-01T00:00:00Z",
      sourceRemoved: false,
    };
    const version = (
      fact: ConfirmedFact,
      revision: number,
      active: boolean,
    ): ConfirmedFactVersion => ({
      ...fact,
      id: active ? "stay-current" : `stay-history-${revision}`,
      active,
      revision,
      reason: revision === 0 ? "initial" : "amendment",
      lineageRootId: "stay-current",
    });
    const removed: ConfirmedFact = {
      ...base,
      payload: {
        ...(base.payload as LodgingStayPayload),
        checkoutDate: undefined,
      },
      confirmedAt: "2026-01-02T00:00:00Z",
    };
    const restored: ConfirmedFact = {
      ...base,
      payload: {
        ...(base.payload as LodgingStayPayload),
        address: "2 New Street",
      },
      confirmedAt: "2026-01-03T00:00:00Z",
    };
    const identities = new Map([
      [
        "confirmed_fact:stay-current",
        {
          calendarLineage: "cal-stay",
          focusLocator: "focus-stay",
          revision: 0,
          semanticUpdatedAt: base.confirmedAt,
        },
      ],
    ]);
    const snapshot = mockBuildCalendarSnapshot(
      trip,
      [restored],
      [],
      identities,
      [
        version(base, 0, false),
        version(removed, 1, false),
        version(restored, 2, true),
      ],
    );
    const checkin = snapshot.events.find((event) => event.role === "checkin")!;
    const checkout = snapshot.events.find(
      (event) => event.role === "checkout",
    )!;
    expect(checkin.sequence).toBe(1);
    expect(checkout.sequence).toBe(1);
    expect(checkin.detail).toBe("2 New Street");
    expect(checkout.detail).toBe("2 New Street");
  });

  it("shares one bounded projection budget across many long stays", async () => {
    const fixture = (await createMockGateway().getTrip("trip_kyoto")).trip;
    const trip = {
      ...fixture,
      startDate: "1900-01-01",
      endDate: "9999-12-31",
    };
    const facts = Array.from({ length: 10 }, (_, index): ConfirmedFact => ({
      id: `stay-${index}`,
      tripId: trip.id,
      factType: "lodging_stay",
      payload: {
        propertyName: `Stay ${index}`,
        checkinDate: "1900-01-01",
        checkoutDate: "9999-12-31",
      },
      method: "manual",
      candidateId: null,
      correctedFields: [],
      confirmedAt: "2026-01-01T00:00:00Z",
      sourceRemoved: false,
    }));
    const identities = new Map(
      facts.map((fact) => [
        `confirmed_fact:${fact.id}`,
        {
          calendarLineage: `cal-${fact.id}`,
          focusLocator: `focus-${fact.id}`,
          revision: 0,
          semanticUpdatedAt: fact.confirmedAt,
        },
      ]),
    );
    const board = mockBuildJourneyBoard(trip, facts, [], identities);
    const total =
      board.before.length +
      board.after.length +
      board.unscheduled.length +
      board.days.reduce((sum, day) => sum + day.entries.length, 0);
    expect(board.truncated).toBe(true);
    expect(total).toBe(2_000);
  });
});
