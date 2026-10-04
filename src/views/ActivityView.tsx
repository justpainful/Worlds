import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../lib/api";
import type { HistoryEntry, PendingAction } from "../lib/types";
import { useStore } from "../state/store";
import { refreshPending } from "../App";
import { describeDestination } from "../lib/automationText";
import { EmptyState, relTime, Spinner } from "../ui/misc";
import { Icon, type IconName } from "../ui/Icon";
import { Button } from "../ui/Button";
import { DiscordPreview } from "../discord/DiscordPreview";
import type { Rendered } from "../lib/types";

export function ActivityView() {
  const [pending, setPending] = useState<PendingAction[] | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const profile = useStore((s) => s.profile);
  const openPage = useStore((s) => s.openPage);

  const load = () => {
    api.pending().then(setPending).catch(() => setPending([]));
    api.history(null, null, 150).then(setHistory).catch(() => setHistory([]));
  };
  useEffect(() => {
    load();
    window.addEventListener("worlds:changed", load);
    return () => window.removeEventListener("worlds:changed", load);
  }, []);

  const days = useMemo(() => {
    const m = new Map<string, HistoryEntry[]>();
    for (const h of history ?? []) {
      const d = new Date(h.createdAt);
      const today = new Date();
      const yest = new Date(Date.now() - 86_400_000);
      const label =
        d.toDateString() === today.toDateString()
          ? "Today"
          : d.toDateString() === yest.toDateString()
            ? "Yesterday"
            : d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
      m.set(label, [...(m.get(label) ?? []), h]);
    }
    return [...m.entries()];
  }, [history]);

  const iconFor = (h: HistoryEntry): IconName =>
    h.actor === "ai" ? "assistant" : h.actor === "automation" ? "automation" : h.kind === "discord_sent" ? "discord" : h.kind === "created" ? "add" : h.kind === "moved" ? "move" : h.kind === "renamed" ? "edit" : h.kind === "deleted" ? "delete" : "edit";

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1 className="view-title">Activity</h1>
          <p className="view-sub">Requests waiting for you, and what changed recently.</p>
        </div>
      </header>

      {pending && pending.length > 0 && (
        <section className="approvals">
          <h2 className="section-label">Needs approval</h2>
          {pending.map((p) => (
            <Approval key={p.id} action={p} onDone={() => { load(); refreshPending(); }} />
          ))}
        </section>
      )}

      <h2 className="section-label section-gap">Recent</h2>
      {!history ? (
        <Spinner />
      ) : history.length === 0 ? (
        <EmptyState icon="activity" title="No activity yet" text="Edits, moves, Claude’s changes and Discord sends show up here." />
      ) : (
        days.map(([day, list]) => (
          <div key={day} className="act-day">
            <div className="act-day-label">{day}</div>
            {list.map((h) => (
              <button key={h.id} className="act-row" onClick={() => h.pageId && openPage(h.pageId)} disabled={!h.pageId}>
                <span className={`act-icon act-${h.actor}`}>
                  <Icon name={iconFor(h)} size={13} />
                </span>
                <span className="act-main">
                  <span className="act-title bidi">
                    <strong>{h.pageTitle || "Untitled"}</strong>
                    <span className="act-sum"> · {h.summary}</span>
                  </span>
                  <span className="act-sub">
                    {h.actor === "ai" ? "Claude" : h.actor === "automation" ? "Automation" : profile?.displayName || "You"} · {relTime(h.createdAt)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function Approval({ action, onDone }: { action: PendingAction; onDone: () => void }) {
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const pages = useStore((s) => s.pages);
  const page = pages[action.payload.pageId];
  useEffect(() => {
    api.discordRender(action.payload.pageId, action.payload.options).then(setRendered).catch(() => {});
  }, [action.payload.pageId, action.payload.options]);
  const resolve = async (approve: boolean) => {
    setBusy(approve ? "approve" : "decline");
    try {
      await api.resolvePending(action.id, approve);
      useStore.getState().toast({ message: approve ? "Sent to Discord" : "Request declined", tone: approve ? "success" : "info" });
      onDone();
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    } finally {
      setBusy(null);
    }
  };
  const who = action.requestedBy === "ai" ? "Claude" : action.payload.automationName ? `Automation “${action.payload.automationName}”` : "Automation";
  return (
    <div className="approval">
      <div className="approval-head">
        <Icon name="discord" size={16} />
        <div className="approval-main">
          <div className="approval-title bidi">
            {who} wants to send <strong>{page?.title || "a page"}</strong> to <bdi>{describeDestination(action.payload.destination)}</bdi>
          </div>
          <div className="approval-sub">{relTime(action.createdAt)} · Nothing is sent until you approve.</div>
        </div>
        <Button variant="quiet" loading={busy === "decline"} onClick={() => resolve(false)}>Decline</Button>
        <Button variant="tinted" icon="send" loading={busy === "approve"} onClick={() => resolve(true)}>Approve and send</Button>
      </div>
      {rendered && <DiscordPreview rendered={rendered} compact />}
    </div>
  );
}
