import type { Destination, RunStatus, Trigger } from "./types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function time12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function describeTrigger(t: Trigger | undefined): string {
  if (!t) return "No schedule";
  switch (t.kind) {
    case "once":
      return new Date(t.at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    case "daily":
      return `Every day at ${time12(t.time)}`;
    case "weekly": {
      const days = [...t.days].sort();
      const label =
        days.length === 7 ? "Every day" : days.join(",") === "1,2,3,4,5" ? "Weekdays" : days.join(",") === "0,6" ? "Weekends" : days.map((d) => DAYS[d]).join(", ");
      return `${label} at ${time12(t.time)}`;
    }
    case "monthly":
      return `Monthly on day ${t.day} at ${time12(t.time)}`;
    case "manual":
      return "Run manually";
  }
}

export function describeDestination(d: Destination | null | undefined): string {
  if (!d) return "No destination";
  const label = d.label || d.id;
  switch (d.kind) {
    case "channel":
      return label.startsWith("#") ? label : `#${label}`;
    case "thread":
      return `Thread · ${label}`;
    case "dm":
      return `DM · ${label}`;
    case "edit":
      return "Edit previous message";
  }
}

export const STATUS_LABEL: Record<RunStatus, string> = {
  scheduled: "Scheduled",
  running: "Running",
  waiting: "Awaiting approval",
  succeeded: "Succeeded",
  failed: "Failed",
  skipped: "Skipped",
  cancelled: "Cancelled",
};
