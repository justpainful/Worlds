/** The sample workspace wired to the app's store and backend (see ./sampleWorkspace.ts). */
import { api, errorMessage } from "../lib/api";
import { useStore } from "../state/store";
import { resolveUiLanguage } from "../i18n/ui";
import { enabledPacks, PACKS_ASKED_KEY, setPackEnabled } from "../packs/packs";
import { startTour, TOUR_SEEN_KEY } from "../shell/Tour";
import { isSampleLoaded, loadSampleWorkspace, removeSampleWorkspace, sampleRecord, type SampleBackend, type SampleHost } from "./sampleWorkspace";
import type { SampleLanguage } from "./content";

const backend: SampleBackend = {
  createPage: api.createPage,
  drawingLoad: api.drawingLoad,
  drawingApply: api.drawingApply,
  deletePage: api.deletePage,
  pinPage: async (id) => {
    await api.updatePage(id, { pinned: true });
  },
};

const host: SampleHost = {
  settings: () => useStore.getState().settings,
  pages: () => useStore.getState().pages,
  setSetting: (key, value) => useStore.getState().setSetting(key, value),
  studyEnabled: () => enabledPacks(useStore.getState().settings).has("study"),
  setStudyEnabled: (on) => {
    setPackEnabled("study", on);
    // The sample answers the "school or university?" question on Home.
    if (on && !useStore.getState().settings[PACKS_ASKED_KEY]) useStore.getState().setSetting(PACKS_ASKED_KEY, true);
  },
  actor: () => useStore.getState().profile?.id || "user",
  language: () => resolveUiLanguage(useStore.getState().profile?.language),
};

export function useSampleLoaded(): boolean {
  return useStore((s) => isSampleLoaded(s.settings, s.pages));
}

/** Load the sample (or find it again) and open its first page. */
export async function loadSample(): Promise<boolean> {
  const s = useStore.getState();
  try {
    await s.refreshPages();
    const { created, rootId } = await loadSampleWorkspace(backend, host);
    await useStore.getState().refreshPages();
    const st = useStore.getState();
    st.setExpanded(rootId, true);
    st.openPage(rootId, "current");
    st.toast({ message: created ? "Sample workspace added" : "The sample workspace is already here", tone: created ? "success" : "info" });
    // A first look gets the short tour once, after the new pages have settled.
    if (created && !st.settings[TOUR_SEEN_KEY]) setTimeout(startTour, 900);
    return true;
  } catch (e) {
    useStore.getState().toast({ message: `Could not add the sample workspace: ${errorMessage(e)}`, tone: "error" });
    await useStore.getState().refreshPages();
    return false;
  }
}

/**
 * The public web demo (`pnpm build:demo`): once the app has started, fill it
 * with the sample workspace and say plainly that this is a browser demo.
 */
export function startWebDemo(): void {
  let started = false;
  const go = () => {
    if (started || !useStore.getState().ready) return;
    started = true;
    unsubscribe();
    void loadSample().then(() =>
      useStore.getState().toast({ message: "This is a web demo. Everything stays in this tab and is gone when you close it.", tone: "info" }),
    );
  };
  const unsubscribe = useStore.subscribe(go);
  go();
}

/** The language the loaded sample is written in, when it is not the interface's. */
export function sampleLanguageMismatch(): SampleLanguage | null {
  const s = useStore.getState();
  const rec = sampleRecord(s.settings);
  if (!rec?.language || !isSampleLoaded(s.settings, s.pages)) return null;
  return rec.language !== resolveUiLanguage(s.profile?.language) ? rec.language : null;
}

/** Write the sample again in the interface language; the old copy moves to Trash. */
export async function rewriteSample(): Promise<void> {
  const old = new Set(sampleRecord(useStore.getState().settings)?.ids ?? []);
  try {
    await useStore.getState().refreshPages();
    await removeSampleWorkspace(backend, host);
    await useStore.getState().refreshPages();
  } catch (e) {
    useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    return;
  }
  await loadSample();
  // Tabs still showing the old copy would open pages that are now in Trash.
  const s = useStore.getState();
  for (const pane of s.layout.panes)
    for (const tab of pane.tabs) if (tab.route.kind === "page" && old.has(tab.route.pageId)) useStore.getState().closeTab(pane.id, tab.id);
}

/**
 * After the interface language changes, offer to rewrite a sample still in the
 * other language, so a visitor who switches does not get a half translated screen.
 */
export function watchSampleLanguage(): () => void {
  let last = resolveUiLanguage(useStore.getState().profile?.language);
  return useStore.subscribe((s) => {
    const now = resolveUiLanguage(s.profile?.language);
    if (now === last) return;
    last = now;
    if (!sampleLanguageMismatch()) return;
    s.toast({ message: "The sample workspace is still in the other language", tone: "info", action: { label: "Rewrite it", run: () => void rewriteSample() } });
  });
}

/** Move the sample to Trash. */
export async function removeSample(): Promise<void> {
  try {
    await useStore.getState().refreshPages();
    const n = await removeSampleWorkspace(backend, host);
    await useStore.getState().refreshPages();
    useStore.getState().toast({ message: n ? "Sample workspace moved to Trash" : "Nothing left to remove", tone: "success" });
  } catch (e) {
    useStore.getState().toast({ message: errorMessage(e), tone: "error" });
  }
}
