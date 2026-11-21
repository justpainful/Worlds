import { describe, expect, it } from "vitest";
import { parseIcs } from "./ics";

describe("iCalendar", () => {
  it("reads timed, all-day and folded events", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:a1",
      "DTSTART;VALUE=DATE:20261205",
      "SUMMARY:Holiday",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:a2",
      "DTSTART:20261206T093000",
      "DTEND:20261206T103000",
      "SUMMARY:Team meeting\\, weekly",
      "LOCATION:Room 4",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:a3",
      "DTSTART;TZID=Asia/Riyadh:20261207T140000",
      "SUMMARY:A long",
      " title",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const ev = parseIcs(ics, "Google");
    expect(ev.map((e) => [e.date, e.start, e.title])).toEqual([
      ["2026-12-05", null, "Holiday"],
      ["2026-12-06", "09:30", "Team meeting, weekly"],
      ["2026-12-07", "14:00", "A longtitle"],
    ]);
    expect(ev[1].end).toBe("10:30");
    expect(ev[1].location).toBe("Room 4");
  });
});
