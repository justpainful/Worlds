/**
 * Links into Worlds on the web from enterworlds.space: `?account=create`
 * opens the sign-up step and `?account=signin` the sign-in step, instead of
 * the welcome screen. `#page=` carries a page made on the site's front page
 * (web/live/live.ts), which is added after the person agrees. The parameter
 * is removed from the address afterwards.
 */
import { useAccount } from "../account/store";
import { useStore } from "../state/store";

export function openFromLink(): void {
  pageFromLink();
  const params = new URLSearchParams(location.search);
  const wanted = params.get("account");
  if (wanted !== "create" && wanted !== "signin") return;
  params.delete("account");
  const rest = params.toString();
  history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : "") + location.hash);

  let done = false;
  const go = () => {
    if (done || !useStore.getState().ready) return;
    done = true;
    unsubscribe();
    // The visitor already chose: skip the welcome screen and go straight to that step.
    if (!useStore.getState().settings["account.onboarded"]) void useStore.getState().setSetting("account.onboarded", true);
    useAccount.getState().open({ kind: "signin", start: wanted });
  };
  const unsubscribe = useStore.subscribe(go);
  go();
}

/** The largest page a link may carry, decoded. */
const MAX_PAGE = 200_000;

/** A page built on enterworlds.space: title and Markdown, base64url JSON in the fragment. */
function readPageLink(): { title: string; markdown: string } | null {
  const m = location.hash.match(/^#page=([A-Za-z0-9_-]+)$/);
  if (!m || m[1].length > MAX_PAGE * 1.4) return null;
  try {
    const bin = atob(m[1].replace(/-/g, "+").replace(/_/g, "/"));
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    if (typeof json?.title !== "string" || typeof json?.markdown !== "string" || json.markdown.length > MAX_PAGE) return null;
    return { title: json.title.slice(0, 200), markdown: json.markdown };
  } catch {
    return null;
  }
}

function pageFromLink(): void {
  const page = readPageLink();
  if (!location.hash.startsWith("#page=")) return;
  history.replaceState(null, "", location.pathname + location.search);
  if (!page) return;
  let done = false;
  const go = async () => {
    if (done || !useStore.getState().ready) return;
    done = true;
    unsubscribe();
    if (!useStore.getState().settings["account.onboarded"]) void useStore.getState().setSetting("account.onboarded", true);
    // It came from a link, so it is added only when the person says so.
    const { confirmDialog } = await import("../ui/Modal");
    const ok = await confirmDialog({
      title: "Add the page you made?",
      message: `“${page.title}” from enterworlds.space will be added to your workspace in this browser.`,
      confirm: "Add Page",
    });
    if (!ok) return;
    const { api } = await import("../lib/api");
    const meta = await api.createPage({ title: page.title, markdown: page.markdown });
    await useStore.getState().refreshPages();
    useStore.getState().openPage(meta.id, "current");
  };
  const unsubscribe = useStore.subscribe(() => void go());
  void go();
}
