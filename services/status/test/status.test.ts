import { describe, expect, it } from "vitest";
import { bars, type Check, dayOf, DAYS, incidents, overall, probe, SERVICES, stateOf, uptime } from "../src/checks";
import { duration, render } from "../src/page";

const check = (ok: number, ms = 200, at = 0): Check => ({ service: "app", at, ok, ms, code: ok ? 200 : 500 });

describe("state", () => {
  it("reads the latest two checks", () => {
    expect(stateOf([])).toBe("unknown");
    expect(stateOf([check(1)])).toBe("up");
    expect(stateOf([check(1, 4000)])).toBe("slow");
    expect(stateOf([check(0), check(1)])).toBe("degraded");
    expect(stateOf([check(0)])).toBe("degraded");
    expect(stateOf([check(0), check(0)])).toBe("down");
  });

  it("puts the worst state on top", () => {
    expect(overall(["up", "slow", "up"])).toBe("slow");
    expect(overall(["up", "degraded", "down"])).toBe("down");
    expect(overall(["unknown", "unknown"])).toBe("unknown");
    expect(overall(["up", "unknown"])).toBe("up");
  });
});

describe("days", () => {
  it("counts days in Riyadh time", () => {
    const utc2130 = Date.UTC(2026, 10, 21, 21, 30) / 1000;
    expect(dayOf(utc2130)).toBe(dayOf(Date.UTC(2026, 10, 22, 6) / 1000));
  });

  it("draws one bar a day with a level for each share of passed checks", () => {
    const today = 20000;
    const rows = [
      { service: "app", day: today, n: 288, up: 288 },
      { service: "app", day: today - 1, n: 288, up: 280 },
      { service: "app", day: today - 2, n: 288, up: 100 },
      { service: "demo", day: today, n: 10, up: 0 },
    ];
    const b = bars(rows, "app", today);
    expect(b).toHaveLength(DAYS);
    expect(b.at(-1)!.level).toBe("full");
    expect(b.at(-2)!.level).toBe("partial");
    expect(b.at(-3)!.level).toBe("bad");
    expect(b[0].level).toBe("none");
    expect(uptime(rows, "app")).toBeCloseTo(668 / 864);
    expect(uptime(rows, "nothing")).toBeNull();
  });
});

describe("incidents", () => {
  it("joins failures a check apart and needs two in a row", () => {
    const f = [
      { service: "app", at: 1000 },
      { service: "app", at: 1300 },
      { service: "app", at: 1600 },
      { service: "app", at: 9000 },
      { service: "login", at: 5000 },
      { service: "login", at: 5300 },
    ];
    const out = incidents(f, { app: 9300, login: 5300 });
    expect(out).toHaveLength(2);
    expect(out.find((i) => i.service === "app")).toMatchObject({ from: 1000, to: 1600, checks: 3, ongoing: false });
    expect(out.find((i) => i.service === "login")).toMatchObject({ ongoing: true });
  });
});

describe("probe", () => {
  const svc = (id: string) => SERVICES.find((s) => s.id === id)!;

  it("accepts a page, a json ok and a redirect, and refuses the rest", async () => {
    const html = async () => new Response("<p>hi</p>", { headers: { "content-type": "text/html" } });
    expect((await probe(svc("app"), html)).ok).toBe(1);
    expect((await probe(svc("login"), async () => Response.json({ ok: true }))).ok).toBe(1);
    expect((await probe(svc("login"), async () => Response.json({ ok: false }))).ok).toBe(0);
    expect((await probe(svc("downloads"), async () => new Response(null, { status: 302, headers: { location: "/x" } }))).ok).toBe(1);
    expect((await probe(svc("app"), async () => new Response("down", { status: 503 }))).ok).toBe(0);
    const failed = await probe(svc("app"), async () => { throw new Error("no route"); });
    expect(failed).toMatchObject({ ok: 0, code: 0 });
  });
});

describe("page", () => {
  it("writes durations in both languages", () => {
    expect(duration(600, "ar")).toBe("10 دقائق");
    expect(duration(3900, "ar")).toBe("ساعة واحدة و5 دقائق");
    expect(duration(7200, "ar")).toBe("ساعتين");
    expect(duration(120, "en")).toBe("2 minutes");
  });

  it("draws every service with its state and no scripts", () => {
    const data = {
      overall: "degraded" as const,
      lastAt: Date.UTC(2026, 10, 21, 12) / 1000,
      services: SERVICES.map((s) => ({ svc: s, state: s.id === "demo" ? ("degraded" as const) : ("up" as const), ms: 120, uptime: 0.999, bars: bars([], s.id, 20000) })),
      incidents: [{ service: "demo", from: Date.UTC(2026, 10, 20, 9) / 1000, to: Date.UTC(2026, 10, 20, 9, 10) / 1000, ongoing: false, checks: 3 }],
    };
    const ar = render(data, "ar");
    expect(ar).toContain('dir="rtl"');
    expect(ar).toContain("بعض خدمات Worlds متقطعة");
    expect(ar).toContain("النسخة التجريبية: انقطعت");
    expect(ar).toContain("15 دقيقة");
    expect(ar.match(/class="svc /g)).toHaveLength(SERVICES.length);
    expect(ar).not.toMatch(/<script|style="/);
    const en = render(data, "en");
    expect(en).toContain("Some Worlds services are intermittent");
    expect(en).toContain("15:00");
    expect(/[–—]/.test(ar + en)).toBe(false);
  });
});
