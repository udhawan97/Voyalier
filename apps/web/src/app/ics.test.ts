import type { CalendarEvent, CalendarSnapshot } from "@voyalier/contracts";

import { buildIcs, icsFilename } from "./ics";

const labels = {
  summary: (event: CalendarEvent) => event.subject ?? event.title,
  description: "Exported from Voyalier.",
};

function snapshot(overrides: Partial<CalendarSnapshot> = {}): CalendarSnapshot {
  return {
    title: "Kyoto autumn journey",
    events: [
      {
        uid: "cal_flight:departure@voyalier.local",
        sequence: 2,
        dtstamp: "2026-07-10T12:00:00Z",
        role: "departure",
        kind: "flight_departure",
        subject: "Fictional Pacific FP18",
        title: "Departure",
        detail: "ORD → NRT",
        start: "2026-11-03T11:20",
        allDay: false,
      },
      {
        uid: "cal_stay:checkin@voyalier.local",
        sequence: 0,
        dtstamp: "2026-07-10T12:00:00Z",
        role: "checkin",
        kind: "checkin",
        subject: "River Paper Inn",
        title: "Check in",
        detail: "9 Fictional Street, Kyoto",
        start: "2026-11-04",
        allDay: true,
      },
    ],
    omissions: [],
    removals: [],
    ...overrides,
  };
}

describe("calendar export", () => {
  it("writes stable identities, revisions, CRLF, and floating times", () => {
    const ics = buildIcs(snapshot(), labels);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(/[^\r]\n/.test(ics)).toBe(false);
    expect(ics).toContain("UID:cal_flight:departure@voyalier.local");
    expect(ics).toContain("SEQUENCE:2");
    expect(ics).toContain("DTSTART:20261103T112000");
    expect(ics).not.toContain("DTSTART:20261103T112000Z");
    expect(ics).not.toContain("TZID");
  });

  it("writes each all-day role as its recorded date", () => {
    const ics = buildIcs(snapshot(), labels);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261104");
    expect(ics).toContain("DTEND;VALUE=DATE:20261105");
  });

  it("includes surface and authored events without private fields", () => {
    const ics = buildIcs(
      snapshot({
        events: [
          {
            uid: "cal_rail:arrival@voyalier.local",
            sequence: 1,
            dtstamp: "2026-07-10T12:00:00Z",
            role: "arrival",
            kind: "journey_arrival",
            subject: "Fictional Rail NX41",
            title: "Arrival",
            detail: "Haneda → Kyoto",
            start: "2026-11-04T19:20",
            allDay: false,
          },
          {
            uid: "cal_plan:plan@voyalier.local",
            sequence: 4,
            dtstamp: "2026-07-10T12:00:00Z",
            role: "plan",
            kind: "activity",
            title: "Tea ceremony",
            detail: "Gion",
            start: "2026-11-05T15:00:30",
            end: "2026-11-05T16:00",
            allDay: false,
          },
        ],
      }),
      labels,
    );
    expect(ics).toContain("SUMMARY:Fictional Rail NX41");
    expect(ics).toContain("SUMMARY:Tea ceremony");
    expect(ics).toContain("DTSTART:20261105T150030");
    expect(ics).not.toMatch(
      /confirmationCode|passengerName|guestName|PRIVATE/i,
    );
  });

  it("escapes injection text and folds long UTF-8 lines", () => {
    const event = {
      ...snapshot().events[0],
      subject: `旅`.repeat(100) + ";Best,\\Place\nInjected",
    };
    const ics = buildIcs(snapshot({ events: [event] }), labels);
    expect(ics).toContain("\\;Best\\,\\\\Place\\nInjected");
    const encoder = new TextEncoder();
    for (const line of ics.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(ics).toContain("\r\n ");
  });

  it("is byte-repeatable for the same snapshot", () => {
    expect(buildIcs(snapshot(), labels)).toBe(buildIcs(snapshot(), labels));
  });

  it("derives a safe filename", () => {
    expect(icsFilename("Kyoto autumn journey")).toBe(
      "kyoto-autumn-journey.ics",
    );
    expect(icsFilename("???")).toBe("trip.ics");
  });
});
