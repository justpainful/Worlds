import { useCallback, useEffect, useMemo, useState } from "react";
import { errorMessage } from "../lib/api";
import { pageTitle, useStore } from "../state/store";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Modal, confirmDialog } from "../ui/Modal";
import { Avatar, Spinner } from "../ui/misc";
import type { MenuItem } from "../ui/Menu";
import { accountApi, LEVEL_LABEL, type Level, type PageSharing, type PermissionEntry } from "./api";
import { useAccount } from "./store";
import { InviteLinks } from "./MembersSheet";
import { Notice, PopButton, WorkspaceTile } from "./parts";

const GRANT_LEVELS: Level[] = ["full", "edit", "comment", "view"];

const YOU: Record<Level, string> = {
  full: "You have full access",
  edit: "You can edit",
  comment: "You can comment",
  view: "You can view",
  none: "You have no access",
};

/** Who can open a page, at which level, and links that bring new people straight to it. */
export function ShareSheet({ pageId }: { pageId: string }) {
  const close = useAccount((s) => s.close);
  const view = useAccount((s) => s.view);
  const page = useStore((s) => s.pages[pageId]);
  const [data, setData] = useState<PageSharing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await accountApi.pageSharing(pageId));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [pageId]);
  useEffect(() => {
    load();
  }, [load]);

  const title = page ? pageTitle(page) : "Page";
  return (
    <Modal title={<span className="bidi">Share “{title}”</span>} onClose={close} width={580} className="acct-sheet">
      {error ? (
        <Notice icon="warning" tone="warning">
          {error}
        </Notice>
      ) : !data ? (
        <div className="acct-loading">
          <Spinner />
        </div>
      ) : !data.workspace ? (
        <PersonalPage pageId={pageId} signedIn={view?.status === "active"} reload={load} />
      ) : (
        <TeamPage pageId={pageId} data={data} setData={setData} reload={load} />
      )}
    </Modal>
  );
}

