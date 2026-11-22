import { useEffect, useState } from "react";
import { ApiError, call } from "../api";
import { useAdmin } from "../App";
import { ago, errorText, fmtDate, fmtNum, t, useLang } from "../i18n";
import { Button, Chip, Dialog, Empty, Field, IconButton, Popup, Row, Section, Segmented, Switch, toast } from "../ui";
import { Failed, Loading, Toolbar, useLoad } from "./common";

type L = { ar: string; en: string };
interface Settings {
  signups: { mode: "open" | "closed" | "invite" };
  maintenance: { on: boolean; readOnly: boolean; message: L };
  minVersion: Record<string, { version: string; dismissible: boolean }>;
  publishing: { paused: boolean };
  incident: { on: boolean; title: L; body: L; startedAt: number | null; updates: { at: number; text: L }[] };
}
interface ControlData {
  settings: Settings;
  flags: { key: string; description: string | null; mode: string; percent: number; users: string[] }[];
  announcements: { id: string; text: L; level: string; platforms: string[]; minVersion: string | null; maxVersion: string | null; endsAt: number | null; active: boolean; createdAt: number }[];
  invites: { id: string; label: string | null; maxUses: number; uses: number; expiresAt: number | null }[];
  waitlist: { email: string | null; invitedAt: number | null }[];
  waitlistCount: number;
  blocked: { value: string; kind: string; reason: string | null; addedAt: number }[];
}

const PLATFORMS = ["windows", "macos", "linux", "ios", "android", "web"];

export function Control() {
  useLang();
  const { can, guard } = useAdmin();
  const { data, error, reload } = useLoad(() => call<ControlData>("GET", "/admin/control"), []);
  const write = can("control");
  const save = async (key: keyof Settings, value: unknown) => {
    try {
      await guard(() => call("PUT", `/admin/control/settings/${key}`, { value }));
      toast(t("saved"));
      reload();
    } catch (e) {
      if ((e as ApiError).code !== "cancelled") toast(errorText(e), "error");
    }
  };
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await guard(fn);
      reload();
    } catch (e) {
      if ((e as ApiError).code !== "cancelled") toast(errorText(e), "error");
    }
  };
  if (error && !data)
    return (
      <div className="view">
        <Toolbar title={t("control")} />
        <Failed error={error} retry={reload} />
      </div>
    );
  if (!data)
    return (
      <div className="view">
        <Toolbar title={t("control")} />
        <Loading />
      </div>
    );
  const s = data.settings;
  return (
    <div className="view">
      <Toolbar title={t("control")} subtitle={t("controlLead")} />
      <div className="page grid-2">
        <div>
          <Signups s={s} data={data} write={write} save={save} act={act} />
          <Maintenance s={s} write={write} save={save} />
          <Incident s={s} write={write} save={save} />
          <Section title={t("publishingTitle")} note={t("publishingLead")}>
            <Row icon="text.document" label={t("pausePublishing")} trailing={<Switch checked={s.publishing.paused} disabled={!write} label={t("pausePublishing")} onChange={(v) => save("publishing", { paused: v })} />} />
          </Section>
        </div>
        <div>
          <MinVersions s={s} write={write} save={save} />
          <Announcements data={data} write={write} act={act} />
          <Flags data={data} write={write} act={act} />
          <Blocks data={data} write={write} act={act} />
        </div>
      </div>
    </div>
  );
}

type Save = (key: keyof Settings, value: unknown) => Promise<void>;
type Act = (fn: () => Promise<unknown>) => Promise<void>;

