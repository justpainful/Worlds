import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../lib/api";
import type { Automation, AutomationSpec, Destination, DiscordInventory, Rendered, Trigger } from "../lib/types";
import { useStore, pageTitle } from "../state/store";
import { emit, on } from "../lib/bus";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Segmented } from "../ui/Segmented";
import { Icon } from "../ui/Icon";
import { EmptyState, PageIcon, Spinner } from "../ui/misc";
import { LAYER } from "../glass/materials";
import { DestinationPicker } from "../discord/DestinationPicker";
import { DiscordPreview, useBotName } from "../discord/DiscordPreview";
import { describeTrigger } from "../lib/automationText";
import { EmbedColorPicker, type EmbedColor } from "../discord/EmbedColorPicker";
import { loadPageColor } from "../discord/DiscordComposer";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function defaultTrigger(): Trigger {
  return { kind: "daily", time: "19:40" };
}

function toLocalInput(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Mounted once; opens the editor from anywhere via the bus. */
export function AutomationHost() {
  const [state, setState] = useState<{ pageId: string | null; automation?: Automation } | null>(null);
  useEffect(() => on("automation:new", ({ pageId }) => setState({ pageId })), []);
  useEffect(() => {
    const h = (e: Event) => setState({ pageId: null, automation: (e as CustomEvent<Automation>).detail });
    window.addEventListener("worlds:edit-automation", h);
    return () => window.removeEventListener("worlds:edit-automation", h);
  }, []);
  if (!state) return null;
  return <AutomationEditor pageId={state.pageId} automation={state.automation} onClose={() => setState(null)} />;
}

export function editAutomation(a: Automation) {
  window.dispatchEvent(new CustomEvent("worlds:edit-automation", { detail: a }));
}

export function AutomationEditor({ pageId, automation, onClose }: { pageId: string | null; automation?: Automation; onClose: () => void }) {
  const pages = useStore((s) => s.pages);
  const [name, setName] = useState(automation?.name ?? (pageId ? pageTitle(pages[pageId]) : ""));
  const [sourceId, setSourceId] = useState<string | null>(automation?.spec.source.pageId ?? pageId);
  const [trigger, setTrigger] = useState<Trigger>(automation?.spec.trigger ?? defaultTrigger());
  const [useClaude, setUseClaude] = useState(automation?.spec.transform?.kind === "claude");
  const [instructions, setInstructions] = useState(automation?.spec.transform?.kind === "claude" ? automation.spec.transform.instructions : "Update the date to today, remove completed tasks, keep everything else.");
  const [mode, setMode] = useState<"send" | "editLast">(automation?.spec.action?.mode ?? "send");
  const [dest, setDest] = useState<Destination | null>(automation?.spec.destination ?? null);
  const [unattended, setUnattended] = useState(automation?.spec.policy?.unattended ?? false);
  const [enabled, setEnabled] = useState(automation?.enabled ?? true);
  const [color, setColor] = useState<EmbedColor>({
    accentColor: automation?.spec.action?.options?.accentColor,
    noAccent: automation?.spec.action?.options?.noAccent,
  });
  const [inventory, setInventory] = useState<DiscordInventory | null>(null);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [saving, setSaving] = useState(false);
  const [pageQuery, setPageQuery] = useState("");
  const botName = useBotName();

  useEffect(() => {
    api.discordDestinations(false).then(setInventory).catch(() => setInventory(null));
  }, []);
  // A new automation starts with the colour the page was last sent with.
  useEffect(() => {
    if (automation || !sourceId) return;
    loadPageColor(sourceId).then((c) => c && setColor(c));
  }, [sourceId, automation]);

  useEffect(() => {
    if (!sourceId) return setRendered(null);
    api.discordRender(sourceId, color).then(setRendered).catch(() => setRendered(null));
  }, [sourceId, color]);

  const candidates = useMemo(() => {
    const q = pageQuery.toLowerCase();
    return Object.values(pages)
      .filter((p) => p.kind === "page" && !p.deletedAt && (!q || pageTitle(p).toLowerCase().includes(q)))
      .sort((a, b) => (b.openedAt ?? b.updatedAt) - (a.openedAt ?? a.updatedAt))
      .slice(0, 8);
  }, [pages, pageQuery]);

  const valid = !!sourceId && name.trim().length > 0 && (trigger.kind !== "weekly" || trigger.days.length > 0) && (trigger.kind !== "once" || trigger.at > Date.now());

  const save = async () => {
    if (!sourceId) return;
    setSaving(true);
    const spec: AutomationSpec = {
      trigger,
      source: { pageId: sourceId },
      transform: useClaude ? { kind: "claude", instructions } : { kind: "none" },
      action: { kind: "discord.send", mode, options: { accentColor: color.accentColor, noAccent: !!color.noAccent } },
      destination: dest,
      policy: { unattended, graceMinutes: 30 },
    };
    try {
      const saved = await api.saveAutomation({ id: automation?.id ?? null, name: name.trim(), enabled, spec });
      useStore.getState().toast({ message: saved.nextRunAt ? `Scheduled. Next run ${new Date(saved.nextRunAt).toLocaleString()}` : "Automation saved", tone: "success" });
      if (!automation && pageId) emit("editor:command", { pageId, command: "insertSchedule", args: { automationId: saved.id } });
      onClose();
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  const source = sourceId ? pages[sourceId] : null;
  const timeOf = (t: Trigger) => ("time" in t ? t.time : "19:40");

  return (
    <Modal
      title={automation ? "Edit automation" : "New automation"}
      onClose={onClose}
      width={1000}
      className="auto-editor"
      footer={
        <>
          <label className="check-row footer-check">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enabled
          </label>
          <span className="grow" />
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button variant="tinted" icon="check" disabled={!valid} loading={saving} onClick={save}>{automation ? "Save" : "Create"}</Button>
        </>
      }
    >
      <div className="ae-grid">
        <div className="ae-form">
          <div className="ae-step">
            <div className="ae-step-label"><span className="ae-num">1</span>Name</div>
            <input className="field bidi" dir="auto" value={name} placeholder="Meeting reminder" onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="ae-step">
            <div className="ae-step-label"><span className="ae-num">2</span>Trigger</div>
            <Segmented
              value={trigger.kind}
              layer={LAYER.modal + 0.2}
              label="Trigger"
              onChange={(k) => {
                const time = timeOf(trigger);
                if (k === "once") setTrigger({ kind: "once", at: Date.now() + 3600_000 });
                else if (k === "daily") setTrigger({ kind: "daily", time });
                else if (k === "weekly") setTrigger({ kind: "weekly", days: [new Date().getDay()], time });
                else if (k === "monthly") setTrigger({ kind: "monthly", day: new Date().getDate(), time });
                else setTrigger({ kind: "manual" });
              }}
              options={[
                { value: "once", label: "Once" },
                { value: "daily", label: "Daily" },
                { value: "weekly", label: "Weekly" },
                { value: "monthly", label: "Monthly" },
                { value: "manual", label: "Manual" },
              ]}
            />
            <div className="ae-trigger">
              {trigger.kind === "once" && (
                <input type="datetime-local" className="field" value={toLocalInput(trigger.at)} onChange={(e) => setTrigger({ kind: "once", at: new Date(e.target.value).getTime() })} />
              )}
              {trigger.kind === "weekly" && (
                <div className="day-toggles">
                  {DAY_LABELS.map((d, i) => (
                    <button
                      key={i}
                      className={`day-toggle ${trigger.days.includes(i) ? "is-on" : ""}`}
                      onClick={() => setTrigger({ ...trigger, days: trigger.days.includes(i) ? trigger.days.filter((x) => x !== i) : [...trigger.days, i].sort() })}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              )}
              {trigger.kind === "monthly" && (
                <label className="inline-field">
                  Day
                  <input type="number" min={1} max={31} className="field field-narrow" value={trigger.day} onChange={(e) => setTrigger({ ...trigger, day: Math.max(1, Math.min(31, Number(e.target.value) || 1)) })} />
                </label>
              )}
              {"time" in trigger && (
                <label className="inline-field">
                  at
                  <input type="time" className="field field-narrow" value={trigger.time} onChange={(e) => setTrigger({ ...trigger, time: e.target.value } as Trigger)} />
                </label>
              )}
              <span className="ae-summary">{describeTrigger(trigger)}</span>
            </div>
          </div>

          <div className="ae-step">
            <div className="ae-step-label"><span className="ae-num">3</span>Source page</div>
            {source ? (
              <div className="ae-source">
                <PageIcon icon={source.icon} size={16} />
                <span className="bidi">{pageTitle(source)}</span>
                <span className="grow" />
                <button className="chip-btn" onClick={() => setSourceId(null)}>Change</button>
              </div>
            ) : (
              <div className="ae-source-pick">
                <input className="field bidi" dir="auto" placeholder="Find a page" value={pageQuery} onChange={(e) => setPageQuery(e.target.value)} />
                <div className="ae-source-list">
                  {candidates.map((p) => (
                    <button key={p.id} className="dest-row" onClick={() => { setSourceId(p.id); if (!name) setName(pageTitle(p)); }}>
                      <PageIcon icon={p.icon} size={14} />
                      <span className="dest-label bidi">{pageTitle(p)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="ae-step">
            <div className="ae-step-label"><span className="ae-num">4</span>Prepare with Claude <span className="optional">optional</span></div>
            <label className="check-row">
              <input type="checkbox" checked={useClaude} onChange={(e) => setUseClaude(e.target.checked)} />
              Before sending, let Claude adjust a snapshot of the page
            </label>
            {useClaude && (
              <>
                <textarea className="field bidi" dir="auto" rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
                <div className="hint">Claude works on a copy taken at run time. Your page is not changed.</div>
              </>
            )}
          </div>

          <div className="ae-step">
            <div className="ae-step-label"><span className="ae-num">5</span>Send to Discord</div>
            <Segmented
              value={mode}
              layer={LAYER.modal + 0.2}
              label="Message mode"
              onChange={setMode}
              options={[
                { value: "send", label: "New message each time" },
                { value: "editLast", label: "Update the last message" },
              ]}
            />
            <DestinationPicker inventory={inventory} value={dest} onChange={setDest} />
            <div className="field-label">Embed color</div>
            <EmbedColorPicker value={color} onChange={setColor} />
          </div>

          <div className="ae-step">
            <div className="ae-step-label"><span className="ae-num">6</span>Approval</div>
            <label className="check-row">
              <input type="checkbox" checked={unattended} onChange={(e) => setUnattended(e.target.checked)} />
              Send without asking me
            </label>
            <div className="hint">
              {unattended
                ? "Runs send automatically, even when Worlds is in the tray."
                : "Each run prepares the message and waits in Activity for your approval."}
            </div>
          </div>
        </div>

        <div className="ae-preview">
          <div className="field-label">Preview of the current page</div>
          <div className="composer-stage scroll">
            {!sourceId ? (
              <EmptyState compact icon="discord" title="Empty Discord preview" text="Choose a source page." />
            ) : !rendered ? (
              <Spinner />
            ) : (
              <>
                <DiscordPreview rendered={rendered} botName={botName} />
                {rendered.warnings.map((w, i) => (
                  <div key={i} className={`warn warn-${w.level}`}>
                    <Icon name="warning" size={13} />
                    <span>{w.message}</span>
                  </div>
                ))}
                {useClaude && <div className="hint">The final message may differ after Claude prepares it.</div>}
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
