import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../lib/api";
import type { Destination, DiscordInventory, BridgeState, Rendered, RenderOptions } from "../lib/types";
import { useStore, pageTitle } from "../state/store";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Segmented } from "../ui/Segmented";
import { EmptyState, Spinner } from "../ui/misc";
import { LAYER } from "../glass/materials";
import { DiscordPreview, useBotName } from "./DiscordPreview";
import { DestinationPicker } from "./DestinationPicker";
import { BRIDGE, bridgeExplain } from "./bridge";
import { EmbedColorPicker, type EmbedColor } from "./EmbedColorPicker";

/** Remember the embed colour per page (in its metadata). */
export async function loadPageColor(pageId: string): Promise<EmbedColor | null> {
  const p = await api.page(pageId).catch(() => null);
  const c = p?.metadata?.discordColor as EmbedColor | undefined;
  return c && (c.noAccent || typeof c.accentColor === "number") ? c : null;
}

export async function savePageColor(pageId: string, color: EmbedColor) {
  const p = await api.page(pageId).catch(() => null);
  if (!p) return;
  await api.updatePage(pageId, { metadata: { ...p.metadata, discordColor: { accentColor: color.accentColor, noAccent: !!color.noAccent } } });
}

export function DiscordComposer({ pageId, onClose, getBlocks }: { pageId: string; onClose: () => void; getBlocks?: () => Promise<unknown> }) {
  const page = useStore((s) => s.pages[pageId]);
  const settings = useStore((s) => s.settings);
  const [options, setOptions] = useState<RenderOptions>({ includeTitle: true, hideCompleted: false, container: true });
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [view, setView] = useState<"desktop" | "mobile" | "json">("desktop");
  const [dest, setDest] = useState<Destination | null>((settings["discord.lastDestination"] as Destination) ?? null);
  const [inventory, setInventory] = useState<DiscordInventory | null>(null);
  const [state, setState] = useState<BridgeState>("unknown");
  const [sending, setSending] = useState(false);
  const botName = useBotName();

  useEffect(() => {
    loadPageColor(pageId).then((c) => c && setOptions((o) => ({ ...o, ...c })));
  }, [pageId]);

  useEffect(() => {
    (async () => {
      await getBlocks?.();
      try {
        setRendered(await api.discordRender(pageId, options));
        setRenderError(null);
      } catch (e) {
        setRenderError(errorMessage(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, options]);

  useEffect(() => {
    api
      .discordDestinations(false)
      .then((inv) => {
        setInventory(inv);
        setState(inv.stale ? ((inv.error as BridgeState) ?? "error") : "connected");
      })
      .catch((e) => {
        const msg = errorMessage(e);
        setState((msg.split(":")[0] as BridgeState) || "error");
      });
  }, []);

  const errors = useMemo(() => rendered?.warnings.filter((w) => w.level === "error") ?? [], [rendered]);
  const canSend = !!dest && !!rendered && errors.length === 0 && state === "connected" && !sending;

  const send = async () => {
    if (!dest || !rendered) return;
    setSending(true);
    try {
      await api.discordSend(pageId, dest, options);
      useStore.getState().setSetting("discord.lastDestination", dest);
      savePageColor(pageId, { accentColor: options.accentColor, noAccent: options.noAccent }).catch(() => {});
      useStore.getState().toast({ message: `Sent to ${dest.label ?? "Discord"}`, tone: "success" });
      onClose();
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      title={
        <span className="composer-title">
          <Icon name="discord" size={17} />
          Send “{pageTitle(page)}” to Discord
        </span>
      }
      onClose={onClose}
      width={980}
      className="composer"
      footer={
        <>
          <span className="composer-note">
            {state === "connected" ? `Sent by ${BRIDGE.name}. Only the blocks shown in the preview leave Worlds.` : bridgeExplain(state).title}
          </span>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button variant="tinted" icon="send" disabled={!canSend} loading={sending} onClick={send}>
            Send
          </Button>
        </>
      }
    >
      <div className="composer-grid">
        <div className="composer-side">
          <div className="field-label">Destination</div>
          {state === "connected" || inventory ? (
            <DestinationPicker inventory={inventory} value={dest} onChange={setDest} />
          ) : state === "unknown" ? (
            <Spinner />
          ) : (
            <EmptyState compact icon="disconnected" title={bridgeExplain(state).title} text={bridgeExplain(state).text} action={<button className="chip-btn" onClick={() => { onClose(); useStore.getState().open({ kind: "integrations" }, "tab"); }}>Open Integrations</button>} />
          )}

          <div className="field-label">Content</div>
          <label className="check-row">
            <input type="checkbox" checked={options.includeTitle !== false} onChange={(e) => setOptions({ ...options, includeTitle: e.target.checked })} />
            Page title as heading
          </label>
          <label className="check-row">
            <input type="checkbox" checked={!!options.hideCompleted} onChange={(e) => setOptions({ ...options, hideCompleted: e.target.checked })} />
            Leave out completed tasks
          </label>
          <label className="check-row">
            <input type="checkbox" checked={options.container !== false} onChange={(e) => setOptions({ ...options, container: e.target.checked })} />
            Container with accent bar
          </label>
          {options.container !== false && (
            <>
              <div className="field-label">Embed color</div>
              <EmbedColorPicker value={{ accentColor: options.accentColor, noAccent: options.noAccent }} onChange={(v) => setOptions({ ...options, accentColor: v.accentColor, noAccent: v.noAccent })} />
            </>
          )}

          {rendered && (
            <div className="composer-stats">
              <span>{rendered.componentCount} / 40 components</span>
              <span>{rendered.textChars.toLocaleString()} / 4,000 characters</span>
              {rendered.files.length > 0 && <span>{rendered.files.length} attachment{rendered.files.length === 1 ? "" : "s"}</span>}
            </div>
          )}
          {rendered?.warnings.map((w, i) => (
            <div key={i} className={`warn warn-${w.level}`}>
              <Icon name={w.level === "error" ? "error" : "warning"} size={14} />
              <span>{w.message}</span>
            </div>
          ))}
        </div>

        <div className="composer-preview">
          <div className="composer-preview-bar">
            <Segmented
              value={view}
              onChange={setView}
              layer={LAYER.modal + 0.2}
              label="Preview size"
              options={[
                { value: "desktop", label: "Desktop" },
                { value: "mobile", label: "Mobile" },
                { value: "json", label: "JSON" },
              ]}
            />
          </div>
          <div className="composer-stage scroll">
            {renderError ? (
              <EmptyState compact icon="warning" title="Could not render this page" text={renderError} />
            ) : !rendered ? (
              <Spinner />
            ) : view === "json" ? (
              <pre className="json-view" dir="ltr">{JSON.stringify(rendered.payload, null, 2)}</pre>
            ) : rendered.payload.components.length === 0 ? (
              <EmptyState compact icon="discord" title="Empty Discord preview" text="Add text, a list or an image to the page to see the message here." />
            ) : (
              <DiscordPreview rendered={rendered} mobile={view === "mobile"} botName={botName} />
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
