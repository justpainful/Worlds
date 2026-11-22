import { useEffect, useState } from "react";
import { ApiError, call, type Role, type TeamMember, type UserItem } from "../api";
import { go, useAdmin } from "../App";
import { errorText, fmtDate, t, useLang } from "../i18n";
import { Avatar, Button, Dialog, Empty, Field, Icon, IconButton, Popup, Row, Section, toast } from "../ui";
import { Failed, Loading, Toolbar, useLoad } from "./common";

const ROLES: Role[] = ["owner", "moderator", "support"];

export function Team() {
  useLang();
  const { can, guard, me } = useAdmin();
  const { data, error, loading, reload } = useLoad(() => call<TeamMember[]>("GET", "/admin/team"), []);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const manage = can("team");

  const setRole = async (m: TeamMember, role: Role) => {
    try {
      await guard(() => call("PUT", `/admin/team/${encodeURIComponent(m.id)}`, { role }));
      reload();
    } catch (e) {
      if ((e as ApiError).code !== "cancelled") toast(errorText(e), "error");
    }
  };

  return (
    <div className="view">
      <Toolbar title={t("team")}>
        <IconButton icon="arrow.clockwise" label={t("refresh")} onClick={reload} disabled={loading} />
        {manage && (
          <Button variant="accent" icon="plus" onClick={() => setAdding(true)}>
            {t("addMember")}
          </Button>
        )}
      </Toolbar>
      <div className="page narrow">
        {error && !data ? (
          <Failed error={error} retry={reload} />
        ) : !data ? (
          <Loading />
        ) : (
          <Section title={t("members")} note={t("teamLead")}>
            {data.map((m) => (
              <Row
                key={m.id}
                label={
                  <span className="team-name">
                    <Avatar name={m.displayName || m.username} url={m.avatarUrl} size={28} />
                    <span>
                      <bdi>{m.displayName}</bdi> <bdi dir="ltr" className="muted">@{m.username}</bdi>
                    </span>
                  </span>
                }
                sub={m.fixed ? t("fixedOwner") : m.grantedAt ? fmtDate(m.grantedAt) : undefined}
                trailing={
                  <span className="row-controls">
                    {manage && !m.fixed && m.id !== me.user.id ? (
                      <>
                        <Popup label={t("role")} value={m.role} onChange={(r) => setRole(m, r)} options={ROLES.map((r) => ({ value: r, label: t(`role_${r}`) }))} />
                        <IconButton icon="trash" label={t("removeFromTeam")} onClick={() => setRemoving(m)} />
                      </>
                    ) : (
                      <span className="row-value">{t(`role_${m.role}`)}</span>
                    )}
                    <IconButton icon="chevron.right" label={t("account")} onClick={() => go("accounts", m.id)} />
                  </span>
                }
              />
            ))}
          </Section>
        )}
      </div>
      {adding && <AddDialog onClose={() => setAdding(false)} onDone={() => (setAdding(false), reload())} existing={new Set(data?.map((m) => m.id))} />}
      {removing && (
        <Dialog
          alert
          title={t("removeMemberTitle", { name: removing.displayName })}
          lead={t("removeMemberLead")}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <Button onClick={() => setRemoving(null)}>{t("cancel")}</Button>
              <Button
                variant="danger"
                icon="trash"
                onClick={async () => {
                  try {
                    await guard(() => call("DELETE", `/admin/team/${encodeURIComponent(removing.id)}`));
                    setRemoving(null);
                    reload();
                  } catch (e) {
                    if ((e as ApiError).code !== "cancelled") toast(errorText(e), "error");
                  }
                }}
              >
                {t("remove")}
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}

function AddDialog({ onClose, onDone, existing }: { onClose: () => void; onDone: () => void; existing: Set<string> }) {
  const { guard } = useAdmin();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<UserItem[]>([]);
  const [pick, setPick] = useState<UserItem | null>(null);
  const [role, setRole] = useState<Role>("support");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const h = setTimeout(async () => {
      try {
        const r = await call<{ users: UserItem[] }>("GET", `/admin/users?${new URLSearchParams({ q: q.trim(), limit: "8" })}`);
        setFound(r.users.filter((u) => !existing.has(u.id)));
      } catch {
        setFound([]);
      }
    }, 250);
    return () => clearTimeout(h);
  }, [q, existing]);

  return (
    <Dialog
      title={t("addMember")}
      lead={t("addMemberHint")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button
            variant="accent"
            icon="plus"
            busy={busy}
            disabled={!pick}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await guard(() => call("PUT", `/admin/team/${encodeURIComponent(pick!.id)}`, { role }));
                onDone();
              } catch (e) {
                if ((e as ApiError).code !== "cancelled") setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("addMember")}
          </Button>
        </>
      }
    >
      {pick ? (
        <div className="group">
          <Row
            label={
              <span className="team-name">
                <Avatar name={pick.displayName} url={pick.avatarUrl} size={28} />
                <span>
                  <bdi>{pick.displayName}</bdi> <bdi dir="ltr" className="muted">@{pick.username}</bdi>
                </span>
              </span>
            }
            trailing={<IconButton icon="xmark" label={t("back")} onClick={() => setPick(null)} />}
          />
        </div>
      ) : (
        <>
          <label className="search glass">
            <Icon name="magnifyingglass" size={15} />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchAccounts")} aria-label={t("search")} autoFocus />
          </label>
          <div className="group">
            {found.length ? (
              found.map((u) => <Row key={u.id} label={<bdi>{u.displayName}</bdi>} sub={<bdi dir="ltr">@{u.username}</bdi>} onClick={() => setPick(u)} trailing={<Icon name="chevron.right" size={12} />} />)
            ) : (
              <Empty>{q.trim().length < 2 ? t("addMemberHint") : t("noResults")}</Empty>
            )}
          </div>
        </>
      )}
      <Field label={t("role")} as="div">
        <Popup label={t("role")} value={role} onChange={setRole} options={ROLES.map((r) => ({ value: r, label: t(`role_${r}`) }))} />
      </Field>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
