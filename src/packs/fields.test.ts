import { describe, expect, it } from "vitest";
import type { FieldDef, KindDef } from "./definition";
import { compareField, formatField, initialData, listFields, parseField, parseNumber } from "./fields";

const stage: FieldDef = {
  id: "status",
  label: "Status",
  type: "stage",
  options: [
    { id: "draft", label: "Draft" },
    { id: "sent", label: "Sent" },
    { id: "paid", label: "Paid" },
  ],
};
const money: FieldDef = { id: "amount", label: "Amount", type: "money" };

describe("pack fields", () => {
  it("reads numbers typed with an Arabic keyboard", () => {
    expect(parseNumber("١٢٥٠")).toBe(1250);
    expect(parseNumber("١٬٥٠٠٫٧٥")).toBe(1500.75);
    expect(parseNumber("1,200")).toBe(1200);
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });

  it("stores what was typed as the field's own type", () => {
    expect(parseField(money, "٣٠٠")).toBe(300);
    expect(parseField({ id: "d", label: "D", type: "date" }, "2026-11-13")).toBe("2026-11-13");
    expect(parseField({ id: "d", label: "D", type: "date" }, "13/11")).toBeNull();
    expect(parseField({ id: "t", label: "T", type: "time" }, "9:30")).toBe("09:30");
    expect(parseField(stage, "sent")).toBe("sent");
    expect(parseField(stage, "lost")).toBeNull();
    expect(parseField({ id: "c", label: "C", type: "checkbox" }, "true")).toBe(true);
  });

  it("shows money in riyals and stages by their label", () => {
    expect(formatField(money, 1500, "en-US")).toMatch(/SAR\s?1,500/);
    expect(formatField({ ...money, currency: "USD" }, 20, "en-US")).toBe("$20.00");
    expect(formatField(stage, "paid")).toBe("Paid");
    expect(formatField(stage, null)).toBe("");
    expect(formatField({ id: "d", label: "D", type: "date" }, "2026-11-13", "en-US")).toBe("Nov 13, 2026");
  });

  it("starts a new item at the first stage with boxes unticked", () => {
    const kind: KindDef = {
      id: "invoice",
      label: "Invoice",
      plural: "Invoices",
      icon: "document",
      blurb: "",
      fields: [stage, money, { id: "paid", label: "Paid", type: "checkbox" }, { id: "note", label: "Note", type: "text", initial: "Thanks" }],
    };
    expect(initialData(kind)).toEqual({ status: "draft", paid: false, note: "Thanks" });
    expect(listFields(kind, ["amount", "status"]).map((f) => f.id)).toEqual(["amount", "status"]);
  });

  it("sorts stages in their order and empty values last", () => {
    const values = ["paid", null, "draft", "sent"];
    expect([...values].sort((a, b) => compareField(stage, a, b))).toEqual(["draft", "sent", "paid", null]);
    expect([3, null, 1].sort((a, b) => compareField(money, a, b))).toEqual([1, 3, null]);
  });
});
