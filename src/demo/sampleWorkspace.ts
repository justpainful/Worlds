/**
 * The sample workspace: one click on the empty Home (or in Settings › Storage)
 * fills Worlds with a realistic bilingual student workspace, for a first look
 * or a demonstration, and one click removes it again.
 *
 * Everything is made offline through the ordinary store commands, so the
 * sample behaves exactly like content the person made: history, search,
 * trash and sync all apply. What was created is remembered in one setting,
 * which makes loading idempotent (a second click does not duplicate it) and
 * removal exact (only the sample's own resources go to Trash).
 *
 * No store or IPC imports here, so it runs under the tests; the app wires it
 * to the real store in ./sampleActions.ts.
 */
import type { NewPage } from "../lib/api";
import type { PageMeta } from "../lib/types";
import type { DrawingDocument, DrawingOperation } from "../drawing/model";
import { edit } from "../drawing/operations";
import { defaultIcon } from "../resources/kinds";
import { today as todayISO } from "../planning/model";
import { plantCellChanges, samplePlan, type SampleEntry } from "./sampleData";
import { localizeDeep, type SampleLanguage } from "./content";

/** Settings key holding what the sample created. */
export const SAMPLE_KEY = "sample.workspace";
export const SAMPLE_VERSION = 1;

export interface SampleRecord {
  version: number;
  rootId: string;
  /** Every resource the sample created, parents before children. */
  ids: string[];
  /** The Study pack was off and the sample turned it on. */
  enabledStudy: boolean;
  createdAt: number;
}

/** The store commands the sample needs (a subset of `api`). */
export interface SampleBackend {
  createPage(page: NewPage): Promise<PageMeta>;
  drawingLoad(pageId: string): Promise<DrawingDocument>;
  drawingApply(pageId: string, operation: DrawingOperation): Promise<DrawingDocument>;
  deletePage(id: string): Promise<void>;
}

/** The app state the sample reads and writes. */
export interface SampleHost {
  settings(): Record<string, unknown>;
  pages(): Record<string, PageMeta>;
  setSetting(key: string, value: unknown): void;
  studyEnabled(): boolean;
  setStudyEnabled(on: boolean): void;
  /** Who drawing edits are attributed to (the profile id). */
  actor(): string;
  /** The interface language; the sample is written in it. Arabic when not given. */
  language?(): SampleLanguage;
}

export function sampleRecord(settings: Record<string, unknown>): SampleRecord | null {
  const v = settings[SAMPLE_KEY] as Partial<SampleRecord> | null | undefined;
  if (!v || typeof v !== "object" || typeof v.rootId !== "string" || !Array.isArray(v.ids)) return null;
  return { version: v.version ?? SAMPLE_VERSION, rootId: v.rootId, ids: v.ids.filter((x): x is string => typeof x === "string"), enabledStudy: !!v.enabledStudy, createdAt: v.createdAt ?? 0 };
}

/** The sample's resources that still exist outside the Trash. */
export function liveSampleIds(settings: Record<string, unknown>, pages: Record<string, PageMeta>): string[] {
  const rec = sampleRecord(settings);
  if (!rec) return [];
  return rec.ids.filter((id) => pages[id] && !pages[id].deletedAt);
}

/** True while any part of the sample is still in the workspace. */
export function isSampleLoaded(settings: Record<string, unknown>, pages: Record<string, PageMeta>): boolean {
  return liveSampleIds(settings, pages).length > 0;
}

function newPageFor(entry: SampleEntry, parentId: string | null): NewPage {
  return {
    kind: entry.kind,
    title: entry.title,
    icon: entry.icon ?? defaultIcon(entry.kind),
    parentId,
    metadata: entry.metadata ?? {},
    ...(entry.blocks ? { blocks: entry.blocks } : {}),
  };
}

let running: Promise<{ created: boolean; rootId: string }> | null = null;

/**
 * Create the sample workspace unless it is already there. Returns the root
 * page to open. Safe to call twice, even at the same time.
 */
export function loadSampleWorkspace(backend: SampleBackend, host: SampleHost, now: Date = new Date()): Promise<{ created: boolean; rootId: string }> {
  if (running) return running;
  running = (async () => {
    const existing = sampleRecord(host.settings());
    if (existing && isSampleLoaded(host.settings(), host.pages())) {
      const live = liveSampleIds(host.settings(), host.pages());
      return { created: false, rootId: live.includes(existing.rootId) ? existing.rootId : live[0] };
    }
    const lang = host.language?.() ?? "ar";
    const plan = samplePlan(todayISO(now), lang);
    const ids = new Map<string, string>();
    try {
      for (const entry of plan) {
        const parentId = entry.parent ? (ids.get(entry.parent) ?? null) : null;
        const meta = await backend.createPage(newPageFor(entry, parentId));
        ids.set(entry.key, meta.id);
        if (entry.kind === "drawing") {
          const doc = await backend.drawingLoad(meta.id);
          await backend.drawingApply(meta.id, edit(host.actor(), doc.revision, "Sample drawing", localizeDeep(plantCellChanges(doc.scene), lang)));
        }
      }
    } catch (e) {
      // Leave nothing half made: the parts created so far go to Trash.
      const parents = parentsFrom(plan, ids);
      await trashTopLevel([...ids.values()], backend, (id) => parents.get(id));
      throw e;
    }
    const enabledStudy = !host.studyEnabled();
    if (enabledStudy) host.setStudyEnabled(true);
    const record: SampleRecord = { version: SAMPLE_VERSION, rootId: ids.get("root")!, ids: [...ids.values()], enabledStudy, createdAt: now.getTime() };
    host.setSetting(SAMPLE_KEY, record);
    return { created: true, rootId: record.rootId };
  })().finally(() => {
    running = null;
  });
  return running;
}

function parentsFrom(plan: SampleEntry[], ids: Map<string, string>): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const e of plan) {
    const id = ids.get(e.key);
    if (id) out.set(id, e.parent ? (ids.get(e.parent) ?? null) : null);
  }
  return out;
}

/** Trash each resource whose parent is not itself being trashed (children follow their parent). */
async function trashTopLevel(ids: string[], backend: SampleBackend, parentOf: (id: string) => string | null | undefined): Promise<number> {
  const all = new Set(ids);
  let removed = 0;
  for (const id of ids) {
    const p = parentOf(id);
    if (p && all.has(p)) continue;
    try {
      await backend.deletePage(id);
      removed++;
    } catch {
      // Already gone; nothing to do.
    }
  }
  return removed;
}

/**
 * Move every remaining part of the sample to Trash and forget it. Anything
 * the person added under a sample page goes with that page, and can be
 * restored from Trash. Returns how many resources were moved.
 */
export async function removeSampleWorkspace(backend: SampleBackend, host: SampleHost): Promise<number> {
  const rec = sampleRecord(host.settings());
  if (!rec) return 0;
  const pages = host.pages();
  const live = liveSampleIds(host.settings(), pages);
  const removed = await trashTopLevel(live, backend, (id) => pages[id]?.parentId);
  if (rec.enabledStudy) {
    // Turn the Study pack back off only if nothing of the person's own uses it.
    const sample = new Set(rec.ids);
    const ownStudy = Object.values(pages).some((p) => !p.deletedAt && !sample.has(p.id) && ["subject", "lesson", "assignment", "exam", "requirement"].includes(p.kind));
    if (!ownStudy) host.setStudyEnabled(false);
  }
  host.setSetting(SAMPLE_KEY, null);
  return removed;
}
