import { useEffect, useState } from "react";
import { ApiError, call, callBlob, type TeamMember, type Ticket, type TicketDetail, type TicketKind, type TicketMessage, type TicketStatus } from "../api";
import { go, useAdmin } from "../App";
import { ago, errorText, fmtDate, fmtNum, t, useLang, type Key } from "../i18n";
import { Button, Chip, Empty, Icon, IconButton, Popup, Row, Section, Segmented, toast } from "../ui";
import type { SymbolName } from "../symbols";
import { Failed, Loading, Toolbar, useLoad } from "./common";
import { PLATFORM_NAME } from "./Overview";

type Filter = "active" | "waiting" | "solved" | "closed" | "all";

export const KIND_ICON: Record<TicketKind, SymbolName> = {
  problem: "exclamationmark.triangle",
  account: "person.crop.circle",
  recovery: "key",
  deletion: "trash",
  report: "hand.raised",
  security: "lock",
  suggestion: "character.bubble",
  other: "ellipsis.circle",
};
const KINDS = Object.keys(KIND_ICON) as TicketKind[];

const statusTone = (s: TicketStatus) => (s === "open" ? "accent" : s === "working" ? "warning" : s === "solved" ? "success" : "plain") as "accent" | "warning" | "success" | "plain";

export function Support({ id }: { id?: string }) {
  useLang();
  const [filter, setFilter] = useState<Filter>("active");
  const [kind, setKind] = useState<"" | TicketKind>("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(h);
  }, [q]);
  const list = useLoad(
    () => call<{ total: number; counts: Record<string, number>; requests: Ticket[] }>("GET", `/admin/support?${new URLSearchParams({ status: filter, kind, q: query })}`),
    [filter, kind, query],
  );
  const counts = list.data?.counts ?? {};
  const label = (f: Filter) => {
    const n = f === "active" ? (counts.open ?? 0) + (counts.working ?? 0) : f === "all" ? undefined : counts[f];
    return n ? `${t(`st_${f}`)} ${fmtNum(n)}` : t(`st_${f}`);
  };

  return (
    <div className={`view split ${id ? "has-detail" : ""}`}>
      <div className="split-list">
        <Toolbar title={t("support")} subtitle={list.data ? t("requestsCount", { n: fmtNum(list.data.total) }) : undefined}>
          <IconButton icon="arrow.clockwise" label={t("refresh")} onClick={list.reload} disabled={list.loading} />
        </Toolbar>
        <div className="page">
          <div className="filters">
            <label className="search glass">
              <Icon name="magnifyingglass" size={15} />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchRequests")} aria-label={t("search")} />
            </label>
            <div className="filters-row">
              <Segmented
                label={t("status")}
                value={filter}
                onChange={setFilter}
                options={(["active", "waiting", "solved", "closed", "all"] as Filter[]).map((f) => ({ value: f, label: label(f) }))}
              />
              <Popup
                label={t("kind")}
                icon="line.3.horizontal.decrease.circle"
                value={kind}
                onChange={setKind}
                options={[{ value: "" as const, label: t("allKinds") }, ...KINDS.map((k) => ({ value: k, label: t(`kind_${k}`) }))]}
              />
            </div>
          </div>
          {list.error && !list.data ? (
            <Failed error={list.error} retry={list.reload} />
          ) : !list.data ? (
            <Loading />
          ) : (
            <div className="group list" role="list">
              {list.data.requests.length ? list.data.requests.map((r) => <TicketRow key={r.id} r={r} selected={String(r.number) === id} />) : <Empty>{t("noRequests")}</Empty>}
            </div>
          )}
        </div>
      </div>
      <div className="split-detail">{id ? <TicketView key={id} number={id} onChanged={list.reload} /> : <div className="state muted">{t("chooseRequest")}</div>}</div>
    </div>
  );
}

function TicketRow({ r, selected }: { r: Ticket; selected: boolean }) {
  const waiting = r.lastAuthor === "person" && r.status !== "solved" && r.status !== "closed";
  return (
    <a href={`#/support/${r.number}`} className={`user-row ticket-row ${selected ? "is-on" : ""}`} role="listitem" aria-current={selected || undefined}>
      <span className={`ticket-kind ${waiting ? "is-waiting" : ""}`} title={waiting ? t("needsReply") : undefined}>
        <Icon name={KIND_ICON[r.kind]} />
      </span>
      <span className="user-main">
        <span className="user-name">
          <span className="ref">{r.ref}</span>
          <bdi dir="auto">{r.subject}</bdi>
        </span>
        <span className="user-sub">
          <bdi dir="auto">{r.userName ?? r.name ?? r.email ?? ""}</bdi>
          {" · "}
          {t(`kind_${r.kind}`)}
        </span>
      </span>
      <span className="user-meta">
        <span className="chips">
          {(r.priority === "high" || r.priority === "urgent") && <Chip tone="danger">{t(`pr_${r.priority}`)}</Chip>}
          <Chip tone={statusTone(r.status)}>{t(`st_${r.status}`)}</Chip>
        </span>
        <span className="muted">{ago(r.updatedAt)}</span>
      </span>
    </a>
  );
}

