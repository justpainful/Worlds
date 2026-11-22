import { useEffect, useState } from "react";
import { ApiError, call } from "../api";
import { go, useAdmin } from "../App";
import { ago, errorText, fmtDate, fmtNum, t, useLang, type Key } from "../i18n";
import { Button, Chip, Dialog, Empty, Field, Icon, IconButton, Popup, Row, Section, Segmented, toast } from "../ui";
import { Failed, Loading, Toolbar, useLoad } from "./common";

type Tab = "profiles" | "pages" | "workspaces" | "suspicious";
const PROFILE_HOST = "https://profile.enterworlds.space";

interface ProfileItem {
  userId: string;
  username: string;
  displayName: string;
  visible: boolean;
  teamHidden: boolean;
  teamReason: string | null;
  updatedAt: number;
  reports: number;
}
interface PageItem {
  id: string;
  slug: string;
  kind: "page" | "share";
  title: string;
  views: number;
  expiresAt: number | null;
  locked: boolean;
  teamHidden: boolean;
  teamReason: string | null;
  updatedAt: number;
  userId: string;
  username: string;
  displayName: string;
  reports: number;
}
interface WorkspaceItem {
  id: string;
  name: string;
  updatedAt: number;
  deletedAt: number | null;
  owner: { id: string; username: string; name: string };
  members: number;
  pages: number;
}
interface SuspiciousItem {
  id: string;
  displayName: string;
  username: string | null;
  email: string | null;
  createdAt: number;
  reasons: string[];
}

function useQuery() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(h);
  }, [q]);
  return { q, setQ, query };
}

function Search({ q, setQ, placeholder }: { q: string; setQ: (v: string) => void; placeholder: string }) {
  return (
    <label className="search glass">
      <Icon name="magnifyingglass" size={15} />
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={t("search")} />
    </label>
  );
}

function HideDialog({ title, onClose, run }: { title: string; onClose: () => void; run: (reason: string, tell: boolean) => Promise<unknown> }) {
  const [reason, setReason] = useState("");
  const [tell, setTell] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      title={title}
      lead={t("hideLead")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button
            variant="danger"
            icon="nosign"
            busy={busy}
            disabled={!reason.trim()}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await run(reason.trim(), tell);
                onClose();
              } catch (e) {
                if ((e as ApiError).code !== "cancelled") setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("hide")}
          </Button>
        </>
      }
    >
      <Field label={t("reason")} hint={t("reasonToOwner")}>
        <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} />
        <span>{t("tellOwner")}</span>
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

export function Content() {
  useLang();
  const [tab, setTab] = useState<Tab>("profiles");
  return (
    <div className="view">
      <Toolbar title={t("content")} />
      <div className="page">
        <div className="filters-row">
          <Segmented
            label={t("content")}
            value={tab}
            onChange={setTab}
            options={[
              { value: "profiles", label: t("tabProfiles"), icon: "person.text.rectangle" },
              { value: "pages", label: t("tabPages"), icon: "text.document" },
              { value: "workspaces", label: t("tabWorkspaces"), icon: "square.stack.3d.up" },
              { value: "suspicious", label: t("tabSuspicious"), icon: "exclamationmark.triangle" },
            ]}
          />
        </div>
        {tab === "profiles" && <Profiles />}
        {tab === "pages" && <Pages />}
        {tab === "workspaces" && <Workspaces />}
        {tab === "suspicious" && <Suspicious />}
      </div>
    </div>
  );
}

const hideApi = (body: Record<string, unknown>) => call("POST", "/admin/content/hide", body);