function Signups({ s, data, write, save, act }: { s: Settings; data: ControlData; write: boolean; save: Save; act: Act }) {
  const [code, setCode] = useState<string | null>(null);
  return (
    <Section title={t("signupsTitle")} note={t("signupsLead")}>
      <div className="row">
        <Segmented
          label={t("signupsTitle")}
          value={s.signups.mode}
          onChange={(v) => write && save("signups", { mode: v })}
          options={[
            { value: "open", label: t("signupsOpen") },
            { value: "invite", label: t("signupsInvite") },
            { value: "closed", label: t("signupsClosed") },
          ]}
        />
      </div>
      {s.signups.mode === "invite" && (
        <>
          <Row
            icon="key"
            label={t("inviteCodes")}
            sub={t("waitlistN", { n: fmtNum(data.waitlist.filter((w) => !w.invitedAt).length) })}
            trailing={
              write && (
                <span className="row-controls">
                  <Button icon="envelope" onClick={() => act(() => call("POST", "/admin/control/waitlist/invite", { count: 10 }))}>
                    {t("inviteTen")}
                  </Button>
                  <Button
                    icon="plus"
                    onClick={() =>
                      act(async () => {
                        const r = await call<{ code: string }>("POST", "/admin/control/invites", { maxUses: 1, days: 30 });
                        setCode(r.code);
                      })
                    }
                  >
                    {t("newCode")}
                  </Button>
                </span>
              )
            }
          />
          {code && <Row icon="checkmark" label={<span className="mono big-code">{code}</span>} sub={t("codeOnce")} />}
          {data.invites.slice(0, 8).map((i) => (
            <Row key={i.id} icon="number.sign" label={i.label ?? t("code")} value={`${i.uses}/${i.maxUses}`} sub={i.expiresAt ? t("expires", { date: fmtDate(i.expiresAt) }) : undefined} />
          ))}
        </>
      )}
    </Section>
  );
}

function Maintenance({ s, write, save }: { s: Settings; write: boolean; save: Save }) {
  const [m, setM] = useState(s.maintenance);
  useEffect(() => setM(s.maintenance), [s.maintenance]);
  return (
    <Section title={t("maintenanceTitle")} note={t("maintenanceLead")}>
      <Row icon="exclamationmark.triangle" label={t("maintenanceOn")} trailing={<Switch checked={m.on} disabled={!write} label={t("maintenanceOn")} onChange={(v) => setM({ ...m, on: v })} />} />
      <Row icon="lock" label={t("readOnly")} sub={t("readOnlyLead")} trailing={<Switch checked={m.readOnly} disabled={!write} label={t("readOnly")} onChange={(v) => setM({ ...m, readOnly: v })} />} />
      <div className="row pair">
        <input className="input" dir="rtl" placeholder={t("messageAr")} value={m.message.ar} onChange={(e) => setM({ ...m, message: { ...m.message, ar: e.target.value } })} />
        <input className="input" dir="ltr" placeholder="Message in English" value={m.message.en} onChange={(e) => setM({ ...m, message: { ...m.message, en: e.target.value } })} />
      </div>
      {write && (
        <div className="row row-end">
          <Button variant="accent" icon="checkmark" onClick={() => save("maintenance", m)}>
            {t("save")}
          </Button>
        </div>
      )}
    </Section>
  );
}