function Picture({ fileKey }: { fileKey: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    callBlob(`/admin/support-files/${fileKey}`)
      .then((x) => setUrl((u = x)))
      .catch(() => setUrl(null));
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [fileKey]);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer noopener" className="thumb">
      <img src={url} alt="" />
    </a>
  ) : (
    <span className="thumb is-empty" />
  );
}

function Bubble({ m }: { m: TicketMessage }) {
  if (m.author === "system")
    return (
      <div className="bubble-system">
        <Icon name="info.circle" size={14} /> {m.body === "closed_after_a_week" ? t("systemClosed") : m.body} · {fmtDate(m.createdAt, true)}
      </div>
    );
  const via = m.via === "email" ? t("viaEmail") : m.via === "app" ? t("viaApp") : m.via === "web" ? t("viaWeb") : "";
  return (
    <div className={`bubble bubble-${m.author}`}>
      <div className="bubble-head">
        {m.author === "note" && <Icon name="text.page" size={13} />}
        <bdi>{m.author === "note" ? t("internalNote") : (m.authorName ?? (m.author === "team" ? "Worlds" : t("requester")))}</bdi>
        {m.author === "note" && m.authorName ? (
          <>
            {" · "}
            <bdi>{m.authorName}</bdi>
          </>
        ) : null}
        <span className="muted">
          {" · "}
          <time title={fmtDate(m.createdAt, true)}>{ago(m.createdAt)}</time>
          {via ? ` · ${via}` : ""}
        </span>
      </div>
      <div className="bubble-body" dir="auto">
        {m.body}
      </div>
      {m.files.length > 0 && (
        <div className="thumbs">
          {m.files.map((f) => (
            <Picture key={f} fileKey={f} />
          ))}
        </div>
      )}
    </div>
  );
}

