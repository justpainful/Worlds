import { useEffect, useState } from "react";
import { call, type LogEntry, type UserDetail } from "../api";
import { go } from "../App";
import { ago, fmtDate, t, useLang, type Lang } from "../i18n";
import { Button, Chip, Empty, Icon, IconButton, Popup } from "../ui";
import type { SymbolName } from "../symbols";
import { Failed, Loading, Toolbar } from "./common";

type Group = "" | "auth." | "account." | "device." | "passkey." | "admin." | "workspace." | "profile.";

/** Each action in plain words. Unknown ones show their code. */
const ACTIONS: Record<string, [ar: string, en: string, icon: SymbolName]> = {
  "auth.signed_in": ["سجّل الدخول", "Signed in", "rectangle.portrait.and.arrow.right"],
  "auth.signed_out": ["سجّل الخروج", "Signed out", "rectangle.portrait.and.arrow.right"],
  "auth.email_code_sent": ["طلب رمز دخول", "Asked for a sign-in code", "envelope"],
  "auth.email_code_failed": ["أدخل رمزًا خاطئًا", "Entered a wrong code", "exclamationmark.triangle"],
  "auth.passkey_failed": ["فشل مفتاح الدخول", "A passkey failed", "exclamationmark.triangle"],
  "auth.refresh_reuse_detected": ["أُنهيت جلسة لسبب أمني", "A session ended for safety", "shield.lefthalf.filled"],
  "account.created": ["أنشأ الحساب", "Created the account", "person.crop.circle"],
  "account.updated": ["عدّل حسابه", "Changed their account", "pencil"],
  "passkey.added": ["أضاف مفتاح دخول", "Added a passkey", "key"],
  "passkey.removed": ["أزال مفتاح دخول", "Removed a passkey", "key"],
  "device.revoked": ["سُجّل خروج جهاز", "A device was signed out", "rectangle.portrait.and.arrow.right"],
  "profile.shown": ["أظهر ملفه العام", "Showed their profile", "person.text.rectangle"],
  "profile.hidden": ["أخفى ملفه العام", "Hid their profile", "person.text.rectangle"],
  "profile.published": ["نشر ملفه العام", "Published their profile", "person.text.rectangle"],
  "profile.removed": ["حذف ملفه العام", "Removed their profile", "person.text.rectangle"],
  "admin.confirmed": ["أكّد هويته في اللوحة", "Confirmed it was them on the dashboard", "touchid"],
  "admin.user.updated": ["عدّل الحساب من اللوحة", "Edited the account from the dashboard", "pencil"],
  "admin.user.suspended": ["أوقف الحساب", "Suspended the account", "pause.circle"],
  "admin.user.unsuspended": ["رفع الإيقاف", "Lifted the suspension", "play.circle"],
  "admin.user.banned": ["حظر الحساب", "Banned the account", "nosign"],
  "admin.user.unbanned": ["رفع الحظر", "Lifted the ban", "play.circle"],
  "admin.user.signed_out": ["سجّل خروج أجهزته من اللوحة", "Signed their devices out from the dashboard", "rectangle.portrait.and.arrow.right"],
  "admin.user.passkey_removed": ["أزال مفتاح دخوله من اللوحة", "Removed their passkey from the dashboard", "key"],
  "admin.note.added": ["أضاف ملاحظة", "Added a note", "text.page"],
  "admin.note.removed": ["أزال ملاحظة", "Removed a note", "text.page"],
  "admin.team.role_set": ["غيّر دوره في الفريق", "Set their team role", "person.badge.key"],
  "admin.team.removed": ["أزاله من الفريق", "Removed them from the team", "person.badge.key"],
};

function iconFor(action: string): SymbolName {
  if (ACTIONS[action]) return ACTIONS[action][2];
  if (action.startsWith("workspace") || action.startsWith("member") || action.startsWith("invite") || action.startsWith("group")) return "square.stack.3d.up";
  if (action.startsWith("page") || action.startsWith("permission")) return "text.document";
  if (action.startsWith("auth")) return "lock";
  return "info.circle";
}

function label(action: string, lang: Lang): string {
  const a = ACTIONS[action];
  return a ? a[lang === "ar" ? 0 : 1] : action;
}

function actor(e: LogEntry): string {
  if (e.actorKind === "system") return t("system");
  const who = e.actorName ?? (e.actorUsername ? `@${e.actorUsername}` : null);
  const base = who ?? (e.actorUserId ? e.actorUserId.slice(0, 8) : t("someone"));
  if (e.actorKind === "ai-on-behalf-of-user") return `${base} (${t("ai")})`;
  if (e.actorKind === "automation") return `${base} (${t("automation")})`;
  return base;
}

