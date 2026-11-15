/**
 * The demo at demo.enterworlds.space (pnpm build:sample): Worlds on the web
 * with the sample workspace loaded on the first visit, so there is something
 * to try at once. It has no accounts (SignIn.tsx sends people to
 * app.enterworlds.space for that); what visitors change stays in this browser.
 */
import { isSampleLoaded } from "../demo/sampleWorkspace";
import { useStore } from "../state/store";

export function startSampleDemo(): void {
  let started = false;
  const go = () => {
    const s = useStore.getState();
    if (started || !s.ready) return;
    started = true;
    unsubscribe();
    // The demo skips the welcome screen: its first step asks about accounts.
    if (!s.settings["account.onboarded"]) void s.setSetting("account.onboarded", true);
    if (isSampleLoaded(s.settings, s.pages)) return;
    void import("../demo/sampleActions").then(async (m) => {
      if (await m.loadSample()) useStore.getState().toast({ message: "This is the Worlds demo. Your changes stay in this browser.", tone: "info" });
    });
  };
  const unsubscribe = useStore.subscribe(go);
  go();
}