function Incident({ s, write, save }: { s: Settings; write: boolean; save: Save }) {
  const i = s.incident;
  const [title, setTitle] = useState<L>(i.title);
  const [body, setBody] = useState<L>(i.body);
  const [upd, setUpd] = useState<L>({ ar: "", en: "" });
  useEffect(() => (setTitle(i.title), setBody(i.body)), [i]);
  return (
    <Section title={t("incidentTitle")} note={t("incidentLead")}>
      {i.on && <Row icon="exclamationmark.triangle" label={<Chip tone="danger">{t("incidentOngoing")}</Chip>} sub={i.startedAt ? ago(i.startedAt) : undefined} />}
      <div className="row pair">
        <input className="input" dir="rtl" placeholder={t("incidentTitleAr")} value={title.ar} onChange={(e) => setTitle({ ...title, ar: e.target.value })} />
        <input className="input" dir="ltr" placeholder="Title in English" value={title.en} onChange={(e) => setTitle({ ...title, en: e.target.value })} />
      </div>
      <div className="row pair">
        <textarea className="input" rows={2} dir="rtl" placeholder={t("incidentBodyAr")} value={body.ar} onChange={(e) => setBody({ ...body, ar: e.target.value })} />
        <textarea className="input" rows={2} dir="ltr" placeholder="What is happening" value={body.en} onChange={(e) => setBody({ ...body, en: e.target.value })} />
      </div>
      {i.on && (
        <>
          {i.updates.map((u, k) => (
            <Row key={k} icon="clock" label={<bdi dir="auto">{u.text.ar || u.text.en}</bdi>} sub={fmtDate(u.at, true)} />
          ))}
          <div className="row pair">
            <input className="input" dir="rtl" placeholder={t("updateAr")} value={upd.ar} onChange={(e) => setUpd({ ...upd, ar: e.target.value })} />
            <input className="input" dir="ltr" placeholder="Update in English" value={upd.en} onChange={(e) => setUpd({ ...upd, en: e.target.value })} />
          </div>
        </>
      )}
      {write && (
        <div className="row row-end">
          {i.on ? (
            <>
              <Button icon="checkmark" onClick={() => save("incident", { ...i, on: false })}>
                {t("endIncident")}
              </Button>
              <Button
                variant="accent"
                icon="plus"
                disabled={!upd.ar.trim() && !upd.en.trim()}
                onClick={() => (save("incident", { ...i, title, body, updates: [...i.updates, { at: Date.now(), text: upd }] }), setUpd({ ar: "", en: "" }))}
              >
                {t("postUpdate")}
              </Button>
            </>
          ) : (
            <Button variant="danger" icon="exclamationmark.triangle" disabled={!title.ar.trim() || !title.en.trim()} onClick={() => save("incident", { on: true, title, body, startedAt: Date.now(), updates: [] })}>
              {t("startIncident")}
            </Button>
          )}
        </div>
      )}
    </Section>
  );
}

function MinVersions({ s, write, save }: { s: Settings; write: boolean; save: Save }) {
  const [v, setV] = useState(s.minVersion);
  useEffect(() => setV(s.minVersion), [s.minVersion]);
  return (
    <Section title={t("minVersionTitle")} note={t("minVersionLead")}>
      {PLATFORMS.map((p) => (
        <div key={p} className="row version-row">
          <span className="row-main">
            <span className="row-label">{p}</span>
          </span>
          <input className="input mono" dir="ltr" placeholder="1.0.1" value={v[p]?.version ?? ""} onChange={(e) => setV({ ...v, [p]: { version: e.target.value.trim(), dismissible: v[p]?.dismissible ?? true } })} />
          <label className="check small">
            <input type="checkbox" checked={v[p]?.dismissible ?? true} onChange={(e) => setV({ ...v, [p]: { version: v[p]?.version ?? "", dismissible: e.target.checked } })} />
            <span>{t("dismissible")}</span>
          </label>
        </div>
      ))}
      {write && (
        <div className="row row-end">
          <Button variant="accent" icon="checkmark" onClick={() => save("minVersion", Object.fromEntries(Object.entries(v).filter(([, x]) => x.version)))}>
            {t("save")}
          </Button>
        </div>
      )}
    </Section>
  );
}

