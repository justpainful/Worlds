import { describe, expect, it } from "vitest";
import { SHOP } from "./definitions/shop";
import { TEACHER } from "./definitions/teacher";
import { combineFields, fieldsToAdopt, hiddenDocId, hiddenKeys, isRestricted, splitFields } from "./hidden";

describe("hidden fields", () => {
  it("knows which fields any role of a pack must not see", () => {
    expect([...hiddenKeys(SHOP)]).toEqual(["cost"]);
    expect(hiddenKeys(TEACHER).has("guardianPhone")).toBe(true);
    expect(isRestricted(SHOP.roles.find((r) => r.id === "staff")!)).toBe(true);
    expect(isRestricted(SHOP.roles.find((r) => r.id === "owner")!)).toBe(false);
    // The same id the identity service parses.
    expect(hiddenDocId("p1", "shop")).toBe("p1__hidden__shop");
  });

  it("splits an item's fields between the two documents", () => {
    expect(splitFields({ price: 85, cost: 40, stock: 3 }, new Set(["cost"]))).toEqual({ open: { price: 85, stock: 3 }, hidden: { cost: 40 } });
  });

  it("takes hidden fields from the hidden document when it could be opened, and keeps its own otherwise", () => {
    const keys = new Set(["cost"]);
    // Someone changed the price; this device can open the hidden fields.
    expect(combineFields({ price: 90, stock: 3 }, { cost: 42 }, { price: 85, cost: 40, stock: 3 }, keys)).toEqual({ price: 90, stock: 3, cost: 42 });
    // A restricted member: the hidden document is closed to them, nothing is invented or lost.
    expect(combineFields({ price: 90, stock: 3 }, null, { price: 85, stock: 3 }, keys)).toEqual({ price: 90, stock: 3 });
    // A hidden value left in the shared document by an older version is ignored.
    expect(combineFields({ price: 90, cost: 1 }, { cost: 42 }, {}, keys)).toEqual({ price: 90, cost: 42 });
  });

  it("brings a closed item up to date without clearing what was never shared", () => {
    const keys = hiddenKeys(SHOP);
    // Someone changed the price while this device had the product closed.
    expect(fieldsToAdopt({ price: 90, stock: 3 }, { cost: 42 }, { price: 85, stock: 3, cost: 40 }, keys)).toEqual({ price: 90, stock: 3, cost: 42 });
    // Nothing changed: keep the item as it is.
    expect(fieldsToAdopt({ price: 85, stock: 3 }, { cost: 40 }, { price: 85, stock: 3, cost: 40 }, keys)).toBeNull();
    // The shared document was never seeded: never clear the item from it.
    expect(fieldsToAdopt({}, null, { price: 85 }, keys)).toBeNull();
    // A hidden document this device may not open, or one still empty, keeps the hidden fields.
    expect(fieldsToAdopt({ price: 90 }, null, { price: 85, cost: 40 }, keys)).toEqual({ price: 90, cost: 40 });
    expect(fieldsToAdopt({ price: 90 }, {}, { price: 85, cost: 40 }, keys)).toEqual({ price: 90, cost: 40 });
  });
});