function TicketView({ number, onChanged }: { number: string; onChanged: () => void }) {
  const { can } = useAdmin();
  const { data: r, error, reload } = useLoad(() => call<TicketDetail>("GET", `/admin/support/${encodeURIComponent(number)}`), [number]);
  const team = useLoad(() => call<TeamMember[]>("GET", "/admin/team"), []);
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const patch = async (body: Record<string, unknown>) => {
    try {
      await call("PATCH", `/admin/support/${number}`, body);
      await reload();
      onChanged();
    } catch (e) {
      toast(errorText(e), "error");
    }
  };
  const send = async (status?: "solved") => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      if (mode === "note") await call("POST", `/admin/support/${number}/note`, { body: text.trim() });
      else {
        const res = await call<{ mailed: boolean }>("POST", `/admin/support/${number}/reply`, { body: text.trim(), status });
        toast(res.mailed ? t("sent") : t("sentNotMailed"), res.mailed ? "ok" : "error");
      }
      setText("");
      await reload();
      onChanged();
    } catch (e) {
      if ((e as ApiError).code !== "cancelled") toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const back = (
    <span className="only-narrow">
      <IconButton icon="chevron.left" label={t("back")} onClick={() => go("support")} />
    </span>
  );
  if (error && !r)
    return (
      <div className="view">
        <Toolbar title={t("support")} back={back} />
        <Failed error={error} retry={reload} />
      </div>
    );
  if (!r)
    return (
      <div className="view">
        <Toolbar title={t("support")} back={back} />
        <Loading />
      </div>
    );

  const fields = Object.entries(r.fields);
  return (
    <div className="view">
      <Toolbar title={r.ref} subtitle={<bdi dir="auto">{r.subject}</bdi>} back={back}>
        <IconButton icon="arrow.clockwise" label={t("refresh")} onClick={reload} />
      </Toolbar>
      <div className="page">
        <div className="ticket-controls">
          <Chip>
            {t(`kind_${r.kind}`)}
          </Chip>
          {r.private && <Chip tone="danger">{t("privateReport")}</Chip>}
          <span className="spacer" />
          <Popup
            label={t("status")}
            value={r.status}
            onChange={(v) => patch({ status: v })}
            options={(["open", "waiting", "working", "solved", "closed"] as TicketStatus[]).map((s) => ({ value: s, label: t(`st_${s}`) }))}
          />
          <Popup label={t("priority")} value={r.priority} onChange={(v) => patch({ priority: v })} options={(["low", "normal", "high", "urgent"] as const).map((p) => ({ value: p, label: t(`pr_${p}`) }))} />
          <Popup
            label={t("assignee")}
            icon="person.crop.circle"
            value={r.assignee?.id ?? ""}
            onChange={(v) => patch({ assignee: v || null })}
            options={[{ value: "", label: t("nobody") }, ...(team.data ?? []).map((m) => ({ value: m.id, label: m.displayName }))]}
          />
        </div>

        <div className="grid-2 ticket-grid">
          <div>
            <Section title={t("conversation")}>
              <div className="thread">
                {r.messages.map((m) => (
                  <Bubble key={m.id} m={m} />
                ))}
              </div>
              <div className="composer">
                <Segmented
                  label={t("reply")}
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "reply", label: t("reply"), icon: "envelope" },
                    { value: "note", label: t("note"), icon: "text.page" },
                  ]}
                />
                <textarea
                  className={`input ${mode === "note" ? "is-note" : ""}`}
                  rows={5}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={mode === "note" ? t("notePlaceholder2") : t("replyPlaceholder")}
                  aria-label={mode === "note" ? t("addInternal") : t("reply")}
                  dir="auto"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
                  }}
                />
                <div className="composer-actions">
                  {mode === "reply" ? (
                    <>
                      <Button icon="checkmark" busy={busy} disabled={!text.trim()} onClick={() => send("solved")}>
                        {t("sendSolved")}
                      </Button>
                      <Button variant="accent" icon="envelope" busy={busy} disabled={!text.trim()} onClick={() => send()}>
                        {t("send")}
                      </Button>
                    </>
                  ) : (
                    <Button variant="accent" icon="plus" busy={busy} disabled={!text.trim()} onClick={() => send()}>
                      {t("addInternal")}
                    </Button>
                  )}
                </div>
              </div>
            </Section>
          </div>
          <div>
            <Section title={t("requester")}>
              <Row icon="person.crop.circle" label={<bdi>{r.userName ?? r.name ?? t("requester")}</bdi>} sub={r.userUsername ? <bdi dir="ltr">@{r.userUsername}</bdi> : t("noAccountLinked")} />
              {r.email && <Row icon="envelope" label={t("email")} sub={<bdi dir="ltr">{r.email}</bdi>} />}
              <Row icon="calendar" label={t("created")} value={fmtDate(r.createdAt, true)} />
              {r.rating !== null && <Row icon="checkmark" label={t("rated")} value={r.rating ? t("ratedYes") : t("ratedNo")} />}
              {r.userId && can("users.read") && <Row icon="chevron.right" label={t("openAccount")} onClick={() => go("accounts", r.userId!)} />}
            </Section>
            {fields.length > 0 && (
              <Section title={t("details")}>
                {fields.map(([k, v]) => (
                  <Row key={k} label={(`f_${k}` as Key) in fieldKeys ? t(`f_${k}` as Key) : k} sub={<bdi dir="auto">{fieldValue(k, v)}</bdi>} />
                ))}
              </Section>
            )}
            {r.others.length > 0 && (
              <Section title={t("otherRequests")}>
                {r.others.map((o) => (
                  <Row key={o.number} label={<bdi dir="auto">{o.subject}</bdi>} sub={`W-${o.number} · ${fmtDate(o.createdAt)}`} value={t(`st_${o.status}`)} onClick={() => go("support", String(o.number))} />
                ))}
              </Section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Choices the support form sends as codes, shown in words. */
function fieldValue(k: string, v: string): string {
  if (k === "platform") return PLATFORM_NAME[v] ?? v;
  const key = `v_${k}_${v}` as Key;
  return VALUE_KEYS.has(key) ? t(key) : v;
}
const VALUE_KEYS = new Set<string>(
  ["issue_code", "issue_passkey", "issue_name", "issue_signin", "issue_other", "request_delete", "request_export", "request_web", "reason_abuse", "reason_impersonation", "reason_illegal", "reason_scam", "reason_copyright", "reason_other"].map((x) => `v_${x}`),
);

const fieldKeys = Object.fromEntries(
  ["platform", "version", "steps", "expected", "username", "issue", "oldEmail", "newEmail", "devices", "joined", "workspaces", "request", "link", "reason", "diagnostics"].map((k) => [`f_${k}`, true]),
);