function Announcements({ data, write, act }: { data: ControlData; write: boolean; act: Act }) {
  const lang = useLang();
  const [adding, setAdding] = useState(false);
  return (
    <Section
      title={t("announcementsTitle")}
      trailing={
        write && (
          <button type="button" className="link-btn" onClick={() => setAdding(true)}>
            {t("newAnnouncement")}
          </button>
        )
      }
    >
      {data.announcements.length ? (
        data.announcements.map((a) => (
          <Row
            key={a.id}
            icon={a.level === "critical" ? "exclamationmark.triangle" : "info.circle"}
            label={<bdi dir="auto">{a.text[lang]}</bdi>}
            sub={[a.platforms.join(", ") || t("allPlatforms"), a.minVersion ? `>= ${a.minVersion}` : "", a.maxVersion ? `<= ${a.maxVersion}` : "", a.endsAt ? t("expires", { date: fmtDate(a.endsAt) }) : ""].filter(Boolean).join(" · ")}
            trailing={<Switch checked={a.active} disabled={!write} label={t("active")} onChange={(v) => act(() => call("PATCH", `/admin/control/announcements/${a.id}`, { active: v }))} />}
          />
        ))
      ) : (
        <Empty>{t("noAnnouncements")}</Empty>
      )}
      {adding && <AnnouncementDialog onClose={() => setAdding(false)} act={act} />}
    </Section>
  );
}

function AnnouncementDialog({ onClose, act }: { onClose: () => void; act: Act }) {
  const [ar, setAr] = useState("");
  const [en, setEn] = useState("");
  const [level, setLevel] = useState("info");
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [minV, setMinV] = useState("");
  const [maxV, setMaxV] = useState("");
  const [days, setDays] = useState("");
  const [link, setLink] = useState("");
  return (
    <Dialog
      title={t("newAnnouncement")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("cancel")}</Button>
          <Button
            variant="accent"
            icon="checkmark"
            disabled={!ar.trim() || !en.trim()}
            onClick={async () => {
              await act(() =>
                call("POST", "/admin/control/announcements", {
                  textAr: ar.trim(),
                  textEn: en.trim(),
                  level,
                  platforms,
                  minVersion: minV.trim() || undefined,
                  maxVersion: maxV.trim() || undefined,
                  link: link.trim() || undefined,
                  endsAt: Number(days) > 0 ? Date.now() + Number(days) * 86_400_000 : undefined,
                }),
              );
              onClose();
            }}
          >
            {t("save")}
          </Button>
        </>
      }
    >
      <Field label={t("messageAr")}>
        <input className="input" dir="rtl" value={ar} onChange={(e) => setAr(e.target.value)} maxLength={300} />
      </Field>
      <Field label="Message in English">
        <input className="input" dir="ltr" value={en} onChange={(e) => setEn(e.target.value)} maxLength={300} />
      </Field>
      <Field label={t("level")} as="div">
        <Segmented
          label={t("level")}
          value={level}
          onChange={setLevel}
          options={[
            { value: "info", label: t("levelInfo") },
            { value: "warning", label: t("levelWarning") },
            { value: "critical", label: t("levelCritical") },
          ]}
        />
      </Field>
      <Field label={t("platformsLabel")} as="div">
        <div className="chips-pick">
          {PLATFORMS.map((p) => (
            <label key={p} className="check small">
              <input type="checkbox" checked={platforms.includes(p)} onChange={(e) => setPlatforms(e.target.checked ? [...platforms, p] : platforms.filter((x) => x !== p))} />
              <span>{p}</span>
            </label>
          ))}
        </div>
      </Field>
      <div className="pair">
        <Field label={t("fromVersion")}>
          <input className="input mono" dir="ltr" value={minV} onChange={(e) => setMinV(e.target.value)} placeholder="1.0.0" />
        </Field>
        <Field label={t("toVersion")}>
          <input className="input mono" dir="ltr" value={maxV} onChange={(e) => setMaxV(e.target.value)} placeholder="1.0.1" />
        </Field>
      </div>
      <div className="pair">
        <Field label={t("forDays")}>
          <input className="input" dir="ltr" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} placeholder="7" />
        </Field>
        <Field label={t("linkOptional")}>
          <input className="input" dir="ltr" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" />
        </Field>
      </div>
    </Dialog>
  );
}

