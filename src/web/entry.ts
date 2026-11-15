/**
 * Links into Worlds on the web from enterworlds.space: `?account=create`
 * opens the sign-up step and `?account=signin` the sign-in step, instead of
 * the welcome screen. The parameter is removed from the address afterwards.
 */
import { useAccount } from "../account/store";
import { useStore } from "../state/store";

export function openFromLink(): void {
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
