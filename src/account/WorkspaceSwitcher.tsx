import { useEffect } from "react";
import "./account.css";
import { useStore } from "../state/store";
import { Icon } from "../ui/Icon";
import { menuAt, type MenuItem } from "../ui/Menu";
import { accountApi } from "./api";
import { activeWorkspace, startAccount, useAccount } from "./store";
import { WorkspaceTile } from "./parts";
import { AccountHost } from "./AccountHost";

/**
 * The sidebar's workspace control: which workspace the sidebar shows
 * (Personal or a Team), creating and joining workspaces, and the account
 * states (signed out, offline, sign in again). Also hosts the account sheets.
 */
export function WorkspaceSwitcher() {
  const view = useAccount((s) => s.view);
  const open = useAccount((s) => s.open);
  const apply = useAccount((s) => s.apply);
  const run = useAccount((s) => s.run);
  useEffect(() => startAccount(), []);

  const active = activeWorkspace(view);
  const status = view?.status ?? "signed_out";
  const signedIn = status === "active";

  const show = (anchor: HTMLElement) => {
    const items: MenuItem[] = [{ kind: "label", label: "Workspaces" }];
    items.push({ label: "Personal", icon: "user", checked: !active, onSelect: () => run(async () => apply(await accountApi.setActiveWorkspace(null))) });
    for (const w of view?.workspaces ?? []) {
      items.push({
        label: w.name,
        icon: "users",
        checked: active?.id === w.id,
        onSelect: () => run(async () => apply(await accountApi.setActiveWorkspace(w.id))),
      });
    }
    items.push({ kind: "separator" });
    if (signedIn) {
      items.push({ label: "New Team Workspace", icon: "add", onSelect: () => open({ kind: "create" }) });
      items.push({ label: "Join with Invite Link", icon: "link", onSelect: () => open({ kind: "join" }) });
      if (active) items.push({ label: `People in ${active.name}`, icon: "users", onSelect: () => open({ kind: "members", workspaceId: active.id }) });
    } else if (status === "expired") {
      items.push({ label: "Sign In Again", icon: "lock", onSelect: () => open({ kind: "signin", start: "signin" }) });
    } else {
      items.push({ label: "Sign In or Create Account", icon: "lock", onSelect: () => open({ kind: "signin" }) });
      items.push({ label: "Join with Invite Link", icon: "link", onSelect: () => open({ kind: "join" }) });
    }
    items.push({ label: "Account Settings", icon: "settings", onSelect: () => useStore.getState().open({ kind: "settings", section: "account" }, "tab") });
    menuAt(anchor, items, "start", true);
  };

  const hint = status === "expired" ? "Signed out" : signedIn && view?.offline ? "Offline" : null;

  return (
    <>
      <button type="button" className="acct-switcher" onClick={(e) => show(e.currentTarget)} aria-haspopup="menu" aria-label="Switch workspace">
        <WorkspaceTile name={active?.name} personal={!active} size={22} />
        <span className="acct-switcher-name bidi">{active?.name ?? "Personal"}</span>
        {hint && (
          <span
            className={`acct-switcher-hint ${status === "expired" ? "is-warning" : ""}`}
            data-tip={status === "expired" ? "Sign in again to reach your Team workspaces" : "Changes stay on this PC until you are back online"}
          >
            {hint}
          </span>
        )}
        <Icon name="chevronDown" size={13} className="acct-switcher-chevron" />
      </button>
      <AccountHost />
    </>
  );
}
