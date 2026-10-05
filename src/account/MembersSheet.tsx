import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../lib/api";
import { Button, IconButton } from "../ui/Button";
import { Modal, confirmDialog } from "../ui/Modal";
import { Segmented } from "../ui/Segmented";
import { Avatar, relTime, Spinner } from "../ui/misc";
import { menuAt, type MenuItem } from "../ui/Menu";
import { accountApi, ROLE_HINT, ROLE_LABEL, type AuditRow, type Group, type Invite, type Member, type Role } from "./api";
import { canChangeRole, canInvite, canManage, canRemove } from "./roles";
import { useAccount } from "./store";
import { copyText, Notice, PopButton, until, WorkspaceTile } from "./parts";

type Tab = "people" | "groups" | "links" | "activity";

/** People, roles, groups, invite links and the audit log of one Team workspace. */
export function MembersSheet({ workspaceId }: { workspaceId: string }) {
  const close = useAccount((s) => s.close);
  const view = useAccount((s) => s.view);
  const ws = view?.workspaces.find((w) => w.id === workspaceId);
  const me = view?.account?.userId;
  const [tab, setTab] = useState<Tab>("people");
  const [members, setMembers] = useState<Member[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await accountApi.members(workspaceId);
      setMembers(r.members);
      setOffline(r.offline);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [workspaceId]);
  useEffect(() => {
    load();
  }, [load]);

  if (!ws) {
    return (
      <Modal title="Workspace" onClose={close} width={460}>
        <Notice icon="warning" tone="warning">
          This workspace is no longer available to you.
        </Notice>
      </Modal>
    );
  }
  const manager = canManage(ws.role);
  const tabs: { value: Tab; label: string }[] = [
    { value: "people", label: "People" },
    { value: "groups", label: "Groups" },
    ...(manager
      ? [
          { value: "links" as Tab, label: "Invite Links" },
          { value: "activity" as Tab, label: "Activity" },
        ]
      : []),
  ];

  return (
    <Modal
      title={
        <span className="acct-sheet-title">
          <WorkspaceTile name={ws.name} size={24} />
          <span className="bidi">{ws.name}</span>
        </span>
      }
      onClose={close}
      width={600}
      className="acct-sheet"
    >
      <div className="acct-tabs">
        <Segmented value={tab} onChange={setTab} options={tabs} label="Workspace sections" />
      </div>
      {offline && (
        <Notice icon="disconnected" tone="warning">
          You are offline. This is the list from your last connection; changes need a connection.
        </Notice>
      )}
      {error && (
        <Notice icon="warning" tone="warning">
          {error}
        </Notice>
      )}
      {tab === "people" && (
        <People ws={ws.id} role={ws.role} me={me} members={members} setMembers={setMembers} disabled={offline} onInvite={() => setTab("links")} />
      )}
      {tab === "groups" && <Groups ws={ws.id} manager={manager} members={members ?? []} disabled={offline} />}
      {tab === "links" && <Links ws={ws.id} role={ws.role} disabled={offline} />}
      {tab === "activity" && <Activity ws={ws.id} members={members ?? []} />}
    </Modal>
  );
}