function Flags({ data, write, act }: { data: ControlData; write: boolean; act: Act }) {
  const [key, setKey] = useState("");
  return (
    <Section title={t("flagsTitle")} note={t("flagsLead")}>
      {data.flags.map((f) => (
        <Row
          key={f.key}
          icon="gauge.with.dots.needle.33percent"
          label={<span className="mono">{f.key}</span>}
          sub={f.description ?? undefined}
          trailing={
            <span className="row-controls">
              {f.mode === "percent" && (
                <input
                  className="input mono percent"
                  dir="ltr"
                  defaultValue={f.percent}
                  disabled={!write}
                  aria-label={t("percent")}
                  onBlur={(e) => act(() => call("PUT", `/admin/control/flags/${f.key}`, { mode: "percent", percent: Number(e.target.value), users: f.users }))}
                />
              )}
              <Popup
                label={t("flagMode")}
                value={f.mode}
                onChange={(m) => write && act(() => call("PUT", `/admin/control/flags/${f.key}`, { mode: m, percent: f.percent || 10, users: f.users }))}
                options={["off", "testers", "percent", "users", "all"].map((m) => ({ value: m, label: t(`flag_${m}` as "flag_off") }))}
              />
              {write && <IconButton icon="trash" label={t("remove")} onClick={() => act(() => call("DELETE", `/admin/control/flags/${f.key}`))} />}
            </span>
          }
        />
      ))}
      {write && (
        <form
          className="note-new"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) act(() => call("PUT", `/admin/control/flags/${key.trim()}`, { mode: "off" })).then(() => setKey(""));
          }}
        >
          <input className="input mono" dir="ltr" placeholder="new.feature" value={key} onChange={(e) => setKey(e.target.value.toLowerCase())} />
          <Button type="submit" icon="plus" disabled={!key.trim()}>
            {t("addFlag")}
          </Button>
        </form>
      )}
    </Section>
  );
}

function Blocks({ data, write, act }: { data: ControlData; write: boolean; act: Act }) {
  const [value, setValue] = useState("");
  const limits = useLoad(() => call<{ key: string; id: string; count: number; windowStart: number }[]>("GET", "/admin/control/limits"), []);
  return (
    <>
      <Section title={t("blockedTitle")} note={t("blockedLead")}>
        {write && (
          <form
            className="note-new"
            onSubmit={(e) => {
              e.preventDefault();
              if (value.trim()) act(() => call("POST", "/admin/control/blocked", { value: value.trim() })).then(() => setValue(""));
            }}
          >
            <input className="input" dir="ltr" placeholder="spam.example / someone@example.com" value={value} onChange={(e) => setValue(e.target.value)} />
            <Button type="submit" icon="nosign" disabled={!value.trim()}>
              {t("block")}
            </Button>
          </form>
        )}
        {data.blocked.length ? (
          data.blocked.map((b) => (
            <Row
              key={b.value}
              icon="nosign"
              label={<span dir="ltr">{b.value}</span>}
              sub={`${b.kind === "domain" ? t("wholeDomain") : t("oneEmail")} · ${fmtDate(b.addedAt)}`}
              trailing={write && <IconButton icon="trash" label={t("remove")} onClick={() => act(() => call("DELETE", `/admin/control/blocked/${encodeURIComponent(b.value)}`))} />}
            />
          ))
        ) : (
          <Empty>{t("noBlocked")}</Empty>
        )}
      </Section>
      <Section title={t("limitsTitle")} note={t("limitsLead")}>
        {limits.data?.length ? (
          limits.data.slice(0, 20).map((l) => (
            <Row
              key={l.id}
              icon="clock"
              label={<span className="mono">{l.key}</span>}
              value={fmtNum(l.count)}
              sub={ago(l.windowStart)}
              trailing={write && <IconButton icon="xmark" label={t("clear")} onClick={() => act(() => call("DELETE", "/admin/control/limits", { key: l.id })).then(limits.reload)} />}
            />
          ))
        ) : (
          <Empty>{t("noLimits")}</Empty>
        )}
      </Section>
    </>
  );
}
