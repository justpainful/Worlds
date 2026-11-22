import { useEffect, useMemo, useState } from "react";
import { ApiError, call, type Device, type UserDetail, type UserItem } from "../api";
import { go, useAdmin } from "../App";
import { ago, errorText, fmtDate, fmtNum, t, useLang } from "../i18n";
import { Avatar, Button, Capsule, Chip, Dialog, Empty, Field, Icon, IconButton, MenuButton, Popup, Row, Section, Segmented, toast } from "../ui";
import { Failed, Loading, Toolbar, useLoad } from "./common";
import { LogRows } from "./Log";
import { MessageDialog } from "./Community";
import { PLATFORM_ICON, PLATFORM_NAME } from "./Overview";

type Filter = "all" | "active" | "suspended" | "banned" | "deleting" | "team";
type Sort = "created" | "active" | "name";

const PROFILE_HOST = "https://profile.enterworlds.space";

export function Accounts({ id }: { id?: string }) {
  const { can } = useAdmin();
  useLang();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("created");
  const [pages, setPages] = useState(1);

  // Search after a short pause in typing.
  useEffect(() => {
    const h = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(h);
  }, [q]);
  useEffect(() => setPages(1), [query, filter, sort]);

  const list = useLoad(
    () => call<{ total: number; users: UserItem[] }>("GET", `/admin/users?${new URLSearchParams({ q: query, status: filter, sort, limit: String(50 * pages) })}`),
    [query, filter, sort, pages],
  );

  return (
    <div className={`view split ${id ? "has-detail" : ""}`}>
      <div className="split-list">
        <Toolbar title={t("accounts")} subtitle={list.data ? t("results", { n: fmtNum(list.data.total) }) : undefined}>
          <IconButton icon="arrow.clockwise" label={t("refresh")} onClick={list.reload} disabled={list.loading} />
        </Toolbar>
        <div className="page">
          <div className="filters">
            <label className="search glass">
              <Icon name="magnifyingglass" size={15} />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={can("users.email") ? t("searchAccounts") : t("searchAccountsNoEmail")}
                aria-label={t("search")}
              />
              {q && (
                <button type="button" className="search-clear" aria-label={t("clearFilter")} onClick={() => setQ("")}>
                  <Icon name="xmark" size={12} />
                </button>
              )}
            </label>
            <div className="filters-row">
              <Segmented
                label={t("accounts")}
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: t("filterAll") },
                  { value: "active", label: t("filterActive") },
                  { value: "suspended", label: t("filterSuspended") },
                  { value: "banned", label: t("filterBanned") },
                  { value: "deleting", label: t("filterDeleting") },
                  { value: "team", label: t("filterTeam") },
                ]}
              />
              <Popup
                label={t("sortCreated")}
                icon="line.3.horizontal.decrease.circle"
                value={sort}
                onChange={setSort}
                options={[
                  { value: "created", label: t("sortCreated") },
                  { value: "active", label: t("sortActive") },
                  { value: "name", label: t("sortName") },
                ]}
              />
            </div>
          </div>
          {list.error && !list.data ? (
            <Failed error={list.error} retry={list.reload} />
          ) : !list.data ? (
            <Loading />
          ) : (
            <>
              <div className="group list" role="list">
                {list.data.users.length ? (
                  list.data.users.map((u) => <UserRow key={u.id} u={u} selected={u.id === id} />)
                ) : (
                  <Empty>{t("noResults")}</Empty>
                )}
              </div>
              {list.data.users.length < list.data.total && (
                <div className="more">
                  <Button icon="chevron.down" busy={list.loading} onClick={() => setPages((p) => p + 1)}>
                    {t("loadMore")}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <div className="split-detail">{id ? <Account key={id} id={id} onChanged={list.reload} /> : <div className="state muted">{t("chooseAccount")}</div>}</div>
    </div>
  );
}

function StatusChip({ status, until }: { status: UserItem["status"]; until?: number | null }) {
  if (status === "active") return null;
  return (
    <Chip tone={status === "banned" ? "danger" : "warning"}>
      {t(`status_${status}`)}
      {status === "suspended" && until ? ` ${t("until", { date: fmtDate(until) })}` : ""}
    </Chip>
  );
}

function UserRow({ u, selected }: { u: UserItem; selected: boolean }) {
  return (
    <a href={`#/accounts/${encodeURIComponent(u.id)}`} className={`user-row ${selected ? "is-on" : ""}`} role="listitem" aria-current={selected || undefined}>
      <Avatar name={u.displayName || u.username || "?"} url={u.avatarUrl} size={34} />
      <span className="user-main">
        <span className="user-name">
          <bdi>{u.displayName || u.username}</bdi>
          {u.teamRole && <Chip tone="accent">{t(`role_${u.teamRole}`)}</Chip>}
          <StatusChip status={u.status} until={u.suspendedUntil} />
        </span>
        <span className="user-sub">
          <bdi dir="ltr">@{u.username}</bdi>
          {u.email && (
            <>
              {" · "}
              <bdi dir="ltr">{u.email}</bdi>
            </>
          )}
        </span>
      </span>
      <span className="user-meta">
        <span>{u.lastSeenAt ? ago(u.lastSeenAt) : t("never")}</span>
        <span className="muted">{t("joined", { date: fmtDate(u.createdAt) })}</span>
      </span>
      <Icon name="chevron.right" size={12} />
    </a>
  );
}

// ---------------------------------------------------------------------------
// One account
// ---------------------------------------------------------------------------

type Dlg =
  | { kind: "edit" }
  | { kind: "suspend" }
  | { kind: "ban" }
  | { kind: "lift" }
  | { kind: "signout"; device?: Device }
  | { kind: "passkey"; id: string; name: string }
  | { kind: "delete" }
  | { kind: "message" }
  | { kind: "canceldel" };

function Account({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { can, guard } = useAdmin();
  const lang = useLang();
  const { data: u, error, loading, reload } = useLoad(() => call<UserDetail>("GET", `/admin/users/${encodeURIComponent(id)}`), [id]);
  const [dlg, setDlg] = useState<Dlg | null>(null);

  const changed = async () => {
    setDlg(null);
    await reload();
    onChanged();
  };

  if (error && !u)
    return (
      <div className="view">
        <Toolbar title={t("account")} back={<BackButton />} />
        <Failed error={error} retry={reload} />
      </div>
    );
  if (!u)
    return (
      <div className="view">
        <Toolbar title={t("account")} back={<BackButton />} />
        <Loading />
      </div>
    );

  const suspended = u.status !== "active";
  const exportData = async () => {
    try {
      const data = await guard(() => call("GET", `/admin/users/${encodeURIComponent(u.id)}/export`));
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `worlds-account-${u.username ?? u.id}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast(t("exported"));
    } catch (e) {
      if ((e as ApiError).code !== "cancelled") toast(errorText(e), "error");
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(u.id);
      toast(t("copied"));
    } catch {
      toast(u.id);
    }
  };

  return (
    <div className="view">
      <Toolbar title={u.displayName || `@${u.username}`} subtitle={<bdi dir="ltr">@{u.username}</bdi>} back={<BackButton />}>
        <IconButton icon="arrow.clockwise" label={t("refresh")} onClick={reload} disabled={loading} />
      </Toolbar>
      <div className="page">
        <header className="account-head">
          <Avatar name={u.displayName || u.username || "?"} url={u.avatarUrl} size={56} />
          <div className="account-id">
            <h2>
              <bdi>{u.displayName}</bdi>
              {u.teamRole && <Chip tone="accent">{t(`role_${u.teamRole}`)}</Chip>}
              <StatusChip status={u.status} until={u.suspendedUntil} />
            </h2>
            <p>
              <bdi dir="ltr">@{u.username}</bdi>
              {u.email && (
                <>
                  {" · "}
                  <bdi dir="ltr">{u.email}</bdi>
                </>
              )}
            </p>
          </div>
          <div className="account-actions">
            <Capsule label={t("account")}>
              {can("users.edit") && (
                <Button icon="pencil" onClick={() => setDlg({ kind: "edit" })}>
                  {t("edit")}
                </Button>
              )}
              {u.status === "suspended" && can("users.suspend") && (
                <Button icon="play.circle" onClick={() => setDlg({ kind: "lift" })}>
                  {t("lift")}
                </Button>
              )}
              {u.status === "banned" && can("users.ban") && (
                <Button icon="play.circle" onClick={() => setDlg({ kind: "lift" })}>
                  {t("unban")}
                </Button>
              )}
              {!suspended && can("users.suspend") && (
                <Button icon="pause.circle" onClick={() => setDlg({ kind: "suspend" })}>
                  {t("suspend")}
                </Button>
              )}
              <MenuButton
                icon="ellipsis.circle"
                label={t("more")}
                items={[
                  can("users.devices") && u.devices.some((d) => !d.revokedAt) && { key: "out", label: t("signOutAll"), icon: "rectangle.portrait.and.arrow.right", onSelect: () => setDlg({ kind: "signout" }) },
                  !suspended && can("users.ban") && { key: "ban", label: t("ban"), icon: "nosign", danger: true, onSelect: () => setDlg({ kind: "ban" }) },
                  can("audit") && { key: "log", label: t("log"), icon: "list.bullet.rectangle", onSelect: () => go("log", undefined, { user: u.id }) },
                  can("messages") && { key: "msg", label: t("writeTo"), icon: "envelope", onSelect: () => setDlg({ kind: "message" }) },
                  can("users.export") && { key: "export", label: t("exportData"), icon: "document.on.document", onSelect: () => void exportData() },
                  can("users.delete") && u.deletion && { key: "undel", label: t("cancelDeletion"), icon: "arrow.clockwise", onSelect: () => setDlg({ kind: "canceldel" }) },
                  can("users.delete") && !u.deletion && { key: "del", label: t("deleteAccount"), icon: "trash", danger: true, onSelect: () => setDlg({ kind: "delete" }) },
                  { key: "copy", label: t("copyId"), icon: "document.on.document", onSelect: copy },
                ]}
              />
            </Capsule>
          </div>
        </header>

        {u.deletion && (
          <Section title={t("deletionTitle")}>
            <Row icon="trash" label={t("deletionDue")} sub={u.deletion.by === "self" ? t("deletionBySelf") : t("deletionByTeam")} value={fmtDate(u.deletion.dueAt, true)} />
          </Section>
        )}

        {u.suspension && (
          <Section title={t("suspension")}>
            <Row icon={u.suspension.banned ? "nosign" : "pause.circle"} label={t("reason")} value={u.suspension.reason ?? ""} />
            <Row icon="calendar" label={t("since")} value={fmtDate(u.suspension.since, true)} />
            <Row icon="clock" label={t("endsAt")} value={u.suspension.until ? fmtDate(u.suspension.until, true) : t("noEnd")} />
          </Section>
        )}

        <div className="grid-2">
          <div>
            <Section title={t("account")}>
              <Row icon="number.sign" label={t("id")} value={<bdi dir="ltr">{u.id}</bdi>} mono />
              <Row icon="at" label={t("username")} sub={u.usernameAuto ? t("usernameAuto") : undefined} value={<bdi dir="ltr">@{u.username}</bdi>} />
              <Row icon="envelope" label={t("email")} value={u.email ? <bdi dir="ltr">{u.email}</bdi> : <span className="muted">{t("hiddenForRole")}</span>} />
              {u.emailVerifiedAt && <Row icon="checkmark" label={t("emailVerified")} value={fmtDate(u.emailVerifiedAt)} />}
              <Row icon="calendar" label={t("created")} value={fmtDate(u.createdAt, true)} />
              <Row icon="pencil" label={t("changed")} value={fmtDate(u.updatedAt, true)} />
            </Section>

            <AccountLimits id={u.id} />

            <Section title={t("devices")}>
              {u.devices.length ? (
                u.devices.map((d) => (
                  <Row
                    key={d.id}
                    icon={PLATFORM_ICON[d.platform] ?? "globe"}
                    label={
                      <bdi className={d.revokedAt ? "muted" : ""} dir="auto">
                        {d.name}
                      </bdi>
                    }
                    sub={[PLATFORM_NAME[d.platform] ?? d.platform, d.revokedAt ? t("signedOut", { time: ago(d.revokedAt) }) : t("seen", { time: ago(d.lastSeenAt) }), !d.revokedAt && d.deviceKey ? t("deviceKey") : ""]
                      .filter(Boolean)
                      .join(" · ")}
                    trailing={
                      !d.revokedAt &&
                      can("users.devices") && (
                        <Button icon="rectangle.portrait.and.arrow.right" onClick={() => setDlg({ kind: "signout", device: d })}>
                          {t("signOutDevice")}
                        </Button>
                      )
                    }
                  />
                ))
              ) : (
                <Empty>{t("noDevices")}</Empty>
              )}
            </Section>

            <Section title={t("passkeys")}>
              {u.passkeys.length ? (
                u.passkeys.map((p) => (
                  <Row
                    key={p.id}
                    icon="key"
                    label={<bdi>{p.name}</bdi>}
                    sub={`${p.lastUsedAt ? t("lastUsed", { time: ago(p.lastUsedAt) }) : t("notUsed")}${p.synced ? ` · ${t("synced")}` : ""}`}
                    trailing={
                      can("users.devices") && (
                        <Button variant="danger" icon="trash" onClick={() => setDlg({ kind: "passkey", id: p.id, name: p.name })}>
                          {t("remove")}
                        </Button>
                      )
                    }
                  />
                ))
              ) : (
                <Empty>{t("noPasskeys")}</Empty>
              )}
            </Section>

            <Section title={t("workspacesOf")}>
              {u.workspaces.length ? (
                u.workspaces.map((w) => (
                  <Row
                    key={w.id}
                    icon="square.stack.3d.up"
                    label={<bdi>{w.name}</bdi>}
                    sub={t("membersPages", { members: fmtNum(w.members), pages: fmtNum(w.pages) })}
                    value={`${t((`wsRole_${w.role}`) as "wsRole_owner")}${w.owns ? ` · ${t("owns")}` : ""}`}
                  />
                ))
              ) : (
                <Empty>{t("noWorkspaces")}</Empty>
              )}
            </Section>
          </div>

          <div>
            <Section title={t("publicProfile")}>
              {u.profile ? (
                <Row
                  icon="person.text.rectangle"
                  label={u.profile.visible ? (suspended ? t("profileHiddenSuspended") : t("profileVisible")) : t("profileHidden")}
                  sub={fmtDate(u.profile.updatedAt, true)}
                  trailing={
                    u.profile.visible &&
                    !suspended && (
                      <a className="btn btn-quiet" href={`${PROFILE_HOST}/@${u.username}`} target="_blank" rel="noreferrer noopener">
                        <Icon name="arrow.up.right.square" />
                        <span>{t("open")}</span>
                      </a>
                    )
                  }
                />
              ) : (
                <Empty>{t("noProfile")}</Empty>
              )}
            </Section>

            <Section title={t("published")}>
              {u.published.length ? (
                u.published.map((p) => (
                  <Row
                    key={`${p.kind}/${p.slug}`}
                    icon={p.kind === "share" ? "link" : "text.document"}
                    label={<bdi>{p.title}</bdi>}
                    sub={[t(`kind_${p.kind}`), t("views", { n: fmtNum(p.views) }), p.locked ? t("locked") : "", p.expiresAt ? t("expires", { date: fmtDate(p.expiresAt) }) : ""].filter(Boolean).join(" · ")}
                    trailing={
                      p.kind === "page" &&
                      !suspended && (
                        <a className="btn btn-icon" href={`${PROFILE_HOST}/@${u.username}/${p.slug}`} target="_blank" rel="noreferrer noopener" aria-label={t("open")} title={t("open")}>
                          <Icon name="arrow.up.right.square" />
                        </a>
                      )
                    }
                  />
                ))
              ) : (
                <Empty>{t("noPublished")}</Empty>
              )}
            </Section>

            {u.mail && (
              <Section title={t("mail")}>
                <Row icon="tray" label={u.mail.address ? <bdi dir="ltr">{u.mail.address}@enterworlds.space</bdi> : t("hiddenForRole")} value={t("waiting", { n: fmtNum(u.mail.waiting) })} />
              </Section>
            )}

            {can("notes") && <Notes u={u} onChanged={reload} />}

            {can("audit") && (
              <Section
                title={t("activityLog")}
                trailing={
                  <button type="button" className="link-btn" onClick={() => go("log", undefined, { user: u.id })}>
                    {t("log")}
                  </button>
                }
              >
                {u.activity.length ? <LogRows entries={u.activity.slice(0, 20)} compact /> : <Empty>{t("noActivity")}</Empty>}
              </Section>
            )}
          </div>
        </div>
      </div>

      {dlg?.kind === "edit" && <EditDialog u={u} onClose={() => setDlg(null)} onDone={changed} />}
      {(dlg?.kind === "suspend" || dlg?.kind === "ban") && <SuspendDialog u={u} ban={dlg.kind === "ban"} onClose={() => setDlg(null)} onDone={changed} />}
      {dlg?.kind === "lift" && (
        <ReasonDialog
          title={u.status === "banned" ? t("unban") : t("liftTitle")}
          lead={t("liftLead")}
          action={u.status === "banned" ? t("unban") : t("lift")}
          icon="play.circle"
          onClose={() => setDlg(null)}
          run={(reason) => guard(() => call("POST", `/admin/users/${encodeURIComponent(u.id)}/unsuspend`, { reason }))}
          onDone={changed}
        />
      )}
      {dlg?.kind === "signout" && (
        <ReasonDialog
          title={dlg.device ? t("signOutOneTitle", { name: dlg.device.name }) : t("signOutAllTitle")}
          lead={t("signOutAllLead")}
          action={t("signOutDevice")}
          icon="rectangle.portrait.and.arrow.right"
          danger
          onClose={() => setDlg(null)}
          run={(reason) => guard(() => call("POST", `/admin/users/${encodeURIComponent(u.id)}/signout`, { reason, deviceId: dlg.device?.id }))}
          onDone={changed}
        />
      )}
      {dlg?.kind === "passkey" && (
        <ReasonDialog
          title={t("removePasskeyTitle", { name: dlg.name })}
          lead={t("removePasskeyLead")}
          action={t("remove")}
          icon="trash"
          danger
          onClose={() => setDlg(null)}
          run={(reason) => guard(() => call("DELETE", `/admin/users/${encodeURIComponent(u.id)}/passkeys/${encodeURIComponent(dlg.id)}?${new URLSearchParams({ reason })}`))}
          onDone={changed}
        />
      )}
      {dlg?.kind === "message" && <MessageDialog userId={u.id} onClose={() => setDlg(null)} />}
      {dlg?.kind === "delete" && <DeleteDialog u={u} onClose={() => setDlg(null)} onDone={changed} />}
      {dlg?.kind === "canceldel" && (
        <ReasonDialog
          title={t("cancelDeletion")}
          lead={t("cancelDeletionLead")}
          action={t("cancelDeletion")}
          icon="play.circle"
          onClose={() => setDlg(null)}
          run={() => guard(() => call("POST", `/admin/users/${encodeURIComponent(u.id)}/deletion/cancel`, {}))}
          onDone={changed}
        />
      )}
      <span hidden>{lang}</span>
    </div>
  );
}

function BackButton() {
  return (
    <span className="only-narrow">
      <IconButton icon="chevron.left" label={t("back")} onClick={() => go("accounts")} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

function Notes({ u, onChanged }: { u: UserDetail; onChanged: () => void }) {
  const { me } = useAdmin();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await call("POST", `/admin/users/${encodeURIComponent(u.id)}/notes`, { body: text.trim() });
      setText("");
      onChanged();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    try {
      await call("DELETE", `/admin/notes/${encodeURIComponent(id)}`);
      onChanged();
    } catch (e) {
      toast(errorText(e), "error");
    }
  };
  return (
    <Section title={t("notes")} note={t("notesLead")}>
      <div className="note-new">
        <textarea className="input" rows={2} value={text} placeholder={t("notePlaceholder")} aria-label={t("addNote")} onChange={(e) => setText(e.target.value)} maxLength={4000} />
        <Button icon="plus" busy={busy} disabled={!text.trim()} onClick={add}>
          {t("addNote")}
        </Button>
      </div>
      {u.notes.length ? (
        u.notes.map((n) => (
          <Row
            key={n.id}
            icon="text.page"
            label={
              <bdi className="note-body" dir="auto">
                {n.body}
              </bdi>
            }
            sub={
              <>
                <bdi>{n.author?.name ?? t("someone")}</bdi>
                {" · "}
                {fmtDate(n.createdAt, true)}
              </>
            }
            trailing={(n.author?.id === me.user.id || me.role === "owner") && <IconButton icon="trash" label={t("remove")} onClick={() => remove(n.id)} />}
          />
        ))
      ) : (
        <Empty>{t("noNotes")}</Empty>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function useSubmit(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      onDone();
    } catch (e) {
      if ((e as ApiError).code !== "cancelled") setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

function ReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label={t("reason")} hint={t("reasonHint")}>
      <textarea className="input" rows={2} value={value} onChange={(e) => onChange(e.target.value)} maxLength={500} required />
    </Field>
  );
}

function ErrorLine({ text }: { text: string }) {
  return text ? (
    <p className="form-error" role="alert">
      {text}
    </p>
  ) : null;
}

function ReasonDialog({
  title,
  lead,
  action,
  icon,
  danger,
  run,
  onClose,
  onDone,
}: {
  title: string;
  lead: string;
  action: string;
  icon: "play.circle" | "rectangle.portrait.and.arrow.right" | "trash";
  danger?: boolean;
  run: (reason: string) => Promise<unknown>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const { busy, error, submit } = useSubmit(onDone);
  return (
    <Dialog
      title={title}
      lead={lead}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button variant={danger ? "danger" : "accent"} icon={icon} busy={busy} disabled={!reason.trim()} onClick={() => submit(() => run(reason.trim()))}>
            {action}
          </Button>
        </>
      }
    >
      <ReasonField value={reason} onChange={setReason} />
      <ErrorLine text={error} />
    </Dialog>
  );
}

function EditDialog({ u, onClose, onDone }: { u: UserDetail; onClose: () => void; onDone: () => void }) {
  const { can, guard } = useAdmin();
  const [name, setName] = useState(u.displayName);
  const [username, setUsername] = useState(u.username ?? "");
  const [email, setEmail] = useState(u.email ?? "");
  const [clearAvatar, setClearAvatar] = useState(false);
  const [reason, setReason] = useState("");
  const { busy, error, submit } = useSubmit(onDone);
  const changes = useMemo(() => {
    const c: Record<string, unknown> = {};
    if (name.trim() && name.trim() !== u.displayName) c.displayName = name.trim();
    if (username.trim() && username.trim().toLowerCase() !== u.username) c.username = username.trim();
    if (can("users.edit_email") && email.trim() && email.trim().toLowerCase() !== u.email) c.email = email.trim();
    if (clearAvatar && u.avatarUrl) c.avatarUrl = null;
    return c;
  }, [name, username, email, clearAvatar, u, can]);
  const has = Object.keys(changes).length > 0;
  return (
    <Dialog
      title={t("editTitle")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button
            variant="accent"
            icon="checkmark"
            busy={busy}
            disabled={!has || !reason.trim()}
            onClick={() =>
              submit(async () => {
                await guard(() => call("PATCH", `/admin/users/${encodeURIComponent(u.id)}`, { ...changes, reason: reason.trim() }));
                toast(t("save"));
              })
            }
          >
            {t("save")}
          </Button>
        </>
      }
    >
      <Field label={t("displayName")}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </Field>
      <Field label={t("username")}>
        <input className="input" dir="ltr" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} maxLength={20} />
      </Field>
      {can("users.edit_email") ? (
        <Field label={t("email")}>
          <input className="input" dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      ) : (
        <p className="field-hint">{t("emailOwnerOnly")}</p>
      )}
      {u.avatarUrl && (
        <label className="check">
          <input type="checkbox" checked={clearAvatar} onChange={(e) => setClearAvatar(e.target.checked)} />
          <span>{t("clearAvatar")}</span>
        </label>
      )}
      <ReasonField value={reason} onChange={setReason} />
      <ErrorLine text={error} />
    </Dialog>
  );
}

function DeleteDialog({ u, onClose, onDone }: { u: UserDetail; onClose: () => void; onDone: () => void }) {
  const { guard } = useAdmin();
  const [when, setWhen] = useState<"later" | "now">("later");
  const [reason, setReason] = useState("");
  const { busy, error, submit } = useSubmit(onDone);
  return (
    <Dialog
      title={t("deleteAccount")}
      lead={t("deleteLead")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button
            variant="danger"
            icon="trash"
            busy={busy}
            disabled={!reason.trim()}
            onClick={() => submit(() => guard(() => call("POST", `/admin/users/${encodeURIComponent(u.id)}/delete`, { now: when === "now", reason: reason.trim() })))}
          >
            {t("deleteAccount")}
          </Button>
        </>
      }
    >
      <Field label={t("deleteWhen")} as="div">
        <Segmented
          label={t("deleteWhen")}
          value={when}
          onChange={setWhen}
          options={[
            { value: "later", label: t("deleteSchedule") },
            { value: "now", label: t("deleteNow") },
          ]}
        />
      </Field>
      <ReasonField value={reason} onChange={setReason} />
      <ErrorLine text={error} />
    </Dialog>
  );
}

const DAY_CHOICES = ["1", "3", "7", "30", "90"] as const;

function SuspendDialog({ u, ban, onClose, onDone }: { u: UserDetail; ban: boolean; onClose: () => void; onDone: () => void }) {
  const { guard } = useAdmin();
  const [days, setDays] = useState<(typeof DAY_CHOICES)[number]>("7");
  const [reason, setReason] = useState("");
  const { busy, error, submit } = useSubmit(onDone);
  return (
    <Dialog
      title={ban ? t("banTitle") : t("suspendTitle")}
      lead={`${t("suspendLead")}${ban ? ` ${t("banLead")}` : ""}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button
            variant="danger"
            icon={ban ? "nosign" : "pause.circle"}
            busy={busy}
            disabled={!reason.trim()}
            onClick={() =>
              submit(() => guard(() => call("POST", `/admin/users/${encodeURIComponent(u.id)}/suspend`, ban ? { ban: true, reason: reason.trim() } : { days: Number(days), reason: reason.trim() })))
            }
          >
            {ban ? t("ban") : t("suspend")}
          </Button>
        </>
      }
    >
      {!ban && (
        <Field label={t("days")} as="div">
          <Segmented label={t("days")} value={days} onChange={setDays} options={DAY_CHOICES.map((d) => ({ value: d, label: t("daysN", { n: d }) }))} />
        </Field>
      )}
      <ReasonField value={reason} onChange={setReason} />
      <ErrorLine text={error} />
    </Dialog>
  );
}

interface AccountLimitsData {
  webCopyMb: number;
  fileMb: number;
  custom: boolean;
  note: string | null;
  updatedAt: number | null;
  defaults: { webCopyMb: number; fileMb: number };
  max: { webCopyMb: number; fileMb: number };
}

/** The size of this person's web copy and of each file, raised or lowered by the team. */
function AccountLimits({ id }: { id: string }) {
  const { can, guard } = useAdmin();
  const { data } = useLoad(() => call<AccountLimitsData>("GET", `/admin/users/${encodeURIComponent(id)}/limits`), [id]);
  const [form, setForm] = useState<{ webCopyMb: string; fileMb: string; note: string } | null>(null);
  const [shown, setShown] = useState<AccountLimitsData | null>(null);
  const l = shown ?? data;
  if (!l) return null;
  const write = can("users.edit");
  const save = async (reset: boolean) => {
    const num = (v: string) => (v.trim() ? Number(v) : null);
    try {
      const r = await guard(() =>
        call<AccountLimitsData>("PUT", `/admin/users/${encodeURIComponent(id)}/limits`, reset ? { webCopyMb: null, fileMb: null } : { webCopyMb: num(form!.webCopyMb), fileMb: num(form!.fileMb), note: form!.note.trim() || null }),
      );
      setShown(r);
      setForm(null);
      toast(t("saved"));
    } catch (e) {
      if ((e as ApiError).code !== "cancelled") toast(errorText(e), "error");
    }
  };
  return (
    <Section
      title={t("accountLimits")}
      note={t("accountLimitsLead", { web: l.defaults.webCopyMb, file: l.defaults.fileMb })}
      trailing={
        write &&
        !form && (
          <button type="button" className="link-btn" onClick={() => setForm({ webCopyMb: String(l.webCopyMb), fileMb: String(l.fileMb), note: l.note ?? "" })}>
            {t("changeLimits")}
          </button>
        )
      }
    >
      {form ? (
        <>
          <label className="row version-row">
            <span className="row-main">
              <span className="row-label">{t("webCopyLimit")}</span>
            </span>
            <input className="input mono" dir="ltr" inputMode="numeric" value={form.webCopyMb} placeholder={String(l.defaults.webCopyMb)} onChange={(e) => setForm({ ...form, webCopyMb: e.target.value.replace(/\D/g, "") })} />
            <span className="muted">MB</span>
          </label>
          <label className="row version-row">
            <span className="row-main">
              <span className="row-label">{t("fileLimit")}</span>
            </span>
            <input className="input mono" dir="ltr" inputMode="numeric" value={form.fileMb} placeholder={String(l.defaults.fileMb)} onChange={(e) => setForm({ ...form, fileMb: e.target.value.replace(/\D/g, "") })} />
            <span className="muted">MB</span>
          </label>
          <div className="row">
            <input className="input grow" dir="auto" maxLength={300} placeholder={t("limitNote")} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          <div className="row row-end">
            <Button onClick={() => setForm(null)}>{t("cancel")}</Button>
            <Button variant="accent" icon="checkmark" onClick={() => save(false)}>
              {t("save")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <Row icon="gauge.with.dots.needle.33percent" label={t("webCopyLimit")} value={<bdi dir="ltr">{l.webCopyMb} MB</bdi>} />
          <Row icon="text.document" label={t("fileLimit")} value={<bdi dir="ltr">{l.fileMb} MB</bdi>} />
          {l.custom && (
            <Row
              icon="info.circle"
              label={t("customLimits")}
              sub={l.note ?? undefined}
              trailing={
                write && (
                  <button type="button" className="link-btn" onClick={() => save(true)}>
                    {t("backToDefaults")}
                  </button>
                )
              }
            />
          )}
        </>
      )}
    </Section>
  );
}