/** The meta as short "key: value" pairs, never more than a line or two. */
function metaText(meta: Record<string, unknown>): string {
  return Object.entries(meta)
    .filter(([k]) => k !== "role")
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

export function LogRows({ entries, compact }: { entries: LogEntry[]; compact?: boolean }) {
  const lang = useLang();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      {entries.map((e) => {
        const meta = metaText(e.meta);
        const isOpen = open === e.id;
        return (
          <div key={e.id} className={`log-row ${isOpen ? "is-open" : ""}`}>
            <span className="row-icon">
              <Icon name={iconFor(e.action)} />
            </span>
            <button type="button" className="log-main" aria-expanded={meta ? isOpen : undefined} onClick={() => meta && setOpen(isOpen ? null : e.id)}>
              <span className="log-label">
                {label(e.action, lang)}
                {e.meta.role ? <Chip>{t(`role_${e.meta.role as "owner"}`)}</Chip> : null}
              </span>
              <span className="row-sub">
                {!compact && (
                  <>
                    <bdi>{actor(e)}</bdi>
                    {e.targetName && e.targetId !== e.actorUserId && (
                      <>
                        {" "}
                        {t("onAccount")} <bdi>{e.targetName}</bdi>
                      </>
                    )}
                    {" · "}
                  </>
                )}
                <time dateTime={new Date(e.at).toISOString()} title={fmtDate(e.at, true)}>
                  {ago(e.at)}
                </time>
              </span>
              {meta && isOpen && (
                <span className="log-meta" dir="ltr">
                  {meta}
                </span>
              )}
            </button>
            {!compact && e.targetType === "user" && e.targetId && e.targetId !== e.actorUserId && (
              <IconButton icon="person.crop.circle" label={t("account")} onClick={() => go("accounts", e.targetId!)} />
            )}
          </div>
        );
      })}
    </>
  );
}

const GROUPS: { value: Group; key: Parameters<typeof t>[0] }[] = [
  { value: "", key: "logAll" },
  { value: "auth.", key: "logAuth" },
  { value: "account.", key: "logAccount" },
  { value: "device.", key: "logDevice" },
  { value: "passkey.", key: "logPasskey" },
  { value: "profile.", key: "logProfile" },
  { value: "workspace.", key: "logWorkspace" },
  { value: "admin.", key: "logAdmin" },
];

export function Log({ params }: { params: URLSearchParams }) {
  useLang();
  const user = params.get("user") ?? "";
  const [group, setGroup] = useState<Group>("");
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [who, setWho] = useState<string>("");

  const load = async (before?: number) => {
    setBusy(true);
    try {
      const q = new URLSearchParams({ limit: "100" });
      if (user) q.set("user", user);
      if (group) q.set("action", group);
      if (before) q.set("before", String(before));
      const r = await call<{ entries: LogEntry[]; next: number | null }>("GET", `/admin/audit?${q}`);
      setEntries((old) => (before && old ? [...old, ...r.entries] : r.entries));
      setNext(r.next);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    setEntries(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, group]);
  useEffect(() => {
    setWho("");
    if (user)
      call<UserDetail>("GET", `/admin/users/${encodeURIComponent(user)}`)
        .then((u) => setWho(u.displayName || `@${u.username}`))
        .catch(() => setWho(user.slice(0, 8)));
  }, [user]);

  return (
    <div className="view">
      <Toolbar title={t("log")}>
        <IconButton icon="arrow.clockwise" label={t("refresh")} onClick={() => load()} disabled={busy} />
      </Toolbar>
      <div className="page narrow">
        <div className="filters-row">
          <Popup label={t("logFilter")} icon="line.3.horizontal.decrease.circle" value={group} onChange={setGroup} options={GROUPS.map((g) => ({ value: g.value, label: t(g.key) }))} />
          {user && (
            <span className="filter-chip glass">
              <Icon name="person.crop.circle" size={15} />
              <button type="button" className="link-btn" onClick={() => go("accounts", user)}>
                {t("forAccount", { name: who || "..." })}
              </button>
              <button type="button" className="search-clear" aria-label={t("clearFilter")} onClick={() => go("log")}>
                <Icon name="xmark" size={12} />
              </button>
            </span>
          )}
        </div>
        {error && !entries ? (
          <Failed error={error} retry={() => load()} />
        ) : !entries ? (
          <Loading />
        ) : (
          <>
            <div className="group">{entries.length ? <LogRows entries={entries} /> : <Empty>{t("noLog")}</Empty>}</div>
            {next && (
              <div className="more">
                <Button icon="chevron.down" busy={busy} onClick={() => load(next)}>
                  {t("loadMore")}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
