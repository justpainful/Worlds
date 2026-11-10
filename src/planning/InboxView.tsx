/** Inbox: catch a thought now, decide what it is later. Plus the Quick Capture sheet. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "../lib/api";
import type { PageMeta } from "../lib/types";
import { pageTitle, useStore } from "../state/store";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { menuAt, type MenuItem } from "../ui/Menu";
import { Modal } from "../ui/Modal";
import { EmptyState, relTime } from "../ui/misc";
import { isKindHidden } from "../packs/registry";
import { convertCapture, createItem, trashItem } from "./actions";
import { liveOfKind, today } from "./model";
import { parseQuickAdd } from "./quickAdd";
import { containers } from "./ui";

export function InboxView() {
  const pages = useStore((s) => s.pages);
  const items = liveOfKind(pages, "inbox").sort((a, b) => b.createdAt - a.createdAt);
  const [text, setText] = useState("");

  const capture = async () => {
    const t = text.trim();
    if (!t) return;
    await createItem("inbox", { title: t });
    setText("");
  };

  return (
    <div className="pl-view">
      <header className="pl-head">
        <div>
          <h1 className="pl-title">Inbox</h1>
          <p className="pl-sub">{items.length ? `${items.length} to sort` : "Nothing waiting"} · Ctrl+Alt+N captures from anywhere in Worlds</p>
        </div>
      </header>

      <div className="pl-add">
        <Icon name="inbox" size={16} />
        <input className="pl-add-input bidi" dir="auto" autoFocus placeholder="Write it down before you forget it" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && capture()} />
      </div>

      {items.length === 0 ? (
        <EmptyState icon="inbox" title="Inbox zero" text="Anything you capture lands here first. Turn each one into a task, an event or a page when you have a minute." />
      ) : (
        <div className="pl-list inbox-list">
          {items.map((p) => (
            <InboxRow key={p.id} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function InboxRow({ p }: { p: PageMeta }) {
  const openPage = useStore((s) => s.openPage);
  const study = !isKindHidden("assignment");

  const toTask = async () => {
    const q = parseQuickAdd(p.title);
    await convertCapture({ ...p, title: q.title || p.title }, "task", { due: q.due, time: q.time, priority: q.priority });
    useStore.getState().toast({ message: "Added to Tasks", tone: "success" });
  };
  const toEvent = async () => {
    const q = parseQuickAdd(p.title);
    const made = await convertCapture({ ...p, title: q.title || p.title }, "event", { date: q.due ?? today(), start: q.time, allDay: !q.time });
    if (made) openPage(made.id);
  };
  const toPage = async () => {
    const s = useStore.getState();
    const made = await s.createPage({ title: p.title }, "current");
    if (made) {
      await api.deletePage(p.id);
      await api.purgePage(p.id);
      const pages = { ...useStore.getState().pages };
      delete pages[p.id];
      useStore.setState({ pages });
    }
  };

  const more = (el: HTMLElement) => {
    const pages = useStore.getState().pages;
    const items: MenuItem[] = [];
    if (study) {
      const subs = containers(pages).filter((c) => c.kind === "subject");
      items.push(
        { kind: "label", label: "Study" },
        {
          label: "Assignment in…",
          icon: "edit",
          submenu: subs.length
            ? subs.map((s) => ({ label: pageTitle(s), onSelect: () => convertCapture(p, "assignment", { due: parseQuickAdd(p.title).due }, s.id) }))
            : [{ label: "Add a subject first", disabled: true }],
        },
        {
          label: "Something to bring in…",
          icon: "file",
          submenu: subs.length ? subs.map((s) => ({ label: pageTitle(s), onSelect: () => convertCapture(p, "requirement", { due: parseQuickAdd(p.title).due }, s.id) })) : [{ label: "Add a subject first", disabled: true }],
        },
        { kind: "separator" },
      );
    }
    items.push({ label: "Delete", icon: "delete", danger: true, onSelect: () => trashItem(p) });
    menuAt(el, items, "end");
  };

  return (
    <div className="pl-row inbox-row">
      <span className="pl-check-slot"><Icon name="inbox" size={15} /></span>
      <div className="pl-row-main">
        <span className="pl-row-title bidi">{p.title || "Empty capture"}</span>
        <span className="pl-row-meta"><span className="pl-meta">{relTime(p.createdAt)}</span></span>
      </div>
      <div className="inbox-actions">
        <Button size="compact" variant="quiet" icon="checklist" onClick={toTask}>Task</Button>
        <Button size="compact" variant="quiet" icon="calendar" onClick={toEvent}>Event</Button>
        <Button size="compact" variant="quiet" icon="page" onClick={toPage}>Page</Button>
        <Button size="compact" variant="quiet" icon="more" aria-label="More" onClick={(e) => more(e.currentTarget)} />
      </div>
    </div>
  );
}

let captureOpen = false;

/** A small sheet that catches one thought into the Inbox, wherever you are. */
export function openQuickCapture() {
  if (captureOpen) return;
  captureOpen = true;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => {
    captureOpen = false;
    root.unmount();
    host.remove();
  };
  root.render(<QuickCapture onClose={close} />);
}

function QuickCapture({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [asTask, setAsTask] = useState(false);
  const save = async () => {
    const t = text.trim();
    if (!t) return onClose();
    if (asTask) {
      const q = parseQuickAdd(t);
      await createItem("task", { title: q.title || t, data: { due: q.due, time: q.time, priority: q.priority } });
    } else await createItem("inbox", { title: t });
    useStore.getState().toast({ message: asTask ? "Added to Tasks" : "Saved to Inbox", tone: "success", action: { label: "Open", run: () => useStore.getState().open(asTask ? { kind: "tasks" } : { kind: "inbox" }) } });
    onClose();
  };
  return (
    <Modal
      title="Quick capture"
      width={520}
      onClose={onClose}
      footer={
        <>
          <label className="qc-toggle">
            <input type="checkbox" checked={asTask} onChange={(e) => setAsTask(e.target.checked)} /> Save as a task
          </label>
          <button className="btn btn-quiet btn-standard" onClick={onClose}>Cancel</button>
          <button className="btn btn-tinted btn-standard" onClick={save} disabled={!text.trim()}>Save</button>
        </>
      }
    >
      <textarea
        className="field qc-text bidi"
        dir="auto"
        autoFocus
        rows={3}
        placeholder={asTask ? "What needs doing? “tomorrow 4pm” sets the date" : "Anything. Sort it out later in Inbox."}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            save();
          }
        }}
      />
    </Modal>
  );
}
