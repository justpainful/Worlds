/**
 * Settings for Worlds talking to other software: calendar subscriptions and
 * the calendar feed, the local API, and webhooks.
 */
import { useEffect, useState } from "react";
import { api, errorMessage, isTauri } from "../lib/api";
import { on } from "../lib/bus";
import { useStore, pageTitle } from "../state/store";
import { tr } from "../i18n/ui";
import { Icon } from "../ui/Icon";
import { promptText } from "../editor/prompt";
import { addSubscription, exportIcs, removeSubscription, type Subscription } from "../planning/calendarSync";

const toast = (message: string, tone?: "error") => useStore.getState().toast({ message, tone });

export function CalendarSettings() {
  const subs = (useStore((s) => s.settings["calendar.subscriptions"]) as Subscription[] | undefined) ?? [];
  const [feed, setFeed] = useState<string | null>(null);
  useEffect(() => {
    if (isTauri) api.captureInfo().then((i) => setFeed(`http://127.0.0.1:${i.port}/calendar.ics?token=${i.token}`)).catch(() => undefined);
  }, []);
  const add = async () => {
    const url = await promptText({
      title: tr("Add a calendar"),
      placeholder: "https://calendar.google.com/calendar/ical/.../basic.ics",
      confirm: tr("Next"),
      validate: (v) => (/^(https|webcal):\/\//i.test(v) ? null : tr("Paste the calendar's secret iCal address")),
    });
    if (!url) return;
    const name = await promptText({ title: tr("Name this calendar"), initial: /google/.test(url) ? "Google" : /icloud/.test(url) ? "iCloud" : tr("Calendar"), confirm: tr("Add") });
    if (name) addSubscription(url, name);
  };
  return (
    <div className="int-block">
      {subs.map((s) => (
        <div key={s.url} className="int-row">
          <Icon name="calendarDays" size={14} />
          <span className="bidi">{s.name}</span>
          <span className="int-dim" dir="ltr">
            {new URL(s.url.replace(/^webcal:/i, "https:")).hostname}
          </span>
          <button className="icon-btn" aria-label={tr("Remove")} onClick={() => removeSubscription(s.url)}>
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
      <div className="set-buttons">
        <button className="btn btn-plain btn-compact" onClick={add}>
          <Icon name="add" size={13} />
          {tr("Add Google or Apple calendar")}
        </button>
        <button className="btn btn-plain btn-compact" onClick={exportIcs}>
          <Icon name="download" size={13} />
          {tr("Export .ics")}
        </button>
        {feed && (
          <button className="btn btn-plain btn-compact" onClick={() => navigator.clipboard.writeText(feed).then(() => toast(tr("Feed address copied")))}>
            <Icon name="link" size={13} />
            {tr("Copy feed address")}
          </button>
        )}
      </div>
    </div>
  );
}

export function ApiSettings() {
  const [info, setInfo] = useState<{ port: number; token: string } | null>(null);
  useEffect(() => {
    if (isTauri) api.captureInfo().then(setInfo).catch(() => undefined);
  }, []);
  if (!info) return <span className="set-static">{tr("Available in the Worlds app on your computer")}</span>;
  const base = `http://127.0.0.1:${info.port}`;
  return (
    <div className="int-block">
      <pre className="int-code" dir="ltr">{`GET  ${base}/api/pages
GET  ${base}/api/pages/<id>      (Markdown)
POST ${base}/api/pages           {"title", "markdown", "parentId"}
x-worlds-token: <token>`}</pre>
    </div>
  );
}

const HOOKS_KEY = "webhooks.urls";

export function WebhookSettings() {
  const urls = (useStore((s) => s.settings[HOOKS_KEY]) as string[] | undefined) ?? [];
  const set = useStore((s) => s.setSetting);
  return (
    <div className="int-block">
      {urls.map((u) => (
        <div key={u} className="int-row">
          <Icon name="webhook" size={14} />
          <span className="int-dim" dir="ltr">
            {u}
          </span>
          <button className="btn btn-plain btn-compact" onClick={() => sendHook(u, { event: "test", at: Date.now() }).then((s) => toast(`${tr("Sent")}: ${s}`), (e) => toast(errorMessage(e), "error"))}>
            {tr("Test")}
          </button>
          <button className="icon-btn" aria-label={tr("Remove")} onClick={() => set(HOOKS_KEY, urls.filter((x) => x !== u))}>
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
      <button
        className="btn btn-plain btn-compact"
        onClick={async () => {
          const url = await promptText({ title: tr("Add a webhook"), placeholder: "https://", confirm: tr("Add"), validate: (v) => (/^https:\/\//.test(v) ? null : tr("Use an https address")) });
          if (url) set(HOOKS_KEY, [...urls.filter((x) => x !== url), url]);
        }}
      >
        <Icon name="add" size={13} />
        {tr("Add a webhook")}
      </button>
    </div>
  );
}

function sendHook(url: string, body: Record<string, unknown>) {
  if (isTauri) return api.webhookPost(url, body);
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.status);
}

let started = false;

/** Tell the webhook addresses when pages are created or changed (at most once per page every 15 seconds). */
export function startWebhooks() {
  if (started) return;
  started = true;
  const last = new Map<string, number>();
  const fire = (event: string, pageId: string) => {
    const urls = (useStore.getState().settings[HOOKS_KEY] as string[] | undefined) ?? [];
    if (!urls.length) return;
    const now = Date.now();
    if (now - (last.get(`${event}:${pageId}`) ?? 0) < 15000) return;
    last.set(`${event}:${pageId}`, now);
    const page = useStore.getState().pages[pageId];
    const body = { event, pageId, title: pageTitle(page), parentId: page?.parentId ?? null, at: now };
    for (const u of urls) sendHook(u, body).catch(() => undefined);
  };
  on("page:saved", ({ pageId, from }) => from !== "synced" && fire("page.updated", pageId));
  let known = new Set(Object.keys(useStore.getState().pages));
  useStore.subscribe((s, prev) => {
    if (s.pages === prev.pages) return;
    for (const id of Object.keys(s.pages)) if (!known.has(id)) fire("page.created", id);
    known = new Set(Object.keys(s.pages));
  });
}