function People({
  ws,
  role,
  me,
  members,
  setMembers,
  disabled,
  onInvite,
}: {
  ws: string;
  role: Role;
  me?: string;
  members: Member[] | null;
  setMembers: (m: Member[]) => void;
  disabled: boolean;
  onInvite: () => void;
}) {
  const run = useAccount((s) => s.run);
  const apply = useAccount((s) => s.apply);
  const close = useAccount((s) => s.close);
  const view = useAccount((s) => s.view);
  const wsName = view?.workspaces.find((w) => w.id === ws)?.name ?? "this workspace";
  if (!members)
    return (
      <div className="acct-loading">
        <Spinner />
      </div>
    );

  const roleItems = (m: Member): MenuItem[] =>
    (["admin", "member", "guest"] as Role[])
      .filter((r) => canChangeRole(role, m.role, r, m.userId === me))
      .map((r) => ({
        label: ROLE_LABEL[r],
        checked: m.role === r,
        onSelect: () => run(async () => setMembers((await accountApi.setRole(ws, m.userId, r)).members)),
      }));

  const moreItems = (m: Member): MenuItem[] => {
    const items: MenuItem[] = [];
    if (role === "owner" && m.userId !== me && m.role !== "guest")
      items.push({
        label: "Make Owner",
        icon: "owner",
        onSelect: async () => {
          const ok = await confirmDialog({
            title: `Make ${m.displayName || "them"} the owner?`,
            message: `You become an admin of ${wsName}. Only the new owner can undo this.`,
            confirm: "Make Owner",
          });
          if (ok) run(async () => setMembers((await accountApi.transfer(ws, m.userId)).members), "Ownership transferred");
        },
      });
    if (canRemove(role, m.role, m.userId === me))
      items.push({
        label: "Remove from Workspace",
        icon: "delete",
        danger: true,
        onSelect: async () => {
          const ok = await confirmDialog({
            title: `Remove ${m.displayName || "this person"}?`,
            message: `They lose access to every page in ${wsName} right away.`,
            confirm: "Remove",
            danger: true,
          });
          if (ok) run(async () => setMembers((await accountApi.removeMember(ws, m.userId)).members));
        },
      });
    return items;
  };

  return (
    <>
      <div className="acct-list">
        {members.map((m) => {
          const options = roleItems(m);
          const more = moreItems(m);
          return (
            <div key={m.userId} className="acct-person">
              <Avatar name={m.displayName || m.email || "?"} size={32} />
              <div className="acct-person-text">
                <div className="acct-person-name bidi">
                  {m.displayName || m.email}
                  {m.userId === me && <span className="acct-you">You</span>}
                </div>
                <div className="acct-person-sub isolate">{m.email}</div>
              </div>
              <PopButton
                label={ROLE_LABEL[m.role]}
                items={[{ kind: "label", label: ROLE_HINT[m.role] }, ...options]}
                disabled={disabled || options.length === 0}
                title={`Role of ${m.displayName}`}
              />
              {more.length > 0 && !disabled ? (
                <IconButton icon="more" label="More" onClick={(e) => menuAt(e.currentTarget, more, "end")} />
              ) : (
                <span className="acct-icon-spacer" />
              )}
            </div>
          );
        })}
      </div>
      <div className="acct-sheet-foot">
        {canInvite(role, "member") && (
          <Button variant="tinted" icon="link" disabled={disabled} onClick={onInvite}>
            Invite People
          </Button>
        )}
        <span className="grow" />
        {role === "owner" ? (
          <Button
            variant="danger"
            disabled={disabled}
            onClick={async () => {
              const ok = await confirmDialog({
                title: `Delete ${wsName}?`,
                message: "Everyone loses access to its pages. Copies already on people's PCs stay there. This cannot be undone.",
                confirm: "Delete Workspace",
                danger: true,
              });
              if (ok) run(async () => apply(await accountApi.deleteWorkspace(ws)), "Workspace deleted").then(() => close());
            }}
          >
            Delete Workspace
          </Button>
        ) : (
          <Button
            variant="danger"
            disabled={disabled}
            onClick={async () => {
              const ok = await confirmDialog({
                title: `Leave ${wsName}?`,
                message: "You lose access to its pages. Someone has to invite you again to come back.",
                confirm: "Leave",
                danger: true,
              });
              if (ok) run(async () => apply(await accountApi.leave(ws)), `You left ${wsName}`).then(() => close());
            }}
          >
            Leave Workspace
          </Button>
        )}
      </div>
    </>
  );
}