function Profiles() {
  const { q, setQ, query } = useQuery();
  const [state, setState] = useState("all");
  const list = useLoad(() => call<ProfileItem[]>("GET", `/admin/content/profiles?${new URLSearchParams({ q: query, state })}`), [query, state]);
  const [hiding, setHiding] = useState<ProfileItem | null>(null);
  return (
    <>
      <div className="filters">
        <Search q={q} setQ={setQ} placeholder={t("searchProfiles")} />
        <div className="filters-row">
          <Popup
            label={t("status")}
            icon="line.3.horizontal.decrease.circle"
            value={state}
            onChange={setState}
            options={[
              { value: "all", label: t("st_all") },
              { value: "visible", label: t("profileVisible") },
              { value: "hidden", label: t("profileHidden") },
              { value: "team", label: t("hiddenByTeam") },
            ]}
          />
        </div>
      </div>
      {list.error && !list.data ? (
        <Failed error={list.error} retry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : (
        <div className="group">
          {list.data.length ? (
            list.data.map((p) => (
              <Row
                key={p.userId}
                icon="person.text.rectangle"
                label={
                  <span className="label-chips">
                    <bdi>{p.displayName}</bdi> <bdi dir="ltr" className="muted">@{p.username}</bdi>
                    {p.teamHidden && <Chip tone="danger">{p.teamReason === "reports" ? t("hiddenByReports") : t("hiddenByTeam")}</Chip>}
                    {!p.visible && <Chip>{t("profileHidden")}</Chip>}
                    {p.reports > 0 && <Chip tone="warning">{t("reportsN", { n: p.reports })}</Chip>}
                  </span>
                }
                sub={p.teamReason && p.teamReason !== "reports" ? `${t("reason")} ${p.teamReason}` : ago(p.updatedAt)}
                trailing={
                  <span className="row-controls">
                    <a className="btn btn-icon" href={`${PROFILE_HOST}/@${p.username}`} target="_blank" rel="noreferrer noopener" aria-label={t("open")} title={t("open")}>
                      <Icon name="arrow.up.right.square" />
                    </a>
                    {p.teamHidden ? (
                      <Button icon="play.circle" onClick={async () => (await hideApi({ username: p.username, hidden: false }), list.reload())}>
                        {t("show")}
                      </Button>
                    ) : (
                      <Button variant="danger" icon="nosign" onClick={() => setHiding(p)}>
                        {t("hide")}
                      </Button>
                    )}
                    <IconButton icon="person.crop.circle" label={t("account")} onClick={() => go("accounts", p.userId)} />
                  </span>
                }
              />
            ))
          ) : (
            <Empty>{t("noResults")}</Empty>
          )}
        </div>
      )}
      {hiding && <HideDialog title={t("hideProfile", { name: `@${hiding.username}` })} onClose={() => setHiding(null)} run={async (reason, tell) => (await hideApi({ username: hiding.username, reason, tell }), list.reload())} />}
    </>
  );
}

function Pages() {
  const { q, setQ, query } = useQuery();
  const [kind, setKind] = useState("");
  const list = useLoad(() => call<PageItem[]>("GET", `/admin/content/pages?${new URLSearchParams({ q: query, kind })}`), [query, kind]);
  const [hiding, setHiding] = useState<PageItem | null>(null);
  return (
    <>
      <div className="filters">
        <Search q={q} setQ={setQ} placeholder={t("searchPages")} />
        <div className="filters-row">
          <Popup
            label={t("kind")}
            icon="line.3.horizontal.decrease.circle"
            value={kind}
            onChange={setKind}
            options={[
              { value: "", label: t("st_all") },
              { value: "page", label: t("kind_page") },
              { value: "share", label: t("kind_share") },
            ]}
          />
        </div>
      </div>
      {list.error && !list.data ? (
        <Failed error={list.error} retry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : (
        <div className="group">
          {list.data.length ? (
            list.data.map((p) => (
              <Row
                key={p.id}
                icon={p.kind === "share" ? "link" : "text.document"}
                label={
                  <span className="label-chips">
                    <bdi dir="auto">{p.title}</bdi>
                    {p.teamHidden && <Chip tone="danger">{p.teamReason === "reports" ? t("hiddenByReports") : t("hiddenByTeam")}</Chip>}
                    {p.reports > 0 && <Chip tone="warning">{t("reportsN", { n: p.reports })}</Chip>}
                  </span>
                }
                sub={[`@${p.username}`, t(`kind_${p.kind}`), t("views", { n: fmtNum(p.views) }), p.locked ? t("locked") : "", p.expiresAt ? t("expires", { date: fmtDate(p.expiresAt) }) : ""]
                  .filter(Boolean)
                  .join(" · ")}
                trailing={
                  <span className="row-controls">
                    {p.kind === "page" && (
                      <a className="btn btn-icon" href={`${PROFILE_HOST}/@${p.username}/${p.slug}`} target="_blank" rel="noreferrer noopener" aria-label={t("open")} title={t("open")}>
                        <Icon name="arrow.up.right.square" />
                      </a>
                    )}
                    {p.teamHidden ? (
                      <Button icon="play.circle" onClick={async () => (await hideApi({ pageId: p.id, hidden: false }), list.reload())}>
                        {t("show")}
                      </Button>
                    ) : (
                      <Button variant="danger" icon="nosign" onClick={() => setHiding(p)}>
                        {t("hide")}
                      </Button>
                    )}
                  </span>
                }
              />
            ))
          ) : (
            <Empty>{t("noResults")}</Empty>
          )}
        </div>
      )}
      {hiding && <HideDialog title={t("hidePage", { name: hiding.title })} onClose={() => setHiding(null)} run={async (reason, tell) => (await hideApi({ pageId: hiding.id, reason, tell }), list.reload())} />}
    </>
  );
}

function Workspaces() {
  const { guard, can } = useAdmin();
  const { q, setQ, query } = useQuery();
  const [state, setState] = useState<"active" | "trash">("active");
  const list = useLoad(() => call<WorkspaceItem[]>("GET", `/admin/content/workspaces?${new URLSearchParams({ q: query, state })}`), [query, state]);
  const [moving, setMoving] = useState<WorkspaceItem | null>(null);
  const [trashing, setTrashing] = useState<{ w: WorkspaceItem; restore: boolean } | null>(null);
  return (
    <>
      <div className="filters">
        <Search q={q} setQ={setQ} placeholder={t("searchWorkspaces")} />
        <div className="filters-row">
          <Segmented
            label={t("status")}
            value={state}
            onChange={setState}
            options={[
              { value: "active", label: t("filterActive") },
              { value: "trash", label: t("trash") },
            ]}
          />
        </div>
      </div>
      {list.error && !list.data ? (
        <Failed error={list.error} retry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : (
        <div className="group">
          {list.data.length ? (
            list.data.map((w) => (
              <Row
                key={w.id}
                icon="square.stack.3d.up"
                label={<bdi dir="auto">{w.name}</bdi>}
                sub={`${t("ownerIs", { name: `@${w.owner.username}` })} · ${t("membersPages", { members: fmtNum(w.members), pages: fmtNum(w.pages) })}${w.deletedAt ? ` · ${t("deletedOn", { date: fmtDate(w.deletedAt) })}` : ""}`}
                trailing={
                  can("content.workspaces") && (
                    <span className="row-controls">
                      {!w.deletedAt && (
                        <Button icon="person.badge.key" onClick={() => setMoving(w)}>
                          {t("changeOwner")}
                        </Button>
                      )}
                      {w.deletedAt ? (
                        <Button icon="arrow.clockwise" onClick={() => setTrashing({ w, restore: true })}>
                          {t("restore")}
                        </Button>
                      ) : (
                        <IconButton icon="trash" label={t("remove")} onClick={() => setTrashing({ w, restore: false })} />
                      )}
                    </span>
                  )
                }
              />
            ))
          ) : (
            <Empty>{t("noResults")}</Empty>
          )}
        </div>
      )}
      {moving && <OwnerDialog w={moving} onClose={() => setMoving(null)} onDone={() => (setMoving(null), list.reload())} />}
      {trashing && (
        <ReasonOnly
          title={trashing.restore ? t("restore") : t("trashWorkspace", { name: trashing.w.name })}
          action={trashing.restore ? t("restore") : t("remove")}
          danger={!trashing.restore}
          onClose={() => setTrashing(null)}
          run={async (reason) => {
            await guard(() => call("POST", `/admin/content/workspaces/${trashing.w.id}/trash`, { reason, restore: trashing.restore }));
            list.reload();
          }}
        />
      )}
    </>
  );
}

function ReasonOnly({ title, action, danger, onClose, run }: { title: string; action: string; danger?: boolean; onClose: () => void; run: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button
            variant={danger ? "danger" : "accent"}
            icon={danger ? "trash" : "checkmark"}
            busy={busy}
            disabled={!reason.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await run(reason.trim());
                onClose();
              } catch (e) {
                if ((e as ApiError).code !== "cancelled") setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {action}
          </Button>
        </>
      }
    >
      <Field label={t("reason")} hint={t("reasonHint")}>
        <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </Field>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

function OwnerDialog({ w, onClose, onDone }: { w: WorkspaceItem; onClose: () => void; onDone: () => void }) {
  const { guard } = useAdmin();
  const members = useLoad(() => call<{ id: string; username: string; displayName: string; role: string }[]>("GET", `/admin/content/workspaces/${w.id}`), [w.id]);
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const options = (members.data ?? []).filter((m) => m.id !== w.owner.id).map((m) => ({ value: m.id, label: `${m.displayName} (@${m.username})` }));
  return (
    <Dialog
      title={t("changeOwner")}
      lead={t("changeOwnerLead")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button
            variant="accent"
            icon="checkmark"
            busy={busy}
            disabled={!to || !reason.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await guard(() => call("POST", `/admin/content/workspaces/${w.id}/owner`, { userId: to, reason: reason.trim() }));
                toast(t("save"));
                onDone();
              } catch (e) {
                if ((e as ApiError).code !== "cancelled") setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("save")}
          </Button>
        </>
      }
    >
      <Field label={t("newOwner")} as="div">
        {options.length ? <Popup label={t("newOwner")} value={to} onChange={setTo} options={[{ value: "", label: "..." }, ...options]} /> : <p className="field-hint">{t("noOtherMembers")}</p>}
      </Field>
      <Field label={t("reason")} hint={t("reasonHint")}>
        <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </Field>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

function Suspicious() {
  const list = useLoad(() => call<SuspiciousItem[]>("GET", "/admin/suspicious"), []);
  return list.error && !list.data ? (
    <Failed error={list.error} retry={list.reload} />
  ) : !list.data ? (
    <Loading />
  ) : (
    <Section title={t("tabSuspicious")} note={t("suspiciousLead")}>
      {list.data.length ? (
        list.data.map((u) => (
          <Row
            key={u.id}
            icon="exclamationmark.triangle"
            label={
              <span className="label-chips">
                <bdi>{u.displayName}</bdi> <bdi dir="ltr" className="muted">@{u.username}</bdi>
                {u.reasons.map((r) => (
                  <Chip key={r} tone="warning">
                    {t(`why_${r}` as Key)}
                  </Chip>
                ))}
              </span>
            }
            sub={`${u.email ?? ""} · ${t("joined", { date: fmtDate(u.createdAt) })}`}
            trailing={
              <span className="row-controls">
                <Button icon="checkmark" onClick={async () => (await call("POST", `/admin/suspicious/${u.id}/review`, {}), list.reload())}>
                  {t("looksFine")}
                </Button>
                <IconButton icon="person.crop.circle" label={t("account")} onClick={() => go("accounts", u.id)} />
              </span>
            }
          />
        ))
      ) : (
        <Empty>{t("noSuspicious")}</Empty>
      )}
    </Section>
  );
}
