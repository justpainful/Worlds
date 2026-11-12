import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../i18n/ui", () => ({ tr: (text: string) => ({ "Choose a cover": "اختيار غلاف", Images: "الصور" })[text] ?? text }));

import { localDialog } from "./dialog";

describe("native dialog text", () => {
  it("translates the title and the filter names but keeps the extensions", () => {
    const out = localDialog({ multiple: false, title: "Choose a cover", filters: [{ name: "Images", extensions: ["png", "jpg"] }] });
    expect(out).toEqual({ multiple: false, title: "اختيار غلاف", filters: [{ name: "الصور", extensions: ["png", "jpg"] }] });
  });

  it("leaves a dialog without a title or filters alone", () => {
    expect(localDialog({ multiple: true })).toEqual({ multiple: true, title: undefined, filters: undefined });
  });
});
