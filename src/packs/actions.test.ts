import { describe, expect, it, vi } from "vitest";

const created: string[] = [];
// The shell helpers are pure; the store and backend are not needed here.
vi.mock("../state/store", () => ({ useStore: () => undefined }));
vi.mock("./items", () => ({ createPackItem: () => created.push("generic") }));
vi.mock("./components", () => ({
  PACK_COMPONENTS: {},
  PACK_CREATORS: { "study.subject": () => created.push("subject") },
}));

import { enabledPackDefs, packCommands, packNewItems, packRoute, sidebarEntries } from "./actions";
import { STUDY } from "./definitions/study";
import { PACKS_KEY } from "./registry";

const on = { [PACKS_KEY]: ["study"] };

describe("pack shell entries", () => {
  it("lists only the packs that are turned on", () => {
    expect(enabledPackDefs({})).toEqual([]);
    expect(enabledPackDefs(on).map((p) => p.id)).toEqual(["study"]);
  });

  it("names the first sidebar entry after the pack and opens its first view", () => {
    const entries = sidebarEntries(STUDY);
    expect(entries.map((e) => e.label)).toEqual(["Study"]);
    expect(entries[0].route).toEqual({ kind: "pack", pack: "study", view: "main" });
    expect(packRoute(STUDY)).toEqual({ kind: "pack", pack: "study", view: "main" });
  });

  it("offers New items and commands only while the pack is on", () => {
    expect(packNewItems({})).toEqual([]);
    expect(packCommands({}, () => {})).toEqual([]);
    const items = packNewItems(on);
    expect(items.map((i) => i.label)).toEqual(["Subject"]);
    items[0].onSelect();
    expect(created).toEqual(["subject"]);
  });

  it("opens the pack's view where the command asks", () => {
    const opened: unknown[] = [];
    const cmds = packCommands(on, (r, w) => opened.push([r, w]));
    expect(cmds.map((c) => c.id)).toEqual(["pack-study-main", "pack-study-new-subject"]);
    expect(cmds[1].title).toBe("New Subject");
    expect(cmds[0].keywords).toContain("دراسة");
    cmds[0].run("tab");
    expect(opened).toEqual([[{ kind: "pack", pack: "study", view: "main" }, "tab"]]);
  });
});
