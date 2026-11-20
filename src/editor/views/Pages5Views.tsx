import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import type { Editor, JSONContent } from "@tiptap/core";
import { api, errorMessage, fileUrl, isTauri } from "../../lib/api";
import { emit } from "../../lib/bus";
import { openExternal } from "../../lib/links";
import { useStore, pageTitle } from "../../state/store";
import { Icon, type IconName } from "../../ui/Icon";
import { menuAt, type MenuItem } from "../../ui/Menu";
import { PageIcon } from "../../ui/misc";
import { MenuSelect } from "../../ui/MenuSelect";
import { newProperty, type Property } from "../../pages/properties";
import { tr, uiLanguage } from "../../i18n/ui";
import { addSyncedTo, syncedPages, unregisterSynced } from "../synced";
import { choosePage } from "../choosePage";
import type { FormField, WhiteboardItem } from "../extensions/pages5";
import runnerHtml from "../runner.html?raw";

const pageIdOf = (editor: Editor) => (editor.storage as unknown as { worlds?: { pageId: string } }).worlds?.pageId ?? "";
const toast = (message: string, tone?: "error") => useStore.getState().toast({ message, tone });
const uid = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------------------
// Synced block
// ---------------------------------------------------------------------------

export function SyncedView({ node, editor, getPos }: ReactNodeViewProps) {
  const syncId = node.attrs.syncId as string;
  const pageId = pageIdOf(editor);
  const pages = useStore((s) => s.pages);
  const registry = useStore((s) => s.settings["synced.registry"]);
  const others = useMemo(() => syncedPages(syncId).filter((p) => p !== pageId && pages[p] && !pages[p].deletedAt), [syncId, pageId, pages, registry]);

  const menu = (anchor: HTMLElement) => {
    const items: MenuItem[] = [
      {
        label: "Add to Another Page",
        icon: "add",
        onSelect: async () => {
          const target = await choosePage(anchor);
          if (!target || target === pageId) return;
          try {
            await addSyncedTo(target, syncId, (node.toJSON() as JSONContent).content ?? []);
            toast(tr("Synced block added"));
          } catch (e) {
            toast(errorMessage(e), "error");
          }
        },
      },
    ];
    if (others.length) {
      items.push({ kind: "separator" }, { kind: "label", label: "Also on" });
      for (const id of others) items.push({ label: pageTitle(pages[id]), icon: "page", onSelect: () => useStore.getState().openPage(id) });
    }
    if (editor.isEditable)
      items.push(
        { kind: "separator" },
        {
          label: "Stop Syncing Here",
          icon: "unpin",
          onSelect: () => {
            const pos = typeof getPos === "function" ? getPos() : null;
            if (pos == null) return;
            unregisterSynced(syncId, pageId);
            // The blocks stay on this page as ordinary blocks.
            editor.chain().focus().command(({ tr: t }) => {
              t.replaceWith(pos, pos + node.nodeSize, node.content);
              return true;
            }).run();
          },
        },
      );
    menuAt(anchor, items);
  };

  return (
    <NodeViewWrapper className="synced-block" data-synced={syncId}>
      <div className="synced-bar" contentEditable={false}>
        <button className="synced-chip" onMouseDown={(e) => e.preventDefault()} onClick={(e) => menu(e.currentTarget)}>
          <Icon name="synced" size={12} />
          <span>{others.length ? `${tr("Synced")} · ${others.length + 1}` : tr("Synced")}</span>
          <Icon name="chevronDown" size={11} />
        </button>
      </div>
      <NodeViewContent className="synced-body" />
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// Button block
// ---------------------------------------------------------------------------

type ButtonAction = "insert" | "page" | "template" | "automation" | "claude" | "link";
const BUTTON_ACTIONS: { id: ButtonAction; label: string; icon: IconName; hint: string }[] = [
  { id: "insert", label: "Insert text", icon: "add", hint: "Adds a line under the button. {date} becomes today's date, [] starts a to-do." },
  { id: "claude", label: "Ask Claude", icon: "assistant", hint: "Sends this prompt about the page." },
  { id: "page", label: "Open a page", icon: "page", hint: "" },
  { id: "template", label: "New page from a template", icon: "template", hint: "Adds a subpage made from the template." },
  { id: "automation", label: "Run an automation", icon: "automation", hint: "" },
  { id: "link", label: "Open a link", icon: "link", hint: "" },
];

function fillTokens(text: string) {
  const now = new Date();
  return text
    .replace(/\{date\}/g, now.toLocaleDateString(uiLanguage() === "ar" ? "ar" : undefined, { day: "numeric", month: "long", year: "numeric" }))
    .replace(/\{time\}/g, now.toLocaleTimeString(uiLanguage() === "ar" ? "ar" : undefined, { hour: "numeric", minute: "2-digit" }));
}

export function ButtonBlockView({ node, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const a = node.attrs as { label: string; action: ButtonAction; value: string; style: "tinted" | "plain" };
  const pageId = pageIdOf(editor);
  const [editing, setEditing] = useState(!a.label);
  const [busy, setBusy] = useState(false);
  const allPages = useStore((s) => s.pages);
  const templates = useMemo(() => Object.values(allPages).filter((p) => p.kind === "template" && !p.deletedAt && !p.parentId), [allPages]);
  const [automations, setAutomations] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!editing || a.action !== "automation") return;
    api
      .automations()
      .then((list) => setAutomations(list.map((x) => ({ id: x.id, name: (x as { name?: string; title?: string }).name ?? (x as { title?: string }).title ?? x.id }))))
      .catch(() => undefined);
  }, [editing, a.action]);
  const pages = useStore((s) => s.pages);
  const action = BUTTON_ACTIONS.find((x) => x.id === a.action) ?? BUTTON_ACTIONS[0];

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      switch (a.action) {
        case "insert": {
          const pos = typeof getPos === "function" ? getPos() : null;
          if (pos == null) break;
          const text = fillTokens(a.value || "");
          const at = pos + node.nodeSize;
          const lines = text.split("\n").filter((l) => l.length);
          const content: JSONContent[] = lines.map((line) =>
            line.startsWith("[]")
              ? { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: line.slice(2).trim() ? [{ type: "text", text: line.slice(2).trim() }] : [] }] }] }
              : { type: "paragraph", content: [{ type: "text", text: line }] },
          );
          editor.chain().focus().insertContentAt(at, content.length ? content : [{ type: "paragraph" }]).run();
          break;
        }
        case "claude":
          emit("ai:open", { pageId, prompt: a.value });
          break;
        case "page":
          if (a.value && pages[a.value]) useStore.getState().openPage(a.value);
          break;
        case "template": {
          if (!a.value) break;
          const meta = await api.instantiate(a.value, pageId);
          await useStore.getState().refreshPages();
          useStore.getState().openPage(meta.id);
          break;
        }
        case "automation":
          if (a.value) {
            await api.runAutomation(a.value);
            toast(tr("Automation started"));
          }
          break;
        case "link":
          if (a.value) await openExternal(a.value);
          break;
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <NodeViewWrapper className={`button-block ${editing ? "is-editing" : ""}`} contentEditable={false}>
      <div className="button-block-row">
        <button className={`btn btn-${a.style === "plain" ? "plain" : "tinted"} btn-standard`} onClick={run} disabled={busy}>
          <Icon name={action.icon} size={15} />
          <span className="bidi">{a.label || tr(action.label)}</span>
        </button>
        {editor.isEditable && (
          <button className="icon-btn button-block-edit" aria-label={tr("Edit button")} data-tip={tr("Edit button")} onClick={() => setEditing(!editing)}>
            <Icon name="settings" size={14} />
          </button>
        )}
      </div>
      {editing && editor.isEditable && (
        <div className="button-block-form">
          <label>
            <span>{tr("Label")}</span>
            <input className="field bidi" dir="auto" value={a.label} placeholder={tr(action.label)} onChange={(e) => updateAttributes({ label: e.target.value })} />
          </label>
          <label>
            <span>{tr("When clicked")}</span>
            <MenuSelect value={a.action} onChange={(e) => updateAttributes({ action: e.target.value, value: "" })}>
              {BUTTON_ACTIONS.map((x) => (
                <option key={x.id} value={x.id}>
                  {tr(x.label)}
                </option>
              ))}
            </MenuSelect>
          </label>
          {(a.action === "insert" || a.action === "claude") && (
            <label className="is-wide">
              <span>{a.action === "insert" ? tr("Text to add") : tr("Prompt")}</span>
              <textarea className="field bidi" dir="auto" rows={3} value={a.value} onChange={(e) => updateAttributes({ value: e.target.value })} />
              {action.hint && <small>{tr(action.hint)}</small>}
            </label>
          )}
          {a.action === "link" && (
            <label className="is-wide">
              <span>{tr("Link")}</span>
              <input className="field" dir="ltr" value={a.value} placeholder="https://" onChange={(e) => updateAttributes({ value: e.target.value })} />
            </label>
          )}
          {a.action === "page" && (
            <label>
              <span>{tr("Page")}</span>
              <button
                className="field select-trigger"
                onClick={async (e) => {
                  const id = await choosePage(e.currentTarget);
                  if (id) updateAttributes({ value: id });
                }}
              >
                <span className="select-value bidi">{a.value && pages[a.value] ? pageTitle(pages[a.value]) : tr("Choose a page")}</span>
                <Icon name="chevronDown" size={14} />
              </button>
            </label>
          )}
          {a.action === "template" && (
            <label>
              <span>{tr("Template")}</span>
              <MenuSelect value={a.value} onChange={(e) => updateAttributes({ value: e.target.value })}>
                <option value="">{tr("Choose a template")}</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {pageTitle(t)}
                  </option>
                ))}
              </MenuSelect>
            </label>
          )}
          {a.action === "automation" && (
            <label>
              <span>{tr("Automation")}</span>
              <MenuSelect value={a.value} onChange={(e) => updateAttributes({ value: e.target.value })}>
                <option value="">{tr("Choose an automation")}</option>
                {automations.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </MenuSelect>
            </label>
          )}
          <label>
            <span>{tr("Style")}</span>
            <MenuSelect value={a.style} onChange={(e) => updateAttributes({ style: e.target.value })}>
              <option value="tinted">{tr("Tinted")}</option>
              <option value="plain">{tr("Plain")}</option>
            </MenuSelect>
          </label>
          <div className="button-block-done">
            <button className="btn btn-tinted btn-compact" onClick={() => setEditing(false)}>
              {tr("Done")}
            </button>
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// Voice note
// ---------------------------------------------------------------------------

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function speechRecognition(): (new () => Recognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function VoiceNoteView({ node, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const a = node.attrs as { attachmentId: string | null; transcript: string; duration: number; lang: string | null };
  const pageId = pageIdOf(editor);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [live, setLive] = useState("");
  const [lang, setLang] = useState<string>(a.lang ?? (uiLanguage() === "ar" ? "ar-SA" : "en-US"));
  const recorder = useRef<MediaRecorder | null>(null);
  const recog = useRef<Recognition | null>(null);
  const finalText = useRef("");
  const timer = useRef(0);
  const started = useRef(0);
  const canTranscribe = !!speechRecognition();

  useEffect(() => () => {
    window.clearInterval(timer.current);
    recorder.current?.state === "recording" && recorder.current.stop();
    recog.current?.stop();
  }, []);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        window.clearInterval(timer.current);
        const seconds = Math.round((Date.now() - started.current) / 1000);
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        try {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const name = `${tr("Voice note")} ${new Date().toLocaleString()}.webm`.replace(/[\\/:*?"<>|]/g, "-");
          const att = await api.importBytes(pageId, name, bytes);
          updateAttributes({ attachmentId: att.id, duration: seconds, transcript: (a.transcript ? a.transcript + "\n" : "") + finalText.current.trim(), lang });
        } catch (e) {
          toast(errorMessage(e), "error");
        }
        setLive("");
      };
      recorder.current = rec;
      rec.start();
      started.current = Date.now();
      setElapsed(0);
      timer.current = window.setInterval(() => setElapsed((Date.now() - started.current) / 1000), 250);
      setRecording(true);
      finalText.current = "";
      const SR = speechRecognition();
      if (SR) {
        const r = new SR();
        r.lang = lang;
        r.continuous = true;
        r.interimResults = true;
        r.onresult = (e) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            if (res.isFinal) finalText.current += res[0].transcript + " ";
            else interim += res[0].transcript;
          }
          setLive(finalText.current + interim);
        };
        r.onerror = () => undefined;
        try {
          r.start();
          recog.current = r;
        } catch {
          recog.current = null;
        }
      }
    } catch (e) {
      toast(tr("Worlds needs the microphone to record. Allow it in your system settings."), "error");
      void e;
    }
  };

  const stop = () => {
    recog.current?.stop();
    recog.current = null;
    recorder.current?.stop();
    setRecording(false);
  };

  const asText = () => {
    const pos = typeof getPos === "function" ? getPos() : null;
    if (pos == null || !a.transcript.trim()) return;
    const paras = a.transcript.split(/\n+/).filter(Boolean).map((t) => ({ type: "paragraph", content: [{ type: "text", text: t.trim() }] }));
    editor.chain().focus().insertContentAt(pos + node.nodeSize, paras).run();
  };

  return (
    <NodeViewWrapper className={`voice-note ${recording ? "is-recording" : ""}`} contentEditable={false}>
      <div className="voice-head">
        <span className="voice-icon">
          <Icon name="voice" size={16} />
        </span>
        {a.attachmentId && !recording ? (
          <audio className="voice-audio" controls preload="metadata" src={fileUrl(a.attachmentId)} />
        ) : (
          <span className="voice-status">{recording ? clock(elapsed) : tr("Voice note")}</span>
        )}
        {editor.isEditable && (
          <>
            {!recording && (
              <MenuSelect value={lang} aria-label={tr("Language")} onChange={(e) => setLang(e.target.value)} className="voice-lang">
                <option value="ar-SA">العربية</option>
                <option value="en-US">English</option>
              </MenuSelect>
            )}
            <button className={`btn btn-${recording ? "danger" : "tinted"} btn-compact`} onClick={recording ? stop : start}>
              <Icon name={recording ? "square" : "mic"} size={14} />
              {recording ? tr("Stop") : a.attachmentId ? tr("Record more") : tr("Record")}
            </button>
          </>
        )}
      </div>
      {recording && <p className="voice-live bidi" dir="auto">{live || (canTranscribe ? tr("Listening") : tr("Recording. This device cannot write the words down; you can type them after."))}</p>}
      {!recording && (a.transcript || editor.isEditable) && (a.attachmentId || a.transcript) && (
        <div className="voice-transcript">
          <textarea
            className="field bidi"
            dir="auto"
            rows={Math.min(8, Math.max(2, a.transcript.split("\n").length + 1))}
            value={a.transcript}
            readOnly={!editor.isEditable}
            placeholder={tr("Transcript")}
            onChange={(e) => updateAttributes({ transcript: e.target.value })}
          />
          {editor.isEditable && a.transcript.trim() && (
            <button className="btn btn-plain btn-compact" onClick={asText}>
              <Icon name="text" size={14} />
              {tr("Add as text")}
            </button>
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// Footnotes
// ---------------------------------------------------------------------------

/** Footnote ids in document order. */
function footnoteOrder(editor: Editor): { fid: string; text: string; pos: number }[] {
  const out: { fid: string; text: string; pos: number }[] = [];
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === "footnote") out.push({ fid: n.attrs.fid ?? `@${pos}`, text: n.attrs.text ?? "", pos });
  });
  return out;
}

function useDocRevision(editor: Editor) {
  const [rev, setRev] = useState(0);
  useEffect(() => {
    const bump = () => setRev((r) => r + 1);
    editor.on("update", bump);
    return () => {
      editor.off("update", bump);
    };
  }, [editor]);
  return rev;
}

export function FootnoteView({ node, updateAttributes, editor, getPos, selected }: ReactNodeViewProps) {
  const rev = useDocRevision(editor);
  const pos = typeof getPos === "function" ? getPos() : -1;
  const number = useMemo(() => footnoteOrder(editor).findIndex((f) => f.pos === pos) + 1, [editor, pos, rev]);
  const [open, setOpen] = useState(!node.attrs.text && editor.isEditable);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [open]);
  return (
    <NodeViewWrapper as="span" className={`footnote-ref ${selected ? "is-selected" : ""}`} ref={ref}>
      <sup>
        <button className="footnote-num" contentEditable={false} onClick={() => setOpen(!open)} aria-label={`${tr("Footnote")} ${number}`}>
          {number || "?"}
        </button>
      </sup>
      {open && (
        <span className="footnote-pop" contentEditable={false}>
          <textarea
            className="field bidi"
            dir="auto"
            autoFocus={editor.isEditable}
            rows={3}
            readOnly={!editor.isEditable}
            value={node.attrs.text}
            placeholder={tr("Footnote text")}
            onChange={(e) => updateAttributes({ text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
                e.preventDefault();
                setOpen(false);
                editor.commands.focus();
              }
            }}
          />
        </span>
      )}
    </NodeViewWrapper>
  );
}

export function FootnotesView({ editor }: ReactNodeViewProps) {
  const rev = useDocRevision(editor);
  const notes = useMemo(() => footnoteOrder(editor), [editor, rev]);
  return (
    <NodeViewWrapper className="footnotes-block" contentEditable={false}>
      <div className="footnotes-title">{tr("Footnotes")}</div>
      {notes.length ? (
        <ol className="footnotes-list">
          {notes.map((n, i) => (
            <li key={n.fid + i}>
              <button
                className="footnote-back"
                aria-label={tr("Go to the note")}
                onClick={() => {
                  editor.chain().focus().setNodeSelection(n.pos).scrollIntoView().run();
                }}
              >
                {i + 1}
              </button>
              <span className="bidi" dir="auto">
                {n.text || <em className="footnote-empty">{tr("Empty footnote")}</em>}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="footnotes-empty">{tr("Footnotes you add with /Footnote are listed here.")}</p>
      )}
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

const FIELD_TYPES: { id: FormField["type"]; label: string; prop: Property["type"] }[] = [
  { id: "text", label: "Short answer", prop: "text" },
  { id: "longtext", label: "Paragraph", prop: "text" },
  { id: "email", label: "Email", prop: "url" },
  { id: "number", label: "Number", prop: "number" },
  { id: "date", label: "Date", prop: "date" },
  { id: "select", label: "Choice", prop: "select" },
  { id: "checkbox", label: "Checkbox", prop: "checkbox" },
];

export function FormBlockView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const a = node.attrs as { title: string; description: string; fields: FormField[]; target: string | null; submit: string };
  const pageId = pageIdOf(editor);
  const pages = useStore((s) => s.pages);
  const [mode, setMode] = useState<"fill" | "edit">(editor.isEditable && !a.title ? "edit" : "fill");
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const responses = useMemo(() => (a.target ? Object.values(pages).filter((p) => p.parentId === a.target && !p.deletedAt).length : 0), [pages, a.target]);

  const setField = (i: number, patch: Partial<FormField>) => updateAttributes({ fields: a.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const moveField = (i: number, d: -1 | 1) => {
    const next = [...a.fields];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    updateAttributes({ fields: next });
  };

  const submit = async () => {
    const missing = a.fields.find((f) => f.required && (values[f.id] === undefined || values[f.id] === ""));
    if (missing) return toast(`${tr("Fill in")} ${missing.label}`, "error");
    setBusy(true);
    try {
      let target = a.target && pages[a.target] && !pages[a.target].deletedAt ? a.target : null;
      if (!target) {
        const holder = await api.createPage({ parentId: pageId, title: `${a.title || tr("Form")} · ${tr("Responses")}` } as never);
        await api.saveBlocks(holder.id, [{ id: `b${uid()}`, content: { type: "collection", attrs: { bid: `b${uid()}`, view: "table", source: "children" } } }]).catch(() => undefined);
        target = holder.id;
        updateAttributes({ target });
      }
      const first = a.fields.find((f) => f.type === "text" && values[f.id]);
      const title = first ? String(values[first.id]) : `${tr("Response")} ${new Date().toLocaleString()}`;
      const page = await api.createPage({ parentId: target, title } as never);
      const props: Property[] = a.fields.map((f) => {
        const type = FIELD_TYPES.find((t) => t.id === f.type)?.prop ?? "text";
        const p = newProperty(type, f.label);
        const v = values[f.id];
        p.value = v === undefined || v === "" ? null : type === "number" ? Number(v) : type === "checkbox" ? Boolean(v) : (v as string);
        if (type === "select" && f.options?.length) p.options = f.options.map((name, i) => ({ name, color: (["blue", "green", "yellow", "orange", "purple", "pink", "red", "gray"] as const)[i % 8] }));
        return p;
      });
      await api.setPageMeta(page.id, "properties", props);
      await useStore.getState().refreshPages();
      setValues({});
      setSent(true);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const fieldInput = (f: FormField) => {
    const v = values[f.id];
    const set = (val: string | boolean) => setValues((s) => ({ ...s, [f.id]: val }));
    switch (f.type) {
      case "longtext":
        return <textarea className="field bidi" dir="auto" rows={4} value={(v as string) ?? ""} onChange={(e) => set(e.target.value)} />;
      case "checkbox":
        return (
          <label className="form-check">
            <input type="checkbox" checked={Boolean(v)} onChange={(e) => set(e.target.checked)} />
            <span>{tr("Yes")}</span>
          </label>
        );
      case "select":
        return (
          <MenuSelect value={(v as string) ?? ""} onChange={(e) => set(e.target.value)}>
            <option value="">{tr("Choose")}</option>
            {(f.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </MenuSelect>
        );
      default:
        return (
          <input
            className="field bidi"
            dir={f.type === "email" || f.type === "number" ? "ltr" : "auto"}
            type={f.type}
            value={(v as string) ?? ""}
            onChange={(e) => set(e.target.value)}
          />
        );
    }
  };

  return (
    <NodeViewWrapper className={`form-block is-${mode}`} contentEditable={false}>
      {editor.isEditable && (
        <div className="form-modes" role="tablist">
          <button role="tab" aria-selected={mode === "edit"} className={mode === "edit" ? "is-on" : ""} onClick={() => setMode("edit")}>
            <Icon name="edit" size={13} />
            {tr("Edit")}
          </button>
          <button role="tab" aria-selected={mode === "fill"} className={mode === "fill" ? "is-on" : ""} onClick={() => setMode("fill")}>
            <Icon name="preview" size={13} />
            {tr("Preview")}
          </button>
          {a.target && pages[a.target] && (
            <button className="form-responses" onClick={() => useStore.getState().openPage(a.target!)}>
              <Icon name="table" size={13} />
              {responses} {tr("responses")}
            </button>
          )}
        </div>
      )}
      {mode === "edit" ? (
        <div className="form-edit">
          <input className="form-title-input bidi" dir="auto" value={a.title} placeholder={tr("Form title")} onChange={(e) => updateAttributes({ title: e.target.value })} />
          <textarea className="form-desc-input bidi" dir="auto" rows={2} value={a.description} placeholder={tr("Description (optional)")} onChange={(e) => updateAttributes({ description: e.target.value })} />
          {a.fields.map((f, i) => (
            <div className="form-field-edit" key={f.id}>
              <input className="field bidi" dir="auto" value={f.label} placeholder={tr("Question")} onChange={(e) => setField(i, { label: e.target.value })} />
              <MenuSelect value={f.type} onChange={(e) => setField(i, { type: e.target.value as FormField["type"] })}>
                {FIELD_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {tr(t.label)}
                  </option>
                ))}
              </MenuSelect>
              <button
                className="icon-btn"
                aria-label={tr("More")}
                onClick={(e) =>
                  menuAt(e.currentTarget, [
                    { label: "Required", checked: !!f.required, onSelect: () => setField(i, { required: !f.required }) },
                    { label: "Move Up", icon: "arrowUp", onSelect: () => moveField(i, -1) },
                    { label: "Move Down", icon: "chevronDown", onSelect: () => moveField(i, 1) },
                    { kind: "separator" },
                    { label: "Delete Question", icon: "delete", danger: true, onSelect: () => updateAttributes({ fields: a.fields.filter((_, j) => j !== i) }) },
                  ])
                }
              >
                <Icon name="more" size={14} />
              </button>
              {f.type === "select" && (
                <input
                  className="field bidi is-wide"
                  dir="auto"
                  value={(f.options ?? []).join(", ")}
                  placeholder={tr("Choices, separated by commas")}
                  onChange={(e) => setField(i, { options: e.target.value.split(/[,،]/).map((s) => s.trim()).filter(Boolean) })}
                />
              )}
            </div>
          ))}
          <div className="form-edit-actions">
            <button className="btn btn-plain btn-compact" onClick={() => updateAttributes({ fields: [...a.fields, { id: uid(), label: "", type: "text" }] })}>
              <Icon name="add" size={14} />
              {tr("Add question")}
            </button>
            <input className="field form-submit-input bidi" dir="auto" value={a.submit} placeholder={tr("Send button text")} onChange={(e) => updateAttributes({ submit: e.target.value })} />
          </div>
        </div>
      ) : sent ? (
        <div className="form-sent">
          <Icon name="success" size={22} />
          <p>{tr("Thanks. Your response was saved.")}</p>
          <button className="btn btn-plain btn-compact" onClick={() => setSent(false)}>
            {tr("Send another response")}
          </button>
        </div>
      ) : (
        <form
          className="form-fill"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {a.title && <h3 className="form-title bidi">{a.title}</h3>}
          {a.description && <p className="form-desc bidi">{a.description}</p>}
          {a.fields.map((f) => (
            <label key={f.id} className="form-field">
              <span className="form-label bidi">
                {f.label || tr("Question")}
                {f.required && <span className="form-req"> *</span>}
              </span>
              {fieldInput(f)}
            </label>
          ))}
          <div className="form-actions">
            <button type="submit" className="btn btn-tinted btn-standard" disabled={busy}>
              {a.submit || tr("Send")}
            </button>
          </div>
        </form>
      )}
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// Runnable code
// ---------------------------------------------------------------------------

type RunLine = { kind: "out" | "err" | "status"; text: string };

export function CodeRunView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const a = node.attrs as { language: "javascript" | "python"; code: string; output: string; ok: boolean };
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef<Promise<void> | null>(null);
  const readyResolve = useRef<() => void>(() => undefined);
  const [lines, setLines] = useState<RunLine[] | null>(null);
  const [running, setRunning] = useState(false);
  const [frameOn, setFrameOn] = useState(false);
  const collected = useRef<RunLine[]>([]);
  const timeout = useRef(0);
  const mock = Boolean((window as unknown as { __WORLDS_MOCK__?: boolean }).__WORLDS_MOCK__);
  const useProtocol = isTauri && !mock;

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const d = e.data as { worldsRun?: number; type?: string; text?: string };
      if (!d || d.worldsRun !== 1) return;
      if (d.type === "ready") return readyResolve.current();
      if (d.type === "done") {
        window.clearTimeout(timeout.current);
        setRunning(false);
        const text = collected.current.filter((l) => l.kind !== "status").map((l) => l.text).join("\n");
        updateAttributes({ output: text.slice(0, 20000), ok: !collected.current.some((l) => l.kind === "err") });
        return;
      }
      const line: RunLine = { kind: d.type === "err" ? "err" : d.type === "status" ? "status" : "out", text: String(d.text ?? "") };
      collected.current = [...collected.current.filter((l) => l.kind !== "status"), line];
      setLines(collected.current);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [updateAttributes]);

  const ensureFrame = () => {
    if (!ready.current) {
      ready.current = new Promise<void>((r) => (readyResolve.current = r));
      setFrameOn(true);
    }
    return ready.current;
  };

  const run = async () => {
    collected.current = [];
    setLines([]);
    setRunning(true);
    await ensureFrame();
    window.clearTimeout(timeout.current);
    // Long JavaScript gets a fresh frame after 20 seconds; Python may first need to load.
    timeout.current = window.setTimeout(
      () => {
        setRunning(false);
        collected.current = [...collected.current, { kind: "err", text: tr("Stopped: the code ran too long.") }];
        setLines(collected.current);
        ready.current = null;
        setFrameOn(false);
      },
      a.language === "python" ? 120000 : 20000,
    );
    frame.current?.contentWindow?.postMessage({ worldsRun: 1, language: a.language, code: a.code }, "*");
  };

  const shown: RunLine[] = lines ?? (a.output ? a.output.split("\n").map((t) => ({ kind: a.ok ? "out" : "err", text: t })) : []);

  return (
    <NodeViewWrapper className="code-run" contentEditable={false}>
      <div className="code-run-head">
        <MenuSelect value={a.language} aria-label={tr("Language")} onChange={(e) => updateAttributes({ language: e.target.value })} disabled={!editor.isEditable}>
          <option value="javascript">JavaScript</option>
          <option value="python">Python</option>
        </MenuSelect>
        <span className="code-run-spacer" />
        {shown.length > 0 && (
          <button className="btn btn-plain btn-compact" onClick={() => (setLines(null), updateAttributes({ output: "" }))}>
            {tr("Clear")}
          </button>
        )}
        <button className="btn btn-tinted btn-compact" onClick={run} disabled={running || !a.code.trim()}>
          <Icon name={running ? "loading" : "play"} size={13} />
          {running ? tr("Running") : tr("Run")}
        </button>
      </div>
      <textarea
        className="code-run-src"
        dir="ltr"
        spellCheck={false}
        value={a.code}
        readOnly={!editor.isEditable}
        rows={Math.min(24, Math.max(4, a.code.split("\n").length + 1))}
        onChange={(e) => updateAttributes({ code: e.target.value })}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            void run();
            return;
          }
          if (e.key === "Tab") {
            e.preventDefault();
            const el = e.currentTarget;
            const { selectionStart: s, selectionEnd: t } = el;
            const next = el.value.slice(0, s) + "  " + el.value.slice(t);
            updateAttributes({ code: next });
            requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
          }
        }}
      />
      {shown.length > 0 && (
        <pre className="code-run-out" dir="ltr">
          {shown.map((l, i) => (
            <div key={i} className={`run-${l.kind}`}>
              {l.text}
            </div>
          ))}
        </pre>
      )}
      {frameOn &&
        (useProtocol ? (
          <iframe ref={frame} className="code-run-frame" title="Code runner" sandbox="allow-scripts" src="http://whtml.localhost/_w/runner" />
        ) : (
          <iframe ref={frame} className="code-run-frame" title="Code runner" sandbox="allow-scripts" srcDoc={runnerHtml} />
        ))}
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// Whiteboard
// ---------------------------------------------------------------------------

type Tool = "select" | "hand" | "sticky" | "text" | "rect" | "ellipse" | "arrow" | "pen";
const TOOLS: { id: Tool; icon: IconName; label: string; key: string }[] = [
  { id: "select", icon: "pointer", label: "Select", key: "v" },
  { id: "hand", icon: "hand", label: "Move the board", key: "h" },
  { id: "sticky", icon: "sticky", label: "Sticky note", key: "s" },
  { id: "text", icon: "typeTool", label: "Text", key: "t" },
  { id: "rect", icon: "square", label: "Rectangle", key: "r" },
  { id: "ellipse", icon: "circle", label: "Ellipse", key: "o" },
  { id: "arrow", icon: "arrowUpRight", label: "Arrow", key: "a" },
  { id: "pen", icon: "pen", label: "Pen", key: "p" },
];
const STICKY_COLORS = ["#ffe58a", "#b9f0c4", "#b8dcff", "#ffc7dd", "#dccbff", "#e6e6e9"];
const INK_COLORS = ["currentColor", "#ff6f6f", "#ff9f50", "#4cd38a", "#64a8ff", "#b28dff"];

const center = (it: WhiteboardItem) => [it.x + it.w / 2, it.y + it.h / 2] as const;

/** The point where a line from the centre toward (tx, ty) leaves the item's box. */
function edgePoint(it: WhiteboardItem, tx: number, ty: number): [number, number] {
  const [cx, cy] = center(it);
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const sx = it.w / 2 / Math.abs(dx || 1e-9);
  const sy = it.h / 2 / Math.abs(dy || 1e-9);
  const s = Math.min(sx, sy);
  return [cx + dx * s, cy + dy * s];
}

export function WhiteboardView({ node, updateAttributes, editor, selected }: ReactNodeViewProps) {
  const attrs = node.attrs as { items: WhiteboardItem[]; height: number; view: { x: number; y: number; zoom: number } };
  const [items, setItems] = useState<WhiteboardItem[]>(attrs.items ?? []);
  const [view, setView] = useState(attrs.view ?? { x: 0, y: 0, zoom: 1 });
  const [tool, setTool] = useState<Tool>("select");
  const [sel, setSel] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [color, setColor] = useState(STICKY_COLORS[0]);
  const [ink, setInk] = useState(INK_COLORS[0]);
  const [full, setFull] = useState(false);
  const board = useRef<HTMLDivElement>(null);
  const drag = useRef<null | { mode: "move" | "create" | "pan" | "resize" | "pen" | "arrow" | "marquee"; sx: number; sy: number; ox: number; oy: number; start: WhiteboardItem[]; id?: string }>(null);
  const [marquee, setMarquee] = useState<null | { x: number; y: number; w: number; h: number }>(null);
  const editable = editor.isEditable;
  const pages = useStore((s) => s.pages);

  // Take outside changes (undo, another pane) when not in the middle of a gesture.
  useEffect(() => {
    if (!drag.current) setItems(attrs.items ?? []);
  }, [attrs.items]);

  const save = useCallback(
    (next: WhiteboardItem[], nextView = view) => {
      updateAttributes({ items: next, view: nextView });
    },
    [updateAttributes, view],
  );

  const toBoard = (clientX: number, clientY: number) => {
    const r = board.current!.getBoundingClientRect();
    return [(clientX - r.left - view.x) / view.zoom, (clientY - r.top - view.y) / view.zoom] as const;
  };

  const hit = (x: number, y: number) => {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.kind === "arrow" || it.kind === "pen") continue;
      if (x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h) return it;
    }
    return null;
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!editable && tool !== "hand") return;
    if ((e.target as HTMLElement).closest(".wb-toolbar, textarea, .wb-handle")) return;
    board.current?.setPointerCapture(e.pointerId);
    const [x, y] = toBoard(e.clientX, e.clientY);
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-wb-id]")?.dataset.wbId;
    if (tool === "hand" || e.button === 1 || (e.button === 0 && e.altKey)) {
      drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, start: items };
      return;
    }
    if (tool === "select") {
      if (target) {
        const next = e.shiftKey ? (sel.includes(target) ? sel.filter((s) => s !== target) : [...sel, target]) : sel.includes(target) ? sel : [target];
        setSel(next);
        drag.current = { mode: "move", sx: x, sy: y, ox: 0, oy: 0, start: items };
      } else {
        setSel([]);
        setEditingId(null);
        drag.current = { mode: "marquee", sx: x, sy: y, ox: 0, oy: 0, start: items };
        setMarquee({ x, y, w: 0, h: 0 });
      }
      return;
    }
    if (tool === "pen") {
      const it: WhiteboardItem = { id: uid(), kind: "pen", x, y, w: 0, h: 0, points: [[x, y]], color: ink };
      setItems([...items, it]);
      drag.current = { mode: "pen", sx: x, sy: y, ox: 0, oy: 0, start: items, id: it.id };
      return;
    }
    if (tool === "arrow") {
      const from = hit(x, y);
      const it: WhiteboardItem = { id: uid(), kind: "arrow", x, y, w: 0, h: 0, points: [[x, y], [x, y]], from: from?.id ?? null, to: null, color: ink };
      setItems([...items, it]);
      drag.current = { mode: "arrow", sx: x, sy: y, ox: 0, oy: 0, start: items, id: it.id };
      return;
    }
    const size = tool === "sticky" ? [180, 140] : tool === "text" ? [220, 40] : [160, 100];
    const it: WhiteboardItem = {
      id: uid(),
      kind: tool,
      x: x - (tool === "sticky" ? size[0] / 2 : 0),
      y: y - (tool === "sticky" ? size[1] / 2 : 0),
      w: size[0],
      h: size[1],
      text: "",
      color: tool === "sticky" ? color : ink,
    };
    const next = [...items, it];
    setItems(next);
    setSel([it.id]);
    if (tool === "sticky" || tool === "text") {
      // Keep the board from taking focus on mouse down: the new note's text field gets it.
      e.preventDefault();
      setEditingId(it.id);
      setTool("select");
      save(next);
      drag.current = null;
    } else {
      drag.current = { mode: "create", sx: x, sy: y, ox: 0, oy: 0, start: items, id: it.id };
    }
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === "pan") {
      setView({ ...view, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) });
      return;
    }
    const [x, y] = toBoard(e.clientX, e.clientY);
    if (d.mode === "move") {
      const dx = x - d.sx;
      const dy = y - d.sy;
      setItems(
        d.start.map((it) => {
          if (!sel.includes(it.id)) return it;
          if (it.kind === "pen" || (it.kind === "arrow" && it.points)) return { ...it, x: it.x + dx, y: it.y + dy, points: it.points?.map(([px, py]) => [px + dx, py + dy] as [number, number]) };
          return { ...it, x: it.x + dx, y: it.y + dy };
        }),
      );
    } else if (d.mode === "resize" && d.id) {
      setItems(d.start.map((it) => (it.id === d.id ? { ...it, w: Math.max(40, d.ox + (x - d.sx)), h: Math.max(30, d.oy + (y - d.sy)) } : it)));
    } else if (d.mode === "create" && d.id) {
      setItems((cur) => cur.map((it) => (it.id === d.id ? { ...it, x: Math.min(d.sx, x), y: Math.min(d.sy, y), w: Math.max(8, Math.abs(x - d.sx)), h: Math.max(8, Math.abs(y - d.sy)) } : it)));
    } else if (d.mode === "pen" && d.id) {
      setItems((cur) => cur.map((it) => (it.id === d.id ? { ...it, points: [...(it.points ?? []), [x, y]] } : it)));
    } else if (d.mode === "arrow" && d.id) {
      setItems((cur) => cur.map((it) => (it.id === d.id ? { ...it, points: [it.points![0], [x, y]] } : it)));
    } else if (d.mode === "marquee") {
      setMarquee({ x: Math.min(d.sx, x), y: Math.min(d.sy, y), w: Math.abs(x - d.sx), h: Math.abs(y - d.sy) });
    }
  };

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.mode === "pan") {
      save(items, view);
      return;
    }
    if (d.mode === "marquee") {
      const m = marquee;
      setMarquee(null);
      if (m && (m.w > 4 || m.h > 4)) {
        setSel(items.filter((it) => it.kind !== "arrow" && it.x < m.x + m.w && it.x + it.w > m.x && it.y < m.y + m.h && it.y + it.h > m.y).map((it) => it.id));
      }
      return;
    }
    let next = items;
    if (d.mode === "arrow" && d.id) {
      const [x, y] = toBoard(e.clientX, e.clientY);
      const to = hit(x, y);
      next = items.map((it) => (it.id === d.id ? { ...it, to: to && to.id !== it.from ? to.id : null } : it));
      const arrow = next.find((it) => it.id === d.id)!;
      const [[ax, ay], [bx, by]] = arrow.points!;
      if (Math.hypot(bx - ax, by - ay) < 6 && !arrow.to) next = next.filter((it) => it.id !== d.id);
      setTool("select");
    }
    if (d.mode === "create") setTool("select");
    if (d.mode === "pen" && d.id) {
      next = items.map((it) => {
        if (it.id !== d.id || !it.points) return it;
        const xs = it.points.map((p) => p[0]);
        const ys = it.points.map((p) => p[1]);
        return { ...it, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      });
    }
    setItems(next);
    save(next);
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!full && !e.ctrlKey) return;
    e.preventDefault();
    if (e.ctrlKey) {
      const r = board.current!.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const zoom = Math.min(3, Math.max(0.25, view.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      setView({ zoom, x: mx - ((mx - view.x) / view.zoom) * zoom, y: my - ((my - view.y) / view.zoom) * zoom });
    } else setView({ ...view, x: view.x - e.deltaX, y: view.y - e.deltaY });
  };

  const removeSelected = () => {
    if (!sel.length) return;
    const next = items.filter((it) => !sel.includes(it.id) && !(it.kind === "arrow" && (sel.includes(it.from ?? "") || sel.includes(it.to ?? ""))));
    setItems(next);
    setSel([]);
    save(next);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "TEXTAREA") return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeSelected();
    } else if (e.key === "Escape") {
      if (full) setFull(false);
      setSel([]);
    } else if (!e.ctrlKey && !e.metaKey) {
      const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (t) setTool(t.id);
    }
    e.stopPropagation();
  };

  const addPicture = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const att = await api.importBytes(pageIdOf(editor), f.name, new Uint8Array(await f.arrayBuffer()));
        const r = board.current!.getBoundingClientRect();
        const [cx, cy] = toBoard(r.left + r.width / 2, r.top + r.height / 2);
        const it: WhiteboardItem = { id: uid(), kind: "image", x: cx - 120, y: cy - 90, w: 240, h: 180, attachmentId: att.id };
        const next = [...items, it];
        setItems(next);
        save(next);
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    };
    input.click();
  };

  const addPage = async (anchor: HTMLElement) => {
    const id = await choosePage(anchor);
    if (!id) return;
    const r = board.current!.getBoundingClientRect();
    const [cx, cy] = toBoard(r.left + r.width / 2, r.top + r.height / 2);
    const it: WhiteboardItem = { id: uid(), kind: "page", x: cx - 110, y: cy - 30, w: 220, h: 60, pageId: id };
    const next = [...items, it];
    setItems(next);
    save(next);
  };

  const setText = (id: string, text: string) => setItems((cur) => cur.map((it) => (it.id === id ? { ...it, text } : it)));

  const byId = new Map(items.map((it) => [it.id, it]));
  const arrowPath = (it: WhiteboardItem) => {
    let [a, b] = it.points ?? [
      [it.x, it.y],
      [it.x + it.w, it.y + it.h],
    ];
    const from = it.from ? byId.get(it.from) : null;
    const to = it.to ? byId.get(it.to) : null;
    if (from) a = edgePoint(from, ...(to ? center(to) : b));
    if (to) b = edgePoint(to, ...(from ? center(from) : a));
    return [a, b] as const;
  };

  return (
    <NodeViewWrapper className={`whiteboard ${full ? "is-full" : ""} ${selected ? "is-selected" : ""}`} contentEditable={false}>
      <div className="wb-frame" style={{ height: full ? undefined : attrs.height }} tabIndex={0} onKeyDown={onKeyDown}>
        <div
          ref={board}
          className={`wb-board tool-${tool}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
          style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px` }}
        >
          <div className="wb-layer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
            <svg className="wb-ink" width="1" height="1">
              <defs>
                <marker id={`wb-head-${node.attrs.bid ?? "x"}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0 10 5 0 10z" fill="context-stroke" />
                </marker>
              </defs>
              {items.map((it) => {
                if (it.kind === "pen" && it.points)
                  return (
                    <polyline
                      key={it.id}
                      data-wb-id={it.id}
                      className={`wb-stroke ${sel.includes(it.id) ? "is-sel" : ""}`}
                      points={it.points.map((p) => p.join(",")).join(" ")}
                      stroke={it.color}
                      fill="none"
                    />
                  );
                if (it.kind === "arrow") {
                  const [[ax, ay], [bx, by]] = arrowPath(it);
                  return (
                    <line
                      key={it.id}
                      data-wb-id={it.id}
                      className={`wb-arrow ${sel.includes(it.id) ? "is-sel" : ""}`}
                      x1={ax}
                      y1={ay}
                      x2={bx}
                      y2={by}
                      stroke={it.color}
                      markerEnd={`url(#wb-head-${node.attrs.bid ?? "x"})`}
                    />
                  );
                }
                return null;
              })}
            </svg>
            {items.map((it) => {
              if (it.kind === "pen" || it.kind === "arrow") return null;
              const isSel = sel.includes(it.id);
              const style = { left: it.x, top: it.y, width: it.w, height: it.h, ["--wb-color" as string]: it.color };
              const text =
                editingId === it.id && editable ? (
                  <textarea
                    className="wb-text-edit bidi"
                    dir="auto"
                    autoFocus
                    ref={(el) => {
                      if (el && document.activeElement !== el) requestAnimationFrame(() => el.focus());
                    }}
                    value={it.text ?? ""}
                    onChange={(e) => setText(it.id, e.target.value)}
                    onBlur={() => {
                      setEditingId(null);
                      save(items);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
                      e.stopPropagation();
                    }}
                  />
                ) : (
                  <span className="wb-text bidi" dir="auto">
                    {it.text}
                  </span>
                );
              return (
                <div
                  key={it.id}
                  data-wb-id={it.id}
                  className={`wb-item wb-${it.kind} ${isSel ? "is-sel" : ""}`}
                  style={style}
                  onDoubleClick={() => {
                    if (it.kind === "page" && it.pageId) useStore.getState().openPage(it.pageId);
                    else if (editable && it.kind !== "image") setEditingId(it.id);
                  }}
                >
                  {it.kind === "image" && it.attachmentId ? <img src={fileUrl(it.attachmentId)} alt="" draggable={false} /> : null}
                  {it.kind === "page" && it.pageId ? (
                    <span className="wb-page">
                      <PageIcon icon={pages[it.pageId]?.icon} size={16} />
                      <span className="bidi">{pages[it.pageId] ? pageTitle(pages[it.pageId]) : tr("Missing page")}</span>
                    </span>
                  ) : null}
                  {(it.kind === "sticky" || it.kind === "text" || it.kind === "rect" || it.kind === "ellipse") && text}
                  {isSel && sel.length === 1 && editable && (
                    <span
                      className="wb-handle"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        board.current?.setPointerCapture(e.pointerId);
                        const [x, y] = toBoard(e.clientX, e.clientY);
                        drag.current = { mode: "resize", sx: x, sy: y, ox: it.w, oy: it.h, start: items, id: it.id };
                      }}
                    />
                  )}
                </div>
              );
            })}
            {marquee && <div className="wb-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
          </div>
          {!items.length && <div className="wb-empty">{editable ? tr("Pick a tool, then click the board. Double-click a note to write in it.") : tr("Empty board")}</div>}
        </div>
        {editable && (
          <div className="wb-toolbar" role="toolbar" aria-label={tr("Whiteboard tools")}>
            {TOOLS.map((t) => (
              <button key={t.id} className={`wb-tool ${tool === t.id ? "is-on" : ""}`} aria-pressed={tool === t.id} data-tip={`${tr(t.label)}  ${t.key.toUpperCase()}`} aria-label={tr(t.label)} onClick={() => setTool(t.id)}>
                <Icon name={t.icon} size={16} />
              </button>
            ))}
            <span className="wb-sep" />
            <button className="wb-tool" data-tip={tr("Picture")} aria-label={tr("Picture")} onClick={addPicture}>
              <Icon name="image" size={16} />
            </button>
            <button className="wb-tool" data-tip={tr("Page")} aria-label={tr("Page")} onClick={(e) => addPage(e.currentTarget)}>
              <Icon name="page" size={16} />
            </button>
            <span className="wb-sep" />
            {(tool === "sticky" ? STICKY_COLORS : INK_COLORS).map((c) => (
              <button
                key={c}
                className={`wb-swatch ${(tool === "sticky" ? color : ink) === c ? "is-on" : ""}`}
                style={{ background: c === "currentColor" ? "var(--text-1)" : c }}
                aria-label={tr("Colour")}
                onClick={() => {
                  if (tool === "sticky") setColor(c);
                  else setInk(c);
                  if (sel.length) {
                    const next = items.map((it) => (sel.includes(it.id) ? { ...it, color: c } : it));
                    setItems(next);
                    save(next);
                  }
                }}
              />
            ))}
            <span className="wb-sep" />
            {sel.length > 0 && (
              <button className="wb-tool" data-tip={tr("Delete")} aria-label={tr("Delete")} onClick={removeSelected}>
                <Icon name="delete" size={16} />
              </button>
            )}
            <button className="wb-tool" data-tip={full ? tr("Back to the page") : tr("Full screen")} aria-label={full ? tr("Back to the page") : tr("Full screen")} onClick={() => setFull(!full)}>
              <Icon name={full ? "minimize" : "expand"} size={16} />
            </button>
          </div>
        )}
        <div className="wb-zoom">
          <button aria-label={tr("Zoom out")} onClick={() => setView({ ...view, zoom: Math.max(0.25, view.zoom / 1.2) })}>
            −
          </button>
          <button aria-label={tr("Reset zoom")} onClick={() => setView({ x: 0, y: 0, zoom: 1 })}>
            {Math.round(view.zoom * 100)}%
          </button>
          <button aria-label={tr("Zoom in")} onClick={() => setView({ ...view, zoom: Math.min(3, view.zoom * 1.2) })}>
            +
          </button>
        </div>
      </div>
      {editable && !full && (
        <div
          className="wb-resize"
          onPointerDown={(e) => {
            const startY = e.clientY;
            const startH = attrs.height;
            const move = (ev: PointerEvent) => updateAttributes({ height: Math.max(240, Math.min(1400, startH + ev.clientY - startY)) });
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
        />
      )}
    </NodeViewWrapper>
  );
}