function PersonalPage({ pageId, signedIn, reload }: { pageId: string; signedIn: boolean; reload: () => Promise<void> }) {
  const view = useAccount((s) => s.view);
  const open = useAccount((s) => s.open);
  const run = useAccount((s) => s.run);
  const apply = useAccount((s) => s.apply);
  const targets = (view?.workspaces ?? []).filter((w) => w.role !== "guest");

  if (!signedIn) {
    return (
      <>
        <Notice icon="lock">This page is in your Personal workspace. It stays on this PC and nobody else can see it.</Notice>
        <p className="acct-text is-left">To work on it with other people, sign in and move it into a Team workspace.</p>
        <div className="acct-sheet-foot">
          <span className="grow" />
          <Button variant="tinted" onClick={() => open({ kind: "signin" })}>
            Sign In
          </Button>
        </div>
      </>
    );
  }
  return (
    <>
      <Notice icon="lock">This page is in your Personal workspace. It stays on this PC and nobody else can see it.</Notice>
      {targets.length === 0 ? (
        <>
          <p className="acct-text is-left">Create a Team workspace, then move this page into it to share it.</p>
          <div className="acct-sheet-foot">
            <span className="grow" />
            <Button variant="tinted" icon="add" onClick={() => open({ kind: "create" })}>
              New Team Workspace
            </Button>
          </div>
        </>
      ) : (
        <div className="acct-list">
          {targets.map((w) => (
            <div key={w.id} className="acct-person">
              <WorkspaceTile name={w.name} size={30} />
              <div className="acct-person-text">
                <div className="acct-person-name bidi">{w.name}</div>
                <div className="acct-person-sub">
                  {w.memberCount} {w.memberCount === 1 ? "person" : "people"}
                </div>
              </div>
              <Button
                variant="plain"
                size="compact"
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: `Move to ${w.name}?`,
                    message: "The page and its subpages join the workspace. People there can open them according to the workspace's sharing.",
                    confirm: "Move",
                  });
                  if (ok)
                    run(async () => {
                      apply(await accountApi.movePage(pageId, w.id));
                      await useStore.getState().refreshPages();
                      await reload();
                    }, `Moved to ${w.name}`);
                }}
              >
                Move Here
              </Button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function TeamPage({ pageId, data, setData, reload }: { pageId: string; data: PageSharing; setData: (d: PageSharing) => void; reload: () => void }) {
  const run = useAccount((s) => s.run);
  const apply = useAccount((s) => s.apply);
  const close = useAccount((s) => s.close);
  const view = useAccount((s) => s.view);
  const ws = data.workspace!;
  const perms = data.permissions;
  const offline = data.errorCode === "offline";
  const canShare = !!perms && perms.myLevel === "full" && !offline;
  const me = view?.account?.userId;
  const [query, setQuery] = useState("");
  const [addLevel, setAddLevel] = useState<Level>("edit");
  const [showLinks, setShowLinks] = useState(false);

  const memberName = (id: string) => data.members?.find((m) => m.userId === id)?.displayName || data.members?.find((m) => m.userId === id)?.email || "Someone";
  const groupName = (id: string) => data.groups?.find((g) => g.id === id)?.name ?? "A group";
  const memberRole = (id: string) => data.members?.find((m) => m.userId === id)?.role;

  const entries = (perms?.entries ?? []).filter((e) => e.principalType !== "workspace");
  const everyone = perms?.entries.find((e) => e.principalType === "workspace");
  const everyoneLevel: Level = everyone?.level ?? (perms?.inherit === false ? "none" : ws.defaultLevel);

  const update = (fn: () => Promise<unknown>) =>
    run(async () => {
      const p = await fn();
      if (p && typeof p === "object" && "entries" in (p as object)) setData({ ...data, permissions: p as PageSharing["permissions"] });
      else reload();
    });

  const levelItems = (
    e: { principalType: PermissionEntry["principalType"]; principalId: string; level: Level; inherited?: boolean },
    guest: boolean,
  ): MenuItem[] => {
    const items: MenuItem[] = GRANT_LEVELS.filter((l) => !(guest && l === "full")).map((l) => ({
      label: LEVEL_LABEL[l],
      checked: e.level === l,
      onSelect: () => update(() => accountApi.setPagePermission(pageId, e.principalType, e.principalId, l)),
    }));
    items.push({
      label: LEVEL_LABEL.none,
      checked: e.level === "none",
      onSelect: () => update(() => accountApi.setPagePermission(pageId, e.principalType, e.principalId, "none")),
    });
    if (!e.inherited) {
      items.push(
        { kind: "separator" },
        { label: "Remove", danger: true, onSelect: () => update(() => accountApi.removePagePermission(pageId, e.principalType, e.principalId)) },
      );
    }
    return items;
  };

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const explicit = new Set(entries.filter((e) => !e.inherited).map((e) => `${e.principalType}:${e.principalId}`));
    const people = (data.members ?? [])
      .filter((m) => m.role !== "owner" && m.role !== "admin" && !explicit.has(`user:${m.userId}`))
      .filter((m) => `${m.displayName} ${m.email ?? ""}`.toLowerCase().includes(q))
      .map((m) => ({ type: "user" as const, id: m.userId, label: m.displayName || m.email || "Someone", sub: m.email ?? "", guest: m.role === "guest" }));
    const groups = (data.groups ?? [])
      .filter((g) => !explicit.has(`group:${g.id}`) && g.name.toLowerCase().includes(q))
      .map((g) => ({
        type: "group" as const,
        id: g.id,
        label: g.name,
        sub: `Group, ${g.memberIds.length} ${g.memberIds.length === 1 ? "person" : "people"}`,
        guest: false,
      }));
    return [...groups, ...people].slice(0, 6);
  }, [query, data, entries]);

  return (
    <>
      <div className="acct-share-head">
        <WorkspaceTile name={ws.name} size={30} />
        <div className="acct-person-text">
          <div className="acct-person-name bidi">In {ws.name}</div>
          <div className="acct-person-sub">{YOU[perms?.myLevel ?? (data.level as Level)]}</div>
        </div>
      </div>

      {offline && (
        <Notice icon="disconnected" tone="warning">
          You are offline. Sharing shows and changes when you are back online. You can keep working on the page.
        </Notice>
      )}
      {data.error && !offline && (
        <Notice icon="warning" tone="warning">
          {data.error}
        </Notice>
      )}
      {data.level === "none" && (
        <Notice icon="lock" tone="warning">
          You do not have access to this page. Ask someone with full access to share it with you.
        </Notice>
      )}
      {perms && !canShare && !offline && perms.myLevel !== "none" && (
        <Notice icon="info">Only people with full access can change who can open this page.</Notice>
      )}

      {perms && (
        <>
          {canShare && (
            <div className="acct-add">
              <input
                className="field"
                placeholder="Add people or groups"
                aria-label="Add people or groups"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <PopButton
                label={LEVEL_LABEL[addLevel]}
                title="Access for new people"
                items={GRANT_LEVELS.map((l) => ({ label: LEVEL_LABEL[l], checked: l === addLevel, onSelect: () => setAddLevel(l) }))}
              />
              {candidates.length > 0 && (
                <div className="acct-suggest" role="listbox">
                  {candidates.map((c) => (
                    <button
                      key={`${c.type}:${c.id}`}
                      type="button"
                      role="option"
                      className="acct-suggest-item"
                      onClick={() => {
                        setQuery("");
                        const level = c.guest && addLevel === "full" ? "edit" : addLevel;
                        update(() => accountApi.setPagePermission(pageId, c.type, c.id, level));
                      }}
                    >
                      {c.type === "group" ? <span className="acct-group-icon">{[...c.label][0]?.toUpperCase()}</span> : <Avatar name={c.label} size={26} />}
                      <span className="acct-person-text">
                        <span className="acct-person-name bidi">{c.label}</span>
                        <span className="acct-person-sub isolate">{c.sub}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {query.trim() && candidates.length === 0 && <p className="acct-hint">Nobody in {ws.name} matches. Invite new people with a link below.</p>}
            </div>
          )}

          <div className="acct-list">
            <div className="acct-person">
              <WorkspaceTile name={ws.name} size={32} />
              <div className="acct-person-text">
                <div className="acct-person-name bidi">Everyone in {ws.name}</div>
                <div className="acct-person-sub">
                  {everyone?.inherited
                    ? "Set on a parent page"
                    : everyone
                      ? "Set on this page"
                      : perms.inherit
                        ? "Workspace default for members"
                        : "Not included"}
                </div>
              </div>
              <PopButton
                label={LEVEL_LABEL[everyoneLevel]}
                title="Access for everyone in the workspace"
                disabled={!canShare}
                items={levelItems({ principalType: "workspace", principalId: "*", level: everyoneLevel, inherited: !everyone || everyone.inherited }, false)}
              />
            </div>
            {entries.map((e) => (
              <div key={`${e.principalType}:${e.principalId}`} className="acct-person">
                {e.principalType === "group" ? (
                  <span className="acct-group-icon">{[...groupName(e.principalId)][0]?.toUpperCase()}</span>
                ) : (
                  <Avatar name={memberName(e.principalId)} size={32} />
                )}
                <div className="acct-person-text">
                  <div className="acct-person-name bidi">
                    {e.principalType === "group" ? groupName(e.principalId) : memberName(e.principalId)}
                    {e.principalId === me && <span className="acct-you">You</span>}
                  </div>
                  <div className="acct-person-sub">
                    {e.inherited ? "From a parent page" : e.principalType === "group" ? "Group" : memberRole(e.principalId) === "guest" ? "Guest" : "Member"}
                  </div>
                </div>
                <PopButton label={LEVEL_LABEL[e.level]} title="Access" disabled={!canShare} items={levelItems(e, memberRole(e.principalId) === "guest")} />
              </div>
            ))}
          </div>

          <div className="acct-toggle-row">
            <div className="set-row-text">
              <div className="set-row-label">Only people listed here</div>
              <div className="set-row-hint">Stops access that comes from parent pages. Owners and admins can always open every page.</div>
            </div>
            <button
              role="switch"
              aria-checked={!perms.inherit}
              aria-label="Only people listed here"
              disabled={!canShare}
              className={`switch ${!perms.inherit ? "is-on" : ""}`}
              onClick={() => update(() => accountApi.setPageInherit(pageId, !perms.inherit))}
            >
              <span className="switch-knob" />
            </button>
          </div>

          {canShare && (
            <section className="acct-section">
              <button type="button" className="acct-disclosure" aria-expanded={showLinks} onClick={() => setShowLinks(!showLinks)}>
                <span>Invite with a Link</span>
                <Icon name="forward" size={13} className={`acct-disclosure-chevron ${showLinks ? "is-open" : ""}`} />
              </button>
              {showLinks && (
                <InviteLinks
                  ws={ws.id}
                  role={ws.role}
                  pageId={pageId}
                  level={addLevel === "full" ? "edit" : (addLevel as "edit" | "comment" | "view")}
                  disabled={offline}
                />
              )}
            </section>
          )}
        </>
      )}

      {perms?.myLevel === "full" && !offline && (
        <div className="acct-sheet-foot">
          <span className="grow" />
          <Button
            variant="quiet"
            onClick={async () => {
              const ok = await confirmDialog({
                title: "Move to Personal?",
                message: `The page and its subpages leave ${ws.name}. Other people lose access, and it stays only on this PC.`,
                confirm: "Move to Personal",
                danger: true,
              });
              if (ok)
                run(async () => {
                  apply(await accountApi.movePage(pageId, null));
                  await useStore.getState().refreshPages();
                  close();
                }, "Moved to Personal");
            }}
          >
            Move to Personal
          </Button>
        </div>
      )}
    </>
  );
}
