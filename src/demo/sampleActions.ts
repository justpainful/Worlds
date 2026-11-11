/** The sample workspace wired to the app's store and backend (see ./sampleWorkspace.ts). */
import { api, errorMessage } from "../lib/api";
import { useStore } from "../state/store";
import { enabledPacks, PACKS_ASKED_KEY, setPackEnabled } from "../packs/packs";
import { isSampleLoaded, loadSampleWorkspace, removeSampleWorkspace, type SampleBackend, type SampleHost } from "./sampleWorkspace";

const backend: SampleBackend = {
  createPage: api.createPage,
  drawingLoad: api.drawingLoad,
  drawingApply: api.drawingApply,
  deletePage: api.deletePage,
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
    return true;
  } catch (e) {
    useStore.getState().toast({ message: `Could not add the sample workspace: ${errorMessage(e)}`, tone: "error" });
    await useStore.getState().refreshPages();
    return false;
  }
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
