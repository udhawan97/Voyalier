import type { TripBrief } from "@voyalier/contracts";

/**
 * Build an iCalendar file from a trip's redacted brief.
 *
 * Two decisions worth stating plainly:
 *
 * **It is built from the brief, not from the raw facts.** The brief is assembled
 * in the Rust core by excluding confirmation codes and traveler names at
 * generation time, so they cannot reach this file — the same guarantee the
 * "Share brief" flow relies on, rather than a second filter re-implemented here
 * and able to drift. That matters because a .ics is usually imported straight
 * into a cloud calendar.
 *
 * **Times are floating, never zoned.** A confirmed flight carries a wall-clock
 * time ("2026-11-03T11:20") with no timezone, because that is what the
 * confirmation said. Voyalier does not invent one, so these events are written
 * without TZID or a trailing Z: calendars read them as local time wherever the
 * reader is. For travel that is a real limitation, and the UI says so rather
 * than guessing an offset and being confidently wrong.
 */

/** RFC 5545 §3.3.11: escape backslash, semicolon, comma, and newline. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** "2026-11-03" → "20261103" */
function dateValue(date: string): string {
  return date.replace(/-/g, "");
}

/** "2026-11-03T11:20[:30]" → "20261103T1120[30]" (floating: no Z, no TZID). */
function dateTimeValue(local: string): string {
  const [date, time] = local.split("T");
  const [hour = "00", minute = "00", second = "00"] = (time ?? "").split(":");
  return `${dateValue(date)}T${hour}${minute}${second}`;
}

/**
 * All-day DTEND is exclusive. A guest is still at the hotel on checkout morning,
 * so the block should cover check-in through checkout inclusive — which means
 * writing the day after checkout.
 */
function nextDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

/**
 * RFC 5545 §3.1: lines are folded at 75 octets, continuations start with a
 * space. Folding counts octets, not characters, so a multi-byte name is measured
 * by its UTF-8 length — otherwise a line of CJK text would exceed the limit
 * while looking short.
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // 75 for the first line; continuations spend one octet on the leading space.
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  if (current) parts.push(current);
  return parts.join("\r\n ");
}

function event(uid: string, stamp: string, lines: string[]): string[] {
  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    ...lines,
    "END:VEVENT",
  ];
}

export interface IcsLabels {
  /** e.g. "Flight {flight}" already interpolated by the caller. */
  flightSummary: (flight: string) => string;
  staySummary: (property: string) => string;
  /** Shown in the event body, explaining the floating-time caveat. */
  description: string;
}

/**
 * Render a brief as an iCalendar document. `generatedAt` comes from the brief so
 * this stays pure and testable — no clock reads here.
 */
export function buildIcs(brief: TripBrief, labels: IcsLabels): string {
  const stamp = `${dateTimeValue(brief.generatedAt.slice(0, 16))}Z`;
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Voyalier//Trip export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(brief.title)}`,
  ];

  brief.flights.forEach((flight, index) => {
    // A flight with no departure time cannot be an event; skip it rather than
    // invent a time. It stays visible in the Blueprint.
    if (!flight.departureLocal) return;
    const number = flight.flightNumber ?? "";
    const route = [flight.departureAirportIata, flight.arrivalAirportIata]
      .filter(Boolean)
      .join(" → ");
    lines.push(
      ...event(
        `voyalier-flight-${index}-${dateValue(brief.startDate)}@voyalier.local`,
        stamp,
        [
          `DTSTART:${dateTimeValue(flight.departureLocal)}`,
          ...(flight.arrivalLocal
            ? [`DTEND:${dateTimeValue(flight.arrivalLocal)}`]
            : []),
          `SUMMARY:${escapeText(labels.flightSummary([flight.airlineName, number].filter(Boolean).join(" ") || route))}`,
          ...(route ? [`LOCATION:${escapeText(route)}`] : []),
          `DESCRIPTION:${escapeText(labels.description)}`,
        ],
      ),
    );
  });

  brief.stays.forEach((stay, index) => {
    if (!stay.checkinDate || !stay.checkoutDate) return;
    lines.push(
      ...event(
        `voyalier-stay-${index}-${dateValue(brief.startDate)}@voyalier.local`,
        stamp,
        [
          `DTSTART;VALUE=DATE:${dateValue(stay.checkinDate)}`,
          `DTEND;VALUE=DATE:${dateValue(nextDay(stay.checkoutDate))}`,
          `SUMMARY:${escapeText(labels.staySummary(stay.propertyName ?? ""))}`,
          ...(stay.address ? [`LOCATION:${escapeText(stay.address)}`] : []),
          `DESCRIPTION:${escapeText(labels.description)}`,
        ],
      ),
    );
  });

  brief.tripItems.forEach((item, index) => {
    // An unscheduled idea remains in the printable brief but cannot become a
    // calendar event without inventing a date or time.
    if (!item.startAt) return;
    lines.push(
      ...event(
        `voyalier-plan-${index}-${dateValue(brief.startDate)}@voyalier.local`,
        stamp,
        [
          `DTSTART:${dateTimeValue(item.startAt)}`,
          ...(item.endAt ? [`DTEND:${dateTimeValue(item.endAt)}`] : []),
          `SUMMARY:${escapeText(item.title)}`,
          ...(item.location ? [`LOCATION:${escapeText(item.location)}`] : []),
          `DESCRIPTION:${escapeText(labels.description)}`,
        ],
      ),
    );
  });

  lines.push("END:VCALENDAR");
  // RFC 5545 requires CRLF line endings.
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** A filesystem-safe name derived from the trip title. */
export function icsFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "trip"}.ics`;
}
