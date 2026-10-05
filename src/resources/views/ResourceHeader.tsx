import { useEffect, useState, type ReactNode } from "react";
import { api, errorMessage } from "../../lib/api";
import type { Page, PageMeta } from "../../lib/types";
import { useStore } from "../../state/store";
import { pageMenu, pageOps } from "../../shell/pageActions";
import { IconButton } from "../../ui/Button";
import { EmojiPicker } from "../../ui/EmojiPicker";
import { menuAt } from "../../ui/Menu";
import { PageIcon, relTime } from "../../ui/misc";
import { KIND_INFO } from "../kinds";

/** Load a resource's full record and keep it current with external writes. */
export function useResource(id: string) {
  const [page, setPage] = useState<Page | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const external = useStore((s) => s.externalRevision[id] ?? 0);
  useEffect(() => {
    let live = true;
    api
      .page(id, true)
      .then((p) => live && setPage(p))
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [id, external]);
  return { page, setPage, error };
}

/** Write one metadata key and refresh the local copy. */
export async function saveMeta<K extends "doc" | "deck" | "project" | "gallery" | "file" | "stream">(id: string, key: K, value: unknown) {
  try {
    const meta = await api.setPageMeta(id, key, value);
    useStore.getState().patchPageLocal(meta);
    return meta;
  } catch (e) {
    useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    return null;
  }
}

/** Icon, editable title, kind and actions: the same top for every resource. */
export function ResourceHeader({ meta, actions, subtitle }: { meta: PageMeta; actions?: ReactNode; subtitle?: ReactNode }) {
  const [title, setTitle] = useState(meta.title);
  const [emoji, setEmoji] = useState<DOMRect | null>(null);
  useEffect(() => setTitle(meta.title), [meta.title]);
  const kind = meta.kind === "template" ? "page" : meta.kind;
  const commit = async () => {
    const t = title.trim();
    if (t === meta.title) return;
    try {
      useStore.getState().patchPageLocal(await api.updatePage(meta.id, { title: t }));
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    }
  };
  const setIcon = async (icon: string | null) => {
    setEmoji(null);
    useStore.getState().patchPageLocal(await api.updatePage(meta.id, { icon }));
  };
  return (
    <header className="res-head">
      <button className="res-icon" onClick={(e) => setEmoji(e.currentTarget.getBoundingClientRect())} aria-label="Change icon">
        <PageIcon icon={meta.icon} size={34} />
      </button>
      <div className="res-titles">
        <input
          className="res-title bidi"
          dir="auto"
          value={title}
          placeholder={`Untitled ${KIND_INFO[kind].label.toLowerCase()}`}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setTitle(meta.title);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <div className="res-sub">
          <span className="res-kind">{KIND_INFO[kind].label}</span>
          <span>Edited {relTime(meta.updatedAt)}</span>
          {subtitle}
        </div>
      </div>
      <div className="res-actions">
        {actions}
        <IconButton icon={meta.pinned ? "unpin" : "pin"} label={meta.pinned ? "Unpin" : "Pin"} active={meta.pinned} onClick={() => pageOps.togglePin(meta)} />
        <IconButton icon="more" label="More" onClick={(e) => menuAt(e.currentTarget, pageMenu(meta, { inPage: true }), "end")} />
      </div>
      {emoji && <EmojiPicker anchor={emoji} onPick={setIcon} onClose={() => setEmoji(null)} hasIcon={!!meta.icon} pageId={meta.id} />}
    </header>
  );
}
