import type { CalendarEvent, CalendarSnapshot } from "@voyalier/contracts";

/** RFC 5545 §3.3.11 text escaping. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function dateValue(date: string): string {
  return date.replace(/-/g, "");
}

/** Floating wall clock: deliberately no Z and no TZID. */
function dateTimeValue(local: string): string {
  const [date, time] = local.split("T");
  const [hour = "00", minute = "00", second = "00"] = (time ?? "").split(":");
  return `${dateValue(date)}T${hour}${minute}${second}`;
}

function stampValue(instant: string): string {
  const parsed = new Date(instant);
  const safe = Number.isNaN(parsed.valueOf())
    ? new Date("1970-01-01T00:00:00Z")
    : parsed;
  return safe
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function nextDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

/** RFC 5545 §3.1 folds at 75 UTF-8 octets. */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
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

export interface IcsLabels {
  summary: (event: CalendarEvent) => string;
  description: string;
}

/** Render the already-redacted core snapshot without reading a clock. */
export function buildIcs(
  snapshot: CalendarSnapshot,
  labels: IcsLabels,
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Voyalier//Trip export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(snapshot.title)}`,
  ];
  for (const item of snapshot.events) {
    const timing = item.allDay
      ? [
          `DTSTART;VALUE=DATE:${dateValue(item.start)}`,
          `DTEND;VALUE=DATE:${dateValue(nextDay(item.start))}`,
        ]
      : [
          `DTSTART:${dateTimeValue(item.start)}`,
          ...(item.end ? [`DTEND:${dateTimeValue(item.end)}`] : []),
        ];
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeText(item.uid)}`,
      `SEQUENCE:${item.sequence}`,
      `DTSTAMP:${stampValue(item.dtstamp)}`,
      ...timing,
      `SUMMARY:${escapeText(labels.summary(item))}`,
      ...(item.detail ? [`LOCATION:${escapeText(item.detail)}`] : []),
      `DESCRIPTION:${escapeText(labels.description)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

export function icsFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "trip"}.ics`;
}
