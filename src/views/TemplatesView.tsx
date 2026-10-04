import { useMemo } from "react";
import { api, errorMessage } from "../lib/api";
import type { PageMeta } from "../lib/types";
import { useStore } from "../state/store";
import { GlassButton } from "../ui/Button";
import { EmptyState } from "../ui/misc";
import { useMenu, type MenuItem } from "../ui/Menu";
import { confirmDialog } from "../ui/Modal";
import { Icon } from "../ui/Icon";

export function TemplatesView() {
  const pages = useStore((s) => s.pages);
  const templates = useMemo(() => Object.values(pages).filter((p) => p.kind === "template" && !p.deletedAt && !p.parentId), [pages]);
  const groups = useMemo(() => {
    const m = new Map<string, PageMeta[]>();
    for (const t of templates.sort((a, b) => a.sortKey - b.sortKey)) {
      const c = t.templateCategory || "Other";
      m.set(c, [...(m.get(c) ?? []), t]);
    }
    return [...m.entries()].sort(([a], [b]) => (a === "Custom" ? -1 : b === "Custom" ? 1 : a.localeCompare(b)));
  }, [templates]);

  const newTemplate = async () => {
    const s = useStore.getState();
    try {
      const t = await api.createPage({ title: "", kind: "template" });
      await api.updatePage(t.id, { templateCategory: "Custom" });
      await s.refreshPages();
      s.openPage(t.id);
    } catch (e) {
      s.toast({ message: errorMessage(e), tone: "error" });
    }
  };

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1 className="view-title">Templates</h1>
          <p className="view-sub">Templates create real, structured pages you can keep editing.</p>
        </div>
        <GlassButton icon="add" onClick={newTemplate}>New Template</GlassButton>
      </header>
      {templates.length === 0 ? (
        <EmptyState icon="template" title="No templates" text="Save any page as a template from its menu, or create one here." action={<button className="btn btn-tinted btn-standard" onClick={newTemplate}>New Template</button>} />
      ) : (
        groups.map(([cat, list]) => (
          <section key={cat} className="tpl-section">
            <h2 className="section-label">{cat}</h2>
            <div className="tpl-grid">
              {list.map((t) => (
                <TemplateCard key={t.id} t={t} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function TemplateCard({ t }: { t: PageMeta }) {
  const openPage = useStore((s) => s.openPage);
  const show = useMenu((s) => s.show);
  const pages = useStore((s) => s.pages);
  const description = (() => {
    // Description lives in metadata for built-ins; fall back to the preview.
    return t.preview;
  })();
  const kids = Object.values(pages).filter((p) => p.parentId === t.id && !p.deletedAt).length;

  const use = async () => {
    const s = useStore.getState();
    try {
      const p = await api.instantiate(t.id);
      await s.refreshPages();
      s.openPage(p.id);
    } catch (e) {
      s.toast({ message: errorMessage(e), tone: "error" });
    }
  };

  const menu: MenuItem[] = [
    { label: "Use Template", icon: "add", onSelect: use },
    { label: "Edit Template", icon: "edit", onSelect: () => openPage(t.id) },
    {
      label: "Duplicate",
      icon: "duplicate",
      onSelect: async () => {
        await api.duplicatePage(t.id);
        useStore.getState().refreshPages();
      },
    },
    { kind: "separator" },
    {
      label: "Delete Template",
      icon: "delete",
      danger: true,
      onSelect: async () => {
        if (await confirmDialog({ title: "Delete template?", message: `“${t.title}” moves to Trash. Pages already created from it are not affected.`, confirm: "Delete", danger: true })) {
          await api.deletePage(t.id);
          useStore.getState().refreshPages();
        }
      },
    },
  ];

  return (
    <div
      className="tpl-card"
      onContextMenu={(e) => {
        e.preventDefault();
        show(e.clientX, e.clientY, menu);
      }}
    >
      <div className="tpl-card-head">
        <span className="tpl-card-icon">{t.icon ?? "📄"}</span>
        <button className="tpl-card-more" aria-label="More" onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          show(r.right - 200, r.bottom + 4, menu);
        }}>
          <Icon name="more" size={15} />
        </button>
      </div>
      <div className="tpl-card-title bidi">{t.title.replace("{{date}}", "").trim() || "Untitled template"}</div>
      <div className="tpl-card-desc bidi">{description || "Empty template"}</div>
      <div className="tpl-card-foot">
        {kids > 0 && <span className="tag">{kids} subpage{kids === 1 ? "" : "s"}</span>}
        <span className="grow" />
        <button className="chip-btn" onClick={() => openPage(t.id)}>Edit</button>
        <button className="chip-btn is-accent" onClick={use}>Use</button>
      </div>
    </div>
  );
}
