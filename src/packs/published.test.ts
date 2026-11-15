import { describe, expect, it, vi } from "vitest";

// The importer's side effects are not under test here; only what it plans to do.
vi.mock("../state/store", () => ({ useStore: { getState: () => ({ settings: {}, pages: {} }) } }));
vi.mock("../sync/manager", () => ({ onNotices: () => () => undefined, publishToMembers: async () => ({ sent: 0 }) }));
vi.mock("../sync/session", () => ({ localStore: () => ({ pageMode: async () => ({ shared: false, workspaceId: null }) }) }));
vi.mock("./items", () => ({
  itemData: (p: { data?: unknown } | undefined) => (p?.data && typeof p.data === "object" ? p.data : {}),
  createPackItem: async () => null,
  updatePackItem: async () => undefined,
}));
vi.mock("./packs", () => ({ setPackEnabled: () => undefined }));

import type { PageMeta } from "../lib/types";
import type { Notice } from "../sync/manager";
import { TEACHER } from "./definitions/teacher";
import { planImport, publishBody, SOURCE_FIELD, targetOf } from "./published";

const assessment = TEACHER.kinds.find((k) => k.id === "assessment")!;
const notice = (createdAt: number, fields: Record<string, unknown>): Notice => ({
  id: "pub:ws:doc1",
  kind: "published",
  workspaceId: "ws",
  docId: "doc1",
  threadId: "",
  commentId: "",
  from: "u-teacher",
  fromName: "Ms Huda",
  excerpt: "Quiz 1",
  createdAt,
  item: { source: "teacher.assessment", target: "study.assignment", title: "Quiz 1", fields },
});

describe("items sent between workspaces", () => {
  it("sends only the mapped fields of an assessment", () => {
    const body = publishBody(TEACHER, assessment, { title: "Quiz 1", data: { date: "2026-11-20", outOf: 10, marking: "waiting", questions: "1. ..." } } as PageMeta, "Ms Huda");
    expect(body).toEqual({
      packId: "teacher",
      roleId: "student",
      source: "teacher.assessment",
      target: "study.assignment",
      title: "Quiz 1",
      fields: { due: "2026-11-20", points: 10, instructions: "1. ..." },
      fromName: "Ms Huda",
    });
    expect(targetOf("study.assignment")?.kind.id).toBe("assignment");
    expect(targetOf("nope.thing")).toBeNull();
  });

  it("makes a new assignment once, keeps only the target's fields, and names the teacher", () => {
    const steps = planImport([notice(100, { due: "2026-11-20", points: 10, secret: "x" })], {}, {});
    expect(steps).toHaveLength(1);
    expect(steps[0].existing).toBeNull();
    expect(steps[0].fields).toEqual({ due: "2026-11-20", points: 10, teacher: "Ms Huda" });
    // Already applied at this version: nothing to do.
    expect(planImport([notice(100, {})], {}, { "pub:ws:doc1": 100 })).toEqual([]);
  });

  it("updates the copy made before when the teacher sends a change", () => {
    const mine = { id: "a1", kind: "assignment", title: "Quiz 1", data: { due: "2026-11-20", submitted: true, [SOURCE_FIELD]: "pub:ws:doc1" } } as unknown as PageMeta;
    const steps = planImport([notice(200, { due: "2026-11-22" })], { a1: mine }, { "pub:ws:doc1": 100 });
    expect(steps[0].existing?.id).toBe("a1");
    // Only the sent fields change; the student's own (handed in) stay.
    expect(steps[0].fields).toEqual({ due: "2026-11-22", teacher: "Ms Huda" });
  });

  it("ignores mentions, replies and targets this Worlds does not have", () => {
    const mention = { ...notice(1, {}), kind: "mention" as const, item: undefined };
    const unknown = { ...notice(1, {}), item: { source: "a.b", target: "gone.kind", title: "x", fields: {} } };
    expect(planImport([mention, unknown], {}, {})).toEqual([]);
  });
});
