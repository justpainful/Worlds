/**
 * Pack roles on this device: a preview of what each role sees ("View as
 * Student"), so the person who runs the pack can check it before sharing.
 *
 * What a member can open is decided by page permissions on the server (each
 * item is a page, so an item shared with one person is theirs alone). Hiding
 * single fields from a role on the server is the next step (docs/PACKS.md,
 * Roles); until then this preview is a check, not a lock.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { FieldDef, KindDef, RoleDef } from "./definition";

const KEY = (pack: string) => `worlds.packs.viewAs.${pack}`;
const listeners = new Set<() => void>();

function read(pack: string): string | null {
  try {
    return localStorage.getItem(KEY(pack));
  } catch {
    return null;
  }
}

/** The role a pack is previewed as, or null for the full view. */
export function useViewAs(packId: string, roles: RoleDef[]): [RoleDef | null, (roleId: string | null) => void] {
  const id = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => read(packId),
    () => null,
  );
  const set = useCallback(
    (roleId: string | null) => {
      try {
        if (roleId) localStorage.setItem(KEY(packId), roleId);
        else localStorage.removeItem(KEY(packId));
      } catch {
        /* storage unavailable: the preview is a convenience */
      }
      listeners.forEach((l) => l());
    },
    [packId],
  );
  return [roles.find((r) => r.id === id) ?? null, set];
}

/** The fields a role may see on this kind; everything when no role is previewed. */
export function fieldsFor(kind: KindDef, role: RoleDef | null): FieldDef[] {
  if (!role?.hiddenFields?.length) return kind.fields;
  return kind.fields.filter((f) => !role.hiddenFields!.includes(f.id));
}

/** Column ids for a table, without the ones the role does not see. */
export function columnsFor(kind: KindDef, role: RoleDef | null, columns?: string[]): string[] | undefined {
  if (!role?.hiddenFields?.length) return columns;
  const ids = columns ?? kind.fields.filter((f) => !f.detailOnly).map((f) => f.id);
  return ids.filter((id) => !role.hiddenFields!.includes(id));
}