function Groups({ ws, manager, members, disabled }: { ws: string; manager: boolean; members: Member[]; disabled: boolean }) {
  const run = useAccount((s) => s.run);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [name, setName] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(() => accountApi.groups(ws).then(setGroups, () => setGroups([])), [ws]);
  useEffect(() => {
    load();
  }, [load]);
  if (!groups)
    return (
      <div className="acct-loading">
        <Spinner />
      </div>
    );
  const nameOf = (id: string) => members.find((m) => m.userId === id)?.displayName || "Someone";
  return (
    <>
      {groups.length === 0 && <p className="acct-empty">Groups let you share a page with several people at once, for example Design or Finance.</p>}
      <div className="acct-list">
        {groups.map((g) => (
          <div key={g.id} className="acct-group-block">
            <div className="acct-person">
              <span className="acct-group-icon" aria-hidden>
                {[...g.name][0]?.toUpperCase()}
              </span>
              <div className="acct-person-text">
                <div className="acct-person-name bidi">{g.name}</div>
                <div className="acct-person-sub">
                  {g.memberIds.length === 0 ? "No one yet" : g.memberIds.length <= 3 ? g.memberIds.map(nameOf).join(", ") : `${g.memberIds.length} people`}
                </div>
              </div>
              {manager && !disabled && (
                <>
                  <Button variant="quiet" size="compact" onClick={() => setOpenId(openId === g.id ? null : g.id)}>
                    {openId === g.id ? "Done" : "Edit"}
                  </Button>
                  <IconButton
                    icon="delete"
                    label="Delete group"
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: `Delete ${g.name}?`,
                        message: "Pages shared with this group stop being shared with its people.",
                        confirm: "Delete",
                        danger: true,
                      });
                      if (ok) run(async () => accountApi.deleteGroup(ws, g.id)).then(load);
                    }}
                  />
                </>
              )}
            </div>
            {openId === g.id && (
              <div className="acct-checklist">
                {members.map((m) => {
                  const on = g.memberIds.includes(m.userId);
                  return (
                    <label key={m.userId} className="acct-check">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {
                          const next = on ? g.memberIds.filter((x) => x !== m.userId) : [...g.memberIds, m.userId];
                          setGroups(groups.map((x) => (x.id === g.id ? { ...x, memberIds: next } : x)));
                          run(async () => accountApi.setGroupMembers(ws, g.id, next)).then((r) => {
                            if (r === undefined) load();
                          });
                        }}
                      />
                      <span className="bidi">{m.displayName || m.email}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
      {manager && !disabled && (
        <div className="acct-inline-form">
          <input
            className="field"
            placeholder="New group name"
            aria-label="New group name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && run(async () => accountApi.createGroup(ws, name.trim())).then(() => (setName(""), load()))}
          />
          <Button
            variant="plain"
            disabled={!name.trim()}
            onClick={() => run(async () => accountApi.createGroup(ws, name.trim())).then(() => (setName(""), load()))}
          >
            Add Group
          </Button>
        </div>
      )}
    </>
  );
}

const EXPIRY: { value: string; label: string; hours: number }[] = [
  { value: "1", label: "1 day", hours: 24 },
  { value: "7", label: "7 days", hours: 168 },
  { value: "30", label: "30 days", hours: 720 },
];
const USES: { value: string; label: string; max: number | null }[] = [
  { value: "1", label: "One person", max: 1 },
  { value: "10", label: "Up to 10 people", max: 10 },
  { value: "any", label: "No limit", max: null },
];

/** Invite links: create with a role, expiry and use limit; copy; revoke at once. */
export function InviteLinks({
  ws,
  role,
  pageId,
  level,
  disabled,
}: {
  ws: string;
  role: Role;
  pageId?: string;
  level?: "edit" | "comment" | "view";
  disabled: boolean;
}) {
  const run = useAccount((s) => s.run);
  const [links, setLinks] = useState<Invite[] | null>(null);
  const [fresh, setFresh] = useState<Record<string, string>>({});
  const roles = pageId
    ? (["guest", ...(["member"] as Role[]).filter((r) => canInvite(role, r))] as Role[])
    : (["member", "guest", "admin"] as Role[]).filter((r) => canInvite(role, r));
  const [newRole, setNewRole] = useState<Role>(roles[0] ?? "guest");
  const [expiry, setExpiry] = useState("7");
  const [uses, setUses] = useState("1");
  const load = useCallback(() => accountApi.invites(ws, pageId).then(setLinks, () => setLinks([])), [ws, pageId]);
  useEffect(() => {
    load();
  }, [load]);

  const create = () =>
    run(async () => {
      const inv = await accountApi.createInvite(ws, {
        role: newRole,
        expiresInHours: EXPIRY.find((e) => e.value === expiry)!.hours,
        maxUses: USES.find((u) => u.value === uses)!.max,
        pageId,
        level: pageId ? (level ?? "edit") : undefined,
      });
      setFresh((f) => ({ ...f, [inv.id]: inv.url }));
      copyText(inv.url, "Invite link");
      load();
    });

  const active = (links ?? []).filter((l) => l.active);
  return (
    <div className="acct-links">
      {roles.length > 0 && (
        <div className="acct-link-maker">
          <PopButton
            label={ROLE_LABEL[newRole]}
            title="Role"
            items={roles.map((r) => ({ label: ROLE_LABEL[r], checked: r === newRole, onSelect: () => setNewRole(r) }))}
            disabled={roles.length < 2}
          />
          <PopButton
            label={EXPIRY.find((e) => e.value === expiry)!.label}
            title="Expires after"
            items={EXPIRY.map((e) => ({ label: e.label, checked: e.value === expiry, onSelect: () => setExpiry(e.value) }))}
          />
          <PopButton
            label={USES.find((u) => u.value === uses)!.label}
            title="Who can use it"
            items={USES.map((u) => ({ label: u.label, checked: u.value === uses, onSelect: () => setUses(u.value) }))}
          />
          <span className="grow" />
          <Button variant="tinted" icon="link" disabled={disabled} onClick={create}>
            Create Link
          </Button>
        </div>
      )}
      {links === null ? (
        <div className="acct-loading">
          <Spinner />
        </div>
      ) : active.length === 0 ? (
        <p className="acct-empty">{pageId ? "No active links for this page." : "No active invite links."}</p>
      ) : (
        <div className="acct-list">
          {active.map((l) => (
            <div key={l.id} className="acct-link-block">
              <div className="acct-person">
                <span className="acct-group-icon is-link" aria-hidden>
                  <IconGlyph />
                </span>
                <div className="acct-person-text">
                  <div className="acct-person-name">
                    {ROLE_LABEL[l.role]}
                    {l.level ? `, ${l.level === "edit" ? "can edit" : l.level === "comment" ? "can comment" : "can view"} this page` : ""}
                  </div>
                  <div className="acct-person-sub">
                    {l.maxUses === null ? `Used ${l.uses} ${l.uses === 1 ? "time" : "times"}` : `${l.uses} of ${l.maxUses} used`}, {until(l.expiresAt)}
                  </div>
                </div>
                {fresh[l.id] && (
                  <Button variant="plain" size="compact" icon="duplicate" onClick={() => copyText(fresh[l.id], "Invite link")}>
                    Copy
                  </Button>
                )}
                <Button
                  variant="quiet"
                  size="compact"
                  disabled={disabled}
                  onClick={() => run(async () => accountApi.revokeInvite(ws, l.id), "Link turned off").then(load)}
                >
                  Revoke
                </Button>
              </div>
              {fresh[l.id] && (
                <input
                  className="field acct-link-url isolate"
                  readOnly
                  value={fresh[l.id]}
                  aria-label="Invite link"
                  onFocus={(e) => e.currentTarget.select()}
                />
              )}
            </div>
          ))}
        </div>
      )}
      <p className="set-note">Links are shown in full only once, when you create them. Revoking stops a link at once.</p>
    </div>
  );
}

function IconGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function Links({ ws, role, disabled }: { ws: string; role: Role; disabled: boolean }) {
  return <InviteLinks ws={ws} role={role} disabled={disabled} />;
}

const ACTIONS: Record<string, string> = {
  "workspace.created": "created the workspace",
  "workspace.updated": "changed workspace settings",
  "workspace.ownership_transferred": "transferred ownership",
  "member.joined": "joined",
  "member.left": "left",
  "member.removed": "removed someone",
  "member.role_changed": "changed a role",
  "group.created": "created a group",
  "group.renamed": "renamed a group",
  "group.deleted": "deleted a group",
  "group.members_changed": "changed a group",
  "invite.created": "created an invite link",
  "invite.revoked": "revoked an invite link",
  "tree.changed": "moved or removed pages",
  "permission.set": "changed who can open a page",
  "permission.removed": "removed someone from a page",
  "page.restricted": "limited a page to listed people",
  "page.inherit_restored": "let a page follow its parent again",
};

function Activity({ ws, members }: { ws: string; members: Member[] }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    accountApi.audit(ws).then(setRows, (e) => setError(errorMessage(e)));
  }, [ws]);
  if (error) return <p className="acct-empty">{error}</p>;
  if (!rows)
    return (
      <div className="acct-loading">
        <Spinner />
      </div>
    );
  const who = (id: string | null) => members.find((m) => m.userId === id)?.displayName || "Someone";
  return (
    <div className="acct-list acct-audit">
      {rows.map((r) => (
        <div key={r.id} className="acct-audit-row">
          <span className="acct-audit-text bidi">
            <strong>{who(r.actorUserId)}</strong> {ACTIONS[r.action] ?? r.action}
            {r.actorKind === "ai-on-behalf-of-user" && <span className="acct-badge">with Claude</span>}
            {r.actorKind === "automation" && <span className="acct-badge">automation</span>}
          </span>
          <span className="acct-audit-time">{relTime(r.at)}</span>
        </div>
      ))}
      {rows.length === 0 && <p className="acct-empty">Nothing yet.</p>}
    </div>
  );
}
