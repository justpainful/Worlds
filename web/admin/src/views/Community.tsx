import { useState } from "react";
import { call } from "../api";
import { go } from "../App";
import { ago, errorText, fmtDate, fmtNum, t, useLang } from "../i18n";
import { Button, Chip, Dialog, Empty, Field, IconButton, MenuButton, Popup, Row, Section, Segmented, toast } from "../ui";
import { Failed, Loading, Toolbar, useLoad } from "./common";

type Tab = "ideas" | "testers" | "surveys" | "messages";
type IdeaStatus = "new" | "planned" | "working" | "shipped" | "declined" | "duplicate";

interface Idea {
  id: string;
  number: number;
  title: string;
  body: string;
  status: IdeaStatus;
  public: boolean;
  shippedIn: string | null;
  votes: number;
  createdAt: number;
  userId: string | null;
  userName: string | null;
  email: string | null;
  mergedInto: string | null;
}
interface Tester {
  userId: string;
  displayName: string;
  username: string;
  status: "applied" | "accepted" | "removed";
  platforms: string[];
  note: string | null;
  appliedAt: number;
}
interface Survey {
  id: string;
  question: { ar: string; en: string };
  choices: { ar: string; en: string }[];
  audience: string;
  active: boolean;
  createdAt: number;
  answers: number;
  counts: number[];
  texts: { text: string; at: number }[];
}
interface Thread {
  id: string;
  userId: string;
  displayName: string;
  username: string;
  subject: string;
  status: string;
  updatedAt: number;
  lastAuthor: string;
  last: string;
}

const STATUSES: IdeaStatus[] = ["new", "planned", "working", "shipped", "declined"];

export function Community() {
  useLang();
  const [tab, setTab] = useState<Tab>("ideas");
  return (
    <div className="view">
      <Toolbar title={t("community")} />
      <div className="page">
        <div className="filters-row">
          <Segmented
            label={t("community")}
            value={tab}
            onChange={setTab}
            options={[
              { value: "ideas", label: t("ideas"), icon: "character.bubble" },
              { value: "testers", label: t("testers"), icon: "person.2" },
              { value: "surveys", label: t("surveys"), icon: "chart.bar.xaxis" },
              { value: "messages", label: t("messages"), icon: "envelope" },
            ]}
          />
        </div>
        {tab === "ideas" && <Ideas />}
        {tab === "testers" && <Testers />}
        {tab === "surveys" && <Surveys />}
        {tab === "messages" && <Messages />}
      </div>
    </div>
  );
}

