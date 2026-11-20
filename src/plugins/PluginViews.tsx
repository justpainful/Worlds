import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { errorMessage, isTauri } from "../lib/api";
import { appTheme, composeHtmlPage } from "../htmlpage/compose";
import { useStore } from "../state/store";
import { tr, uiLanguage } from "../i18n/ui";
import { Icon, type IconName } from "../ui/Icon";
import { Modal } from "../ui/Modal";
import { promptText } from "../editor/prompt";
import { applyPluginTheme, exportMyTheme, gallery, installFromFile, installFromUrl, installPlugin, installed, uninstallPlugin, type Plugin } from "./plugins";

const nameOf = (p: Plugin) => (uiLanguage() === "ar" && p.nameAr ? p.nameAr : p.name);
const descOf = (p: Plugin) => (uiLanguage() === "ar" && p.descriptionAr ? p.descriptionAr : p.description);

// ---------------------------------------------------------------------------
// The block a "block" plugin adds to pages
// ---------------------------------------------------------------------------

function PluginBlockView({ node, updateAttributes }: ReactNodeViewProps) {
  const id = node.attrs.pluginId as string;
  const list = useStore((s) => s.settings["plugins.installed"]) as Plugin[] | undefined;
  const plugin = (list ?? []).find((p) => p.id === id && p.kind === "block");
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(plugin?.height ?? 160);
  const mock = Boolean((window as unknown as { __WORLDS_MOCK__?: boolean }).__WORLDS_MOCK__);
  const lang = uiLanguage();
  const state = node.attrs.state;

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const d = e.data as { worldsHtmlPage?: number; type?: string; height?: number; state?: string };
      if (!d || d.worldsHtmlPage !== 1) return;
      if (d.type === "ready") frame.current.contentWindow?.postMessage({ worldsState: 1, state }, "*");
      else if (d.type === "height" && typeof d.height === "number") setHeight(Math.min(Math.max(d.height, 60), 2000));
      else if (d.type === "save" && typeof d.state === "string" && d.state.length <= 64 * 1024) {
        try {
          updateAttributes({ state: JSON.parse(d.state) });
        } catch {
          /* ignore malformed state */
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // The frame reads its state once, when it is ready; later saves come from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateAttributes]);

  if (!plugin)
    return (
      <NodeViewWrapper className="plugin-block is-missing" contentEditable={false}>
        <Icon name="puzzle" size={15} />
        {tr("This block needs a plugin that is not installed")}: {id}
      </NodeViewWrapper>
    );
  return (
    <NodeViewWrapper className="plugin-block" contentEditable={false}>
      <div className="plugin-block-name">
        <Icon name="puzzle" size={12} />
        {nameOf(plugin)}
      </div>
      {isTauri && !mock ? (
        <iframe ref={frame} title={plugin.name} sandbox="allow-scripts" style={{ height }} src={`http://whtml.localhost/plugin/${encodeURIComponent(plugin.id)}?lang=${lang}&theme=${appTheme()}&v=${plugin.version}`} />
      ) : (
        <iframe ref={frame} title={plugin.name} sandbox="allow-scripts" style={{ height }} srcDoc={composeHtmlPage(plugin.html ?? "", null, lang)} />
      )}
    </NodeViewWrapper>
  );
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pluginBlock: { insertPluginBlock: (pluginId: string) => ReturnType };
  }
}

export const PluginBlock = Node.create({
  name: "pluginBlock",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { pluginId: { default: null }, state: { default: null } };
  },
  parseHTML() {
    return [{ tag: "div[data-plugin-block]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-plugin-block": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PluginBlockView, { stopEvent: ({ event }) => !event.type.startsWith("drag") });
  },
  addCommands() {
    return {
      insertPluginBlock:
        (pluginId) =>
        ({ commands }) =>
          commands.insertContent({ type: "pluginBlock", attrs: { pluginId } }),
    };
  },
});

// ---------------------------------------------------------------------------
// The gallery
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<Plugin["kind"], { label: string; icon: IconName }> = {
  block: { label: "Blocks", icon: "puzzle" },
  theme: { label: "Themes", icon: "palette" },
  home: { label: "Homes", icon: "home" },
  template: { label: "Templates", icon: "template" },
};

function Store({ close }: { close: () => void }) {
  const [list, setList] = useState<Plugin[] | null>(null);
  const [kind, setKind] = useState<Plugin["kind"] | "installed">("block");
  const [busy, setBusy] = useState<string | null>(null);
  const mine = useStore((s) => s.settings["plugins.installed"]) as Plugin[] | undefined;
  const activeTheme = useStore((s) => s.settings["plugins.theme"]);
  const set = useStore((s) => s.setSetting);
  useEffect(() => {
    gallery().then(setList);
  }, []);
  const ids = new Set((mine ?? []).map((p) => p.id));
  const shown = useMemo(() => (kind === "installed" ? mine ?? [] : (list ?? []).filter((p) => p.kind === kind)), [kind, list, mine]);
  const toast = (m: string, tone?: "error") => useStore.getState().toast({ message: m, tone });

  const install = async (p: Plugin) => {
    setBusy(p.id);
    try {
      await installPlugin(p);
      toast(`${nameOf(p)}: ${tr(p.kind === "block" ? "add it to a page with /" : p.kind === "theme" ? "choose Use to apply it" : p.kind === "template" ? "it is in Templates now" : "installed")}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title={tr("Plugins and gallery")} onClose={close} width={860} className="plugin-store">
      <div className="ps-bar">
        <div className="ps-tabs" role="tablist">
          {(["block", "theme", "home", "template", "installed"] as const).map((k) => (
            <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? "is-on" : ""} onClick={() => setKind(k)}>
              <Icon name={k === "installed" ? "check" : KIND_LABEL[k].icon} size={14} />
              {tr(k === "installed" ? "Installed" : KIND_LABEL[k].label)}
            </button>
          ))}
        </div>
        <span className="grow" />
        <button className="btn btn-plain btn-compact" onClick={() => installFromFile()}>
          <Icon name="upload" size={14} />
          {tr("From a file")}
        </button>
        <button
          className="btn btn-plain btn-compact"
          onClick={async () => {
            const url = await promptText({ title: tr("Install from a link"), placeholder: "https://.../plugin.worlds.json", confirm: tr("Install"), validate: (v) => (/^https:\/\//.test(v) ? null : tr("Use an https link.")) });
            if (url) installFromUrl(url).then((p) => toast(`${nameOf(p)} ${tr("installed")}`), (e) => toast(errorMessage(e), "error"));
          }}
        >
          <Icon name="link" size={14} />
          {tr("From a link")}
        </button>
        <button className="btn btn-plain btn-compact" onClick={exportMyTheme} data-tip={tr("Save your accent as a theme file to share")}>
          <Icon name="share" size={14} />
          {tr("Share my theme")}
        </button>
      </div>
      {!list && kind !== "installed" ? (
        <p className="ps-empty">{tr("Loading")}</p>
      ) : shown.length === 0 ? (
        <p className="ps-empty">{kind === "installed" ? tr("Nothing installed yet.") : tr("Nothing here yet.")}</p>
      ) : (
        <div className="ps-grid">
          {shown.map((p) => {
            const has = ids.has(p.id);
            return (
              <article key={p.id} className={`ps-card kind-${p.kind}`}>
                {p.kind === "theme" ? (
                  <div className="ps-swatch" style={{ background: `linear-gradient(135deg, ${p.dark?.["--surface-raised"] ?? "#222"} 0 50%, ${p.light?.["--canvas"] ?? "#eee"} 50%)` }}>
                    <span style={{ background: p.dark?.["--accent"] ?? p.light?.["--accent"] }} />
                  </div>
                ) : (
                  <div className="ps-icon">
                    <Icon name={(p.icon as IconName) || KIND_LABEL[p.kind].icon} size={22} />
                  </div>
                )}
                <h3 className="bidi">{nameOf(p)}</h3>
                <p className="bidi">{descOf(p)}</p>
                <div className="ps-meta">
                  {p.author} · {p.version}
                </div>
                <div className="ps-actions">
                  {has ? (
                    <>
                      {p.kind === "theme" && (
                        <button
                          className={`btn btn-${activeTheme === p.id ? "tinted" : "plain"} btn-compact`}
                          onClick={() => {
                            set("plugins.theme", activeTheme === p.id ? null : p.id);
                            requestAnimationFrame(applyPluginTheme);
                          }}
                        >
                          {activeTheme === p.id ? tr("In use") : tr("Use")}
                        </button>
                      )}
                      <button className="btn btn-plain btn-compact" onClick={() => uninstallPlugin(p.id)}>
                        {tr("Remove")}
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-tinted btn-compact" disabled={busy === p.id} onClick={() => install(p)}>
                      <Icon name="download" size={13} />
                      {tr("Install")}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <p className="ps-note">{tr("Plugins run in a sealed frame with no internet and no access to your pages, except what you put in them. Anyone can share one as a .worlds.json file.")}</p>
    </Modal>
  );
}

export function openPluginStore() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => {
    root.unmount();
    host.remove();
  };
  root.render(<Store close={close} />);
}

/** Slash items for every installed block plugin. */
export function pluginSlashItems() {
  return installed()
    .filter((p) => p.kind === "block")
    .map((p) => ({ id: `plugin:${p.id}`, title: nameOf(p), subtitle: descOf(p), icon: "puzzle" as IconName, group: "Plugins", keywords: `plugin ${p.name} ${p.nameAr ?? ""}` }));
}
