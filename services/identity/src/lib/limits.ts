/**
 * Size limits per account (docs/admin/PLAN.md, section 7). The web copy of a
 * workspace (the sync service's vault) and each file there or on the public
 * profile have a default the team can raise or lower for one account.
 */
export const DEFAULT_LIMITS = { webCopyMb: 32, fileMb: 25 } as const;
/** The team can go this far, no further: one Worker request carries at most 100 MB. */
export const MAX_LIMITS = { webCopyMb: 95, fileMb: 95 } as const;

export interface Limits {
  webCopyMb: number;
  fileMb: number;
  custom: boolean;
  note: string | null;
  updatedAt: number | null;
}

export async function limitsFor(db: D1Database, userId: string): Promise<Limits> {
  const row = await db
    .prepare("SELECT web_copy_mb, file_mb, note, updated_at FROM account_limits WHERE user_id = ?1")
    .bind(userId)
    .first<{ web_copy_mb: number | null; file_mb: number | null; note: string | null; updated_at: number }>();
  return {
    webCopyMb: row?.web_copy_mb ?? DEFAULT_LIMITS.webCopyMb,
    fileMb: row?.file_mb ?? DEFAULT_LIMITS.fileMb,
    custom: !!row,
    note: row?.note ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

export const MB = 1024 * 1024;
