/** iCalendar reading, with no app code, so tests and other tools can use it. */

export interface ExternalEvent {
  uid: string;
  title: string;
  date: string;
  start: string | null;
  end: string | null;
  location: string;
  calendar: string;
}

const unfold = (ics: string) => ics.replace(/\r?\n[ \t]/g, "");
const unescape = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseWhen(value: string, params: string): { date: string; time: string | null } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  if (!m[4] || /VALUE=DATE(?!-)/i.test(params)) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: null };
  const d = m[7] ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return { date: isoDay(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** The events in an iCalendar file. Repeating events show their first date only. */
export function parseIcs(ics: string, calendar: string): ExternalEvent[] {
  const out: ExternalEvent[] = [];
  for (const block of unfold(ics).split("BEGIN:VEVENT").slice(1)) {
    const body = block.split("END:VEVENT")[0];
    const get = (name: string) => {
      const m = new RegExp(`^${name}((?:;[^:\\r\\n]*)?):(.*)$`, "mi").exec(body);
      return m ? { params: m[1], value: m[2].trim() } : null;
    };
    const start = get("DTSTART");
    if (!start) continue;
    const s = parseWhen(start.value, start.params);
    if (!s) continue;
    const endRaw = get("DTEND");
    const e = endRaw ? parseWhen(endRaw.value, endRaw.params) : null;
    out.push({
      uid: get("UID")?.value ?? `${calendar}-${out.length}`,
      title: unescape(get("SUMMARY")?.value ?? ""),
      date: s.date,
      start: s.time,
      end: e?.time ?? null,
      location: unescape(get("LOCATION")?.value ?? ""),
      calendar,
    });
  }
  return out;
}

