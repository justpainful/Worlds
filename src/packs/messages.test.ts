import { describe, expect, it } from "vitest";
import type { PageMeta } from "../lib/types";
import { FREELANCE } from "./definitions/freelance";
import { SHOP } from "./definitions/shop";
import { TEACHER } from "./definitions/teacher";
import { draftMessage, messageOffered, messageUrl, whatsappNumber } from "./messages";
import { PACK_DEFS } from "./registry";

const page = (id: string, kind: string, title: string, data: Record<string, unknown>) => ({ id, kind, title, data }) as unknown as PageMeta;

describe("messages to people outside Worlds", () => {
  it("writes phone numbers the way WhatsApp wants them", () => {
    expect(whatsappNumber("0551234567")).toBe("966551234567");
    expect(whatsappNumber("+966 55 123 4567")).toBe("966551234567");
    expect(whatsappNumber("00966551234567")).toBe("966551234567");
    expect(whatsappNumber("\u0660\u0665\u0665\u0661\u0662\u0663\u0664\u0665\u0666\u0667")).toBe("966551234567");
    expect(whatsappNumber("call me")).toBe("");
  });

  it("fills a note to a parent from the absence and the student it links to", () => {
    const kind = TEACHER.kinds.find((k) => k.id === "attendance")!;
    const m = kind.messages![0];
    const student = page("s1", "teacher.student", "Sara Ali", { guardian: "Mr Ali", guardianPhone: "0551234567" });
    const absence = page("a1", "teacher.attendance", "Sara Ali, 2026-11-12", { student: "s1", date: "2026-11-12", status: "absent", parentTold: false });
    expect(messageOffered(m, absence.data as Record<string, unknown>)).toBe(true);
    expect(messageOffered(m, { ...(absence.data as object), parentTold: true })).toBe(false);
    expect(messageOffered(m, { ...(absence.data as object), status: "present" })).toBe(false);
    const d = draftMessage(m, TEACHER, kind, absence, { s1: student, a1: absence }, "en")!;
    expect(d.channel).toBe("whatsapp");
    expect(d.to).toBe("966551234567");
    expect(d.name).toBe("Mr Ali");
    expect(d.text).toContain("Hello, Mr Ali. Sara Ali was absent from class on");
    expect(d.text).not.toMatch(/[{}]/);
    expect(messageUrl(d)).toMatch(/^https:\/\/wa\.me\/966551234567\?text=Hello%2C%20Mr%20Ali/);
    const ar = draftMessage(m, TEACHER, kind, absence, { s1: student, a1: absence }, "ar")!;
    expect(ar.text).toContain("Mr Ali");
    expect(ar.text).not.toMatch(/[{}]/);
    expect(m.done).toEqual({ parentTold: true });
  });

  it("uses email when the client has one, and gives up when there is no one to send to", () => {
    const kind = FREELANCE.kinds.find((k) => k.id === "invoice")!;
    const m = kind.messages![0];
    const client = page("c1", "freelance.client", "Noura Studio", { email: "pay@noura.sa", phone: "0551234567" });
    const invoice = page("i1", "freelance.invoice", "Invoice", { client: "c1", number: "INV-7", total: 1150, due: "2026-11-01", status: "late" });
    const d = draftMessage(m, FREELANCE, kind, invoice, { c1: client, i1: invoice }, "en")!;
    expect(d.channel).toBe("email");
    expect(d.text).toContain("Noura Studio");
    expect(d.text).toContain("INV-7");
    expect(messageUrl(d, "INV-7")).toMatch(/^mailto:pay@noura\.sa\?subject=INV-7&body=/);
    expect(draftMessage(m, FREELANCE, kind, page("i2", "freelance.invoice", "x", { status: "late" }), {}, "en")).toBeNull();
    const noContact = page("c2", "freelance.client", "Quiet Co", {});
    expect(draftMessage(m, FREELANCE, kind, page("i3", "freelance.invoice", "x", { client: "c2" }), { c2: noContact }, "en")).toBeNull();
  });

  it("only names fields that exist, in both languages", () => {
    expect(SHOP.kinds.find((k) => k.id === "order")!.messages).toHaveLength(1);
    for (const pack of PACK_DEFS)
      for (const kind of pack.kinds)
        for (const m of kind.messages ?? []) {
          const via = m.to.via ? kind.fields.find((f) => f.id === m.to.via) : undefined;
          if (m.to.via) expect(via?.type, `${pack.id}.${kind.id} ${m.id}`).toBe("link");
          const target = via ? pack.kinds.find((k) => k.id === via.to)! : kind;
          for (const f of m.to.fields) expect(["phone", "email"], `${pack.id}.${kind.id} ${f}`).toContain(target.fields.find((x) => x.id === f)?.type);
          for (const f of Object.keys(m.done ?? {})) expect(kind.fields.some((x) => x.id === f), f).toBe(true);
          for (const text of typeof m.text === "string" ? [m.text] : [m.text.en, m.text.ar])
            for (const [, a, b] of text.matchAll(/\{([a-zA-Z]+)(?:\.([a-zA-Z]+))?\}/g)) {
              if (a === "title") continue;
              if (a === m.to.via) expect(!b || target.fields.some((x) => x.id === b), `${kind.id} {${a}.${b}}`).toBe(true);
              else expect(kind.fields.some((x) => x.id === a), `${kind.id} {${a}}`).toBe(true);
            }
        }
  });
});
