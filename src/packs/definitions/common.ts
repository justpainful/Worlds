/**
 * Small pieces many pack definitions share, so each definition reads as what
 * the sector needs rather than as repeated boilerplate.
 */
import type { FieldDef, FieldOption, RoleDef } from "../definition";

/** Options from [id, label, colour?] triples. */
export function options(...list: [string, string, string?][]): FieldOption[] {
  return list.map(([id, label, color]) => (color ? { id, label, color } : { id, label }));
}

export const text = (id: string, label: string, more: Partial<FieldDef> = {}): FieldDef => ({ id, label, type: "text", ...more });
export const notes = (id = "notes", label = "Notes"): FieldDef => ({ id, label, type: "longText", detailOnly: true });
export const number = (id: string, label: string, more: Partial<FieldDef> = {}): FieldDef => ({ id, label, type: "number", ...more });
export const money = (id: string, label: string, more: Partial<FieldDef> = {}): FieldDef => ({ id, label, type: "money", ...more });
export const date = (id: string, label: string, more: Partial<FieldDef> = {}): FieldDef => ({ id, label, type: "date", ...more });
export const time = (id: string, label: string, more: Partial<FieldDef> = {}): FieldDef => ({ id, label, type: "time", ...more });
export const check = (id: string, label: string, more: Partial<FieldDef> = {}): FieldDef => ({ id, label, type: "checkbox", ...more });
export const phone = (id = "phone", label = "Phone"): FieldDef => ({ id, label, type: "phone" });
export const email = (id = "email", label = "Email"): FieldDef => ({ id, label, type: "email", detailOnly: true });
export const url = (id = "link", label = "Link"): FieldDef => ({ id, label, type: "url", detailOnly: true });
export const link = (id: string, label: string, to: string, more: Partial<FieldDef> = {}): FieldDef => ({ id, label, type: "link", to, ...more });
export const choice = (id: string, label: string, list: FieldOption[], more: Partial<FieldDef> = {}): FieldDef => ({ id, label, type: "choice", options: list, ...more });
export const stage = (id: string, label: string, list: FieldOption[], more: Partial<FieldDef> = {}): FieldDef => ({ id, label, type: "stage", options: list, ...more });

/** The usual roles of a small team: the owner, people who work in it, and people who only look. */
export function teamRoles(owner: string, member: string, viewer: string, extra: RoleDef[] = []): RoleDef[] {
  return [
    { id: "owner", label: owner, sees: "all", canEdit: true },
    { id: "member", label: member, sees: "all", canEdit: true },
    ...extra,
    { id: "viewer", label: viewer, sees: "all", canEdit: false },
  ];
}

/** Days of the week, Saturday first as in Saudi Arabia. */
export const WEEKDAYS = options(["sat", "Saturday"], ["sun", "Sunday"], ["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"]);
