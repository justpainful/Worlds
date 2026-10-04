import { useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";
import type { Automation, Run } from "../lib/types";
import { useStore, pageTitle } from "../state/store";
import { emit } from "../lib/bus";
import { describeDestination, describeTrigger, STATUS_LABEL } from "../lib/automationText";
import { GlassButton, Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { EmptyState, PageIcon, formatDateTime, relTime, Spinner } from "../ui/misc";
import { confirmDialog } from "../ui/Modal";
import { editAutomation } from "../automations/AutomationEditor";

export function AutomationsView({ automationId }: { automationId?: string }) {
  const [list, setList] = useState<Automation[] | null>(null);
  const [selected, setSelected] = useState<string | null>(automationId ?? null);

  const load = () => api.automations().then(setList).catch(() => setList([]));
  useEffect(() => {
    load();
    window.addEventListener("worlds:changed", load);
    return () => window.removeEventListener("worlds:changed", load);
  }, []);
  useEffect(() => {
    if (automationId) setSelected(automationId);
  }, [automationId]);
  useEffect(() => {
    if (list && !selected && list.length) setSelected(list[0].id);
  }, [list, selected]);

  const current = list?.find((a) => a.id === selected) ?? null;

  return (
    <div className="view view-wide">
      <header className="view-head">
        <div>
          <h1 className="view-title">Automations</h1>
          <p className="view-sub">Pages delivered to Discord on a schedule. Runs happen on this PC, even with the window closed.</p>
        </div>
        <GlassButton icon="add" onClick={() => emit("automation:new", { pageId: null })}>New Automation</GlassButton>
      </header>
      {!list ? (
        <Spinner />
      ) : list.length === 0 ? (
        <EmptyState
          icon="automation"
          title="No automations"
          text="Send a page to a Discord channel at a set time, every day, or once."
          action={<button className="btn btn-tinted btn-standard" onClick={() => emit("automation:new", { pageId: null })}>Create Automation</button>}
        />
      ) : (
        <div className="auto-layout">
          <div className="auto-list">
            {list.map((a) => (
              <button key={a.id} className={`auto-card ${a.id === selected ? "is-selected" : ""} ${a.enabled ? "" : "is-paused"}`} onClick={() => setSelected(a.id)}>
                <div className="auto-card-top">
                  <span className="auto-card-name bidi">{a.name}</span>
                  {a.lastStatus && <span className={`status-chip status-${a.lastStatus}`}>{STATUS_LABEL[a.lastStatus]}</span>}
                </div>
                <div className="auto-card-sub">{describeTrigger(a.spec.trigger)}</div>
                <div className="auto-card-sub isolate">{describeDestination(a.spec.destination)}</div>
                <div className="auto-card-next">{a.enabled ? (a.nextRunAt ? `Next ${relTime(a.nextRunAt)}` : "No upcoming run") : "Paused"}</div>
              </button>
            ))}
          </div>
          {current ? <AutomationDetail key={current.id} a={current} onChanged={load} /> : <div />}
        </div>
      )}
    </div>
  );
}

function AutomationDetail({ a, onChanged }: { a: Automation; onChanged: () => void }) {
  const pages = useStore((s) => s.pages);
  const openPage = useStore((s) => s.openPage);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [running, setRunning] = useState(false);
  const source = pages[a.spec.source.pageId];

  const loadRuns = () => api.runs(a.id, 60).then(setRuns).catch(() => setRuns([]));
  useEffect(() => {
    loadRuns();
    window.addEventListener("worlds:changed", loadRuns);
    return () => window.removeEventListener("worlds:changed", loadRuns);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id]);

  const toggle = async () => {
    await api.saveAutomation({ id: a.id, name: a.name, enabled: !a.enabled, spec: a.spec });
    onChanged();
  };
  const runNow = async () => {
    const ok = await confirmDialog({
      title: "Run now?",
      message: `“${pageTitle(source)}” will be rendered${a.spec.transform.kind === "claude" ? ", prepared by Claude," : ""} and sent to ${describeDestination(a.spec.destination)} through your Discord bot.`,
      confirm: "Run and send",
    });
    if (!ok) return;
    setRunning(true);
    try {
      await api.runAutomation(a.id);
      loadRuns();
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    } finally {
      setRunning(false);
    }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: "Delete automation?", message: `“${a.name}” and its run history will be deleted. The source page is not affected.`, confirm: "Delete", danger: true }))) return;
    await api.deleteAutomation(a.id);
    onChanged();
  };

  return (
    <div className="auto-detail">
      <div className="auto-detail-head">
        <div>
          <h2 className="auto-detail-title bidi">{a.name}</h2>
          <div className="auto-flow">
            <span className="flow-step"><Icon name="clock" size={13} />{describeTrigger(a.spec.trigger)}</span>
            <Icon name="forward" size={12} className="flow-arrow" />
            <button className="flow-step as-link" onClick={() => source && openPage(source.id, "right")}>
              <PageIcon icon={source?.icon} size={13} />
              <span className="bidi">{source ? pageTitle(source) : "Missing page"}</span>
            </button>
            {a.spec.transform.kind === "claude" && (
              <>
                <Icon name="forward" size={12} className="flow-arrow" />
                <span className="flow-step"><Icon name="assistant" size={13} />Claude prepares</span>
              </>
            )}
            <Icon name="forward" size={12} className="flow-arrow" />
            <span className="flow-step"><Icon name="discord" size={13} /><bdi>{describeDestination(a.spec.destination)}</bdi></span>
            <span className="flow-step is-quiet">{a.spec.policy.unattended ? "Sends automatically" : "Waits for approval"}</span>
          </div>
        </div>
        <div className="auto-detail-actions">
          <Button variant="quiet" icon={a.enabled ? "pause" : "play"} onClick={toggle}>{a.enabled ? "Pause" : "Resume"}</Button>
          <Button variant="quiet" icon="edit" onClick={() => editAutomation(a)}>Edit</Button>
          <Button variant="plain" icon="play" loading={running} onClick={runNow} disabled={!a.spec.destination}>Run now</Button>
          <Button variant="quiet" icon="delete" onClick={remove} aria-label="Delete" />
        </div>
      </div>

      <div className="section-label">Runs</div>
      {!runs ? (
        <Spinner />
      ) : runs.length === 0 ? (
        <EmptyState compact icon="clock" title="No runs yet" text={a.enabled && a.nextRunAt ? `First run ${formatDateTime(a.nextRunAt)}.` : "Run it now, or resume it to schedule."} />
      ) : (
        <table className="runs">
          <thead>
            <tr>
              <th>Status</th>
              <th>When</th>
              <th>Trigger</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td><span className={`status-chip status-${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                <td>{formatDateTime(r.startedAt ?? r.scheduledFor)}</td>
                <td className="muted">{r.trigger === "manual" ? "Manual" : "Schedule"}</td>
                <td className="run-result bidi">{r.error ?? (r.status === "succeeded" ? "Delivered" : r.status === "waiting" ? "Waiting in Activity" : "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