function Ideas() {
  const [status, setStatus] = useState("");
  const list = useLoad(() => call<Idea[]>("GET", `/admin/suggestions?${new URLSearchParams(status ? { status } : {})}`), [status]);
  const [shipping, setShipping] = useState<Idea | null>(null);
  const patch = async (id: string, body: Record<string, unknown>) => {
    try {
      const r = await call<{ told: number }>("PATCH", `/admin/suggestions/${id}`, body);
      if (r.told) toast(t("toldVoters", { n: r.told }));
      list.reload();
    } catch (e) {
      toast(errorText(e), "error");
    }
  };
  return (
    <>
      <div className="filters-row">
        <Popup
          label={t("status")}
          icon="line.3.horizontal.decrease.circle"
          value={status}
          onChange={setStatus}
          options={[{ value: "", label: t("st_all") }, ...STATUSES.map((s) => ({ value: s, label: t(`idea_${s}`) })), { value: "duplicate", label: t("idea_duplicate") }]}
        />
      </div>
      {list.error && !list.data ? (
        <Failed error={list.error} retry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : (
        <Section title={t("ideas")} note={t("ideasLead")}>
          {list.data.length ? (
            list.data.map((s) => (
              <Row
                key={s.id}
                icon="character.bubble"
                label={
                  <span className="label-chips">
                    <span className="ref">#{s.number}</span>
                    <bdi dir="auto">{s.title}</bdi>
                    {!s.public && s.status !== "duplicate" && <Chip tone="warning">{t("notOnBoard")}</Chip>}
                    {s.shippedIn && <Chip tone="success">{s.shippedIn}</Chip>}
                  </span>
                }
                sub={
                  <>
                    <bdi dir="auto">{s.body || ""}</bdi>
                    {s.body ? " · " : ""}
                    {t("votesN", { n: fmtNum(s.votes) })} · <bdi>{s.userName ?? s.email ?? ""}</bdi> · {ago(s.createdAt)}
                  </>
                }
                trailing={
                  <span className="row-controls">
                    <Popup
                      label={t("status")}
                      value={s.status}
                      onChange={(v) => (v === "shipped" ? setShipping(s) : patch(s.id, { status: v }))}
                      options={[...STATUSES, ...(s.status === "duplicate" ? (["duplicate"] as IdeaStatus[]) : [])].map((x) => ({ value: x, label: t(`idea_${x}`) }))}
                    />
                    <MenuButton
                      icon="ellipsis.circle"
                      label={t("more")}
                      items={[
                        { key: "pub", label: s.public ? t("removeFromBoard") : t("putOnBoard"), icon: s.public ? "nosign" : "checkmark", onSelect: () => void patch(s.id, { public: !s.public }) },
                        ...(list.data ?? [])
                          .filter((o) => o.id !== s.id && o.status !== "duplicate")
                          .slice(0, 8)
                          .map((o) => ({
                            key: `m${o.id}`,
                            label: t("mergeInto", { n: o.number }),
                            icon: "document.on.document" as const,
                            onSelect: async () => {
                              await call("POST", `/admin/suggestions/${s.id}/merge`, { into: o.id }).catch((e) => toast(errorText(e), "error"));
                              list.reload();
                            },
                          })),
                      ]}
                    />
                  </span>
                }
              />
            ))
          ) : (
            <Empty>{t("noIdeas")}</Empty>
          )}
        </Section>
      )}
      {shipping && <ShipDialog idea={shipping} onClose={() => setShipping(null)} onShip={async (v) => (await patch(shipping.id, { status: "shipped", shippedIn: v }), setShipping(null))} />}
    </>
  );
}

function ShipDialog({ idea, onClose, onShip }: { idea: Idea; onClose: () => void; onShip: (version: string) => Promise<void> }) {
  const [version, setVersion] = useState(idea.shippedIn ?? "");
  return (
    <Dialog
      title={t("markShipped")}
      lead={t("markShippedLead")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button variant="accent" icon="checkmark" disabled={!version.trim()} onClick={() => onShip(version.trim())}>
            {t("idea_shipped")}
          </Button>
        </>
      }
    >
      <Field label={t("f_version")}>
        <input className="input" dir="ltr" value={version} placeholder="1.1.0" onChange={(e) => setVersion(e.target.value)} maxLength={20} />
      </Field>
    </Dialog>
  );
}

function Testers() {
  const list = useLoad(() => call<Tester[]>("GET", "/admin/testers"), []);
  const decide = async (id: string, status: "accepted" | "removed") => {
    await call("POST", `/admin/testers/${id}`, { status }).catch((e) => toast(errorText(e), "error"));
    list.reload();
  };
  return list.error && !list.data ? (
    <Failed error={list.error} retry={list.reload} />
  ) : !list.data ? (
    <Loading />
  ) : (
    <Section title={t("testers")} note={t("testersLead")}>
      {list.data.length ? (
        list.data.map((x) => (
          <Row
            key={x.userId}
            icon="person.crop.circle"
            label={
              <span className="label-chips">
                <bdi>{x.displayName}</bdi> <bdi dir="ltr" className="muted">@{x.username}</bdi>
                <Chip tone={x.status === "accepted" ? "success" : x.status === "applied" ? "accent" : "plain"}>{t(`tester_${x.status}`)}</Chip>
              </span>
            }
            sub={[x.platforms.join(", "), x.note, fmtDate(x.appliedAt)].filter(Boolean).join(" · ")}
            trailing={
              <span className="row-controls">
                {x.status !== "accepted" && (
                  <Button icon="checkmark" onClick={() => decide(x.userId, "accepted")}>
                    {t("accept")}
                  </Button>
                )}
                {x.status !== "removed" && <IconButton icon="xmark" label={t("remove")} onClick={() => decide(x.userId, "removed")} />}
              </span>
            }
          />
        ))
      ) : (
        <Empty>{t("noTesters")}</Empty>
      )}
    </Section>
  );
}

function Surveys() {
  const lang = useLang();
  const list = useLoad(() => call<Survey[]>("GET", "/admin/surveys"), []);
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="filters-row">
        <span />
        <Button variant="accent" icon="plus" onClick={() => setCreating(true)}>
          {t("newSurvey")}
        </Button>
      </div>
      {list.error && !list.data ? (
        <Failed error={list.error} retry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : list.data.length ? (
        list.data.map((s) => (
          <Section
            key={s.id}
            title={`${s.question[lang]} · ${t("answersN", { n: fmtNum(s.answers) })}`}
            trailing={
              <Button
                icon={s.active ? "pause.circle" : "play.circle"}
                onClick={async () => {
                  await call("PATCH", `/admin/surveys/${s.id}`, { active: !s.active });
                  list.reload();
                }}
              >
                {s.active ? t("stop") : t("resume")}
              </Button>
            }
          >
            {s.choices.length
              ? s.choices.map((ch, i) => {
                  const n = s.counts[i] ?? 0;
                  const pct = s.answers ? Math.round((n / s.answers) * 100) : 0;
                  return (
                    <div key={i} className="row survey-row">
                      <span className="row-main">
                        <span className="row-label">{ch[lang]}</span>
                        <span className="bar" aria-hidden>
                          <span style={{ width: `${pct}%` }} />
                        </span>
                      </span>
                      <span className="row-value">
                        {fmtNum(n)} · {pct}%
                      </span>
                    </div>
                  );
                })
              : s.texts.length
                ? s.texts.map((x, i) => <Row key={i} label={<bdi dir="auto">{x.text}</bdi>} sub={ago(x.at)} />)
                : <Empty>{t("noAnswers")}</Empty>}
          </Section>
        ))
      ) : (
        <Empty>{t("noSurveys")}</Empty>
      )}
      {creating && <SurveyDialog onClose={() => setCreating(false)} onDone={() => (setCreating(false), list.reload())} />}
    </>
  );
}

function SurveyDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [qAr, setQAr] = useState("");
  const [qEn, setQEn] = useState("");
  const [choices, setChoices] = useState<{ ar: string; en: string }[]>([
    { ar: "", en: "" },
    { ar: "", en: "" },
  ]);
  const [audience, setAudience] = useState<"all" | "testers">("all");
  const [free, setFree] = useState(false);
  const [busy, setBusy] = useState(false);
  const ok = qAr.trim() && qEn.trim() && (free || choices.filter((c) => c.ar.trim() && c.en.trim()).length >= 2);
  return (
    <Dialog
      title={t("newSurvey")}
      lead={t("surveyLead")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button
            variant="accent"
            icon="checkmark"
            busy={busy}
            disabled={!ok}
            onClick={async () => {
              setBusy(true);
              try {
                await call("POST", "/admin/surveys", { questionAr: qAr.trim(), questionEn: qEn.trim(), audience, choices: free ? [] : choices.filter((c) => c.ar.trim() && c.en.trim()) });
                onDone();
              } catch (e) {
                toast(errorText(e), "error");
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
      <Field label={t("questionAr")}>
        <input className="input" dir="rtl" value={qAr} onChange={(e) => setQAr(e.target.value)} maxLength={300} />
      </Field>
      <Field label={t("questionEn")}>
        <input className="input" dir="ltr" value={qEn} onChange={(e) => setQEn(e.target.value)} maxLength={300} />
      </Field>
      <Field label={t("audience")} as="div">
        <Segmented
          label={t("audience")}
          value={audience}
          onChange={setAudience}
          options={[
            { value: "all", label: t("audienceAll") },
            { value: "testers", label: t("testers") },
          ]}
        />
      </Field>
      <label className="check">
        <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} />
        <span>{t("freeAnswer")}</span>
      </label>
      {!free &&
        choices.map((c, i) => (
          <div key={i} className="choice-pair">
            <input className="input" dir="rtl" placeholder={`${t("choice")} ${i + 1}`} value={c.ar} onChange={(e) => setChoices(choices.map((x, j) => (j === i ? { ...x, ar: e.target.value } : x)))} maxLength={80} />
            <input className="input" dir="ltr" placeholder={`Choice ${i + 1}`} value={c.en} onChange={(e) => setChoices(choices.map((x, j) => (j === i ? { ...x, en: e.target.value } : x)))} maxLength={80} />
          </div>
        ))}
      {!free && choices.length < 8 && (
        <Button icon="plus" onClick={() => setChoices([...choices, { ar: "", en: "" }])}>
          {t("addChoice")}
        </Button>
      )}
    </Dialog>
  );
}

function Messages() {
  const list = useLoad(() => call<Thread[]>("GET", "/admin/messages"), []);
  const [open, setOpen] = useState<string | null>(null);
  return list.error && !list.data ? (
    <Failed error={list.error} retry={list.reload} />
  ) : !list.data ? (
    <Loading />
  ) : (
    <>
      <Section title={t("messages")} note={t("messagesLead")}>
        {list.data.length ? (
          list.data.map((m) => (
            <Row
              key={m.id}
              icon={m.lastAuthor === "person" ? "envelope" : "text.page"}
              label={
                <span className="label-chips">
                  <bdi dir="auto">{m.subject}</bdi>
                  {m.lastAuthor === "person" && <Chip tone="accent">{t("needsReply")}</Chip>}
                  {m.status === "closed" && <Chip>{t("st_closed")}</Chip>}
                </span>
              }
              sub={
                <>
                  <bdi>{m.displayName}</bdi> · <bdi dir="auto">{m.last}</bdi> · {ago(m.updatedAt)}
                </>
              }
              onClick={() => setOpen(m.id)}
            />
          ))
        ) : (
          <Empty>{t("noMessages")}</Empty>
        )}
      </Section>
      {open && <ThreadDialog id={open} onClose={() => (setOpen(null), list.reload())} />}
    </>
  );
}

function ThreadDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const th = useLoad(
    () => call<{ id: string; userId: string; displayName: string; subject: string; status: string; messages: { id: string; author: string; authorName: string | null; body: string; createdAt: number }[] }>("GET", `/admin/messages/${id}`),
    [id],
  );
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  if (!th.data) return null;
  const d = th.data;
  return (
    <Dialog
      title={d.subject}
      lead={d.displayName}
      onClose={onClose}
      footer={
        <>
          <Button icon="xmark" onClick={async () => (await call("POST", `/admin/messages/${id}`, { close: true }), onClose())}>
            {t("closeThread")}
          </Button>
          <Button icon="person.crop.circle" onClick={() => (onClose(), go("accounts", d.userId))}>
            {t("account")}
          </Button>
          <Button
            variant="accent"
            icon="envelope"
            busy={busy}
            disabled={!text.trim()}
            onClick={async () => {
              setBusy(true);
              await call("POST", `/admin/messages/${id}`, { body: text.trim() }).catch((e) => toast(errorText(e), "error"));
              setText("");
              setBusy(false);
              th.reload();
            }}
          >
            {t("send")}
          </Button>
        </>
      }
    >
      <div className="thread">
        {d.messages.map((m) => (
          <div key={m.id} className={`bubble ${m.author === "team" ? "bubble-team" : "bubble-person"}`}>
            <div className="bubble-head">
              <bdi>{m.author === "team" ? (m.authorName ?? "Worlds") : d.displayName}</bdi>
              <span className="muted"> · {ago(m.createdAt)}</span>
            </div>
            <div className="bubble-body" dir="auto">
              {m.body}
            </div>
          </div>
        ))}
      </div>
      <textarea className="input" rows={3} dir="auto" value={text} onChange={(e) => setText(e.target.value)} aria-label={t("reply")} />
    </Dialog>
  );
}

/** "Write to them" on an account page. */
export function MessageDialog({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [email, setEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title={t("writeTo")}
      lead={t("writeToLead")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button
            variant="accent"
            icon="envelope"
            busy={busy}
            disabled={!subject.trim() || !body.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await call("POST", `/admin/users/${encodeURIComponent(userId)}/messages`, { subject: subject.trim(), body: body.trim(), email });
                toast(t("sent"));
                onClose();
              } catch (e) {
                toast(errorText(e), "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("send")}
          </Button>
        </>
      }
    >
      <Field label={t("subject")}>
        <input className="input" dir="auto" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={140} />
      </Field>
      <Field label={t("message")}>
        <textarea className="input" rows={5} dir="auto" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} />
        <span>{t("alsoEmail")}</span>
      </label>
    </Dialog>
  );
}

