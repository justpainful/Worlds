import { useMemo, useState } from "react";
import { api, errorMessage } from "../lib/api";
import type { PageMeta } from "../lib/types";
import { useStore } from "../state/store";
import { GlassButton } from "../ui/Button";
import { EmptyState } from "../ui/misc";
import { useMenu, type MenuItem } from "../ui/Menu";
import { confirmDialog } from "../ui/Modal";
import { Icon } from "../ui/Icon";
import { VISUAL_MINDMAP_PRESETS, createVisualMindMap, presetText, type VisualCanvasPreset } from "../drawing/mindMapTemplates";
import { resolveUiLanguage } from "../i18n/ui";
import { pageFromTemplate, templateDescription, templateName } from "../templates/fromTemplate";

const CATEGORY_ORDER: Record<string, number> = {
  Custom: 0,
  "Mind Maps & Concepts": 1,
  Personal: 2,
  Work: 3,
  Product: 4,
  Discord: 5,
};

export function TemplatesView() {
  const pages = useStore((s) => s.pages);
  const [filter, setFilter] = useState<string>("All");
  const templates = useMemo(
    () => Object.values(pages).filter((p) => p.kind === "template" && !p.deletedAt && !p.parentId),
    [pages],
  );
  const groups = useMemo(() => {
    const m = new Map<string, PageMeta[]>();
    for (const t of [...templates].sort((a, b) => a.sortKey - b.sortKey)) {
      const c = t.templateCategory || "Other";
      m.set(c, [...(m.get(c) ?? []), t]);
    }
    return [...m.entries()].sort(([a], [b]) => {
      const oa = CATEGORY_ORDER[a] ?? 99;
      const ob = CATEGORY_ORDER[b] ?? 99;
      return oa !== ob ? oa - ob : a.localeCompare(b);
    });
  }, [templates]);

  const categories = useMemo(
    () => ["All", "Visual Canvases", ...groups.map(([cat]) => cat)],
    [groups],
  );

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

  const showVisualCanvases = filter === "All" || filter === "Visual Canvases" || filter === "Mind Maps & Concepts";
  const visibleGroups = useMemo(
    () => (filter === "All" ? groups : filter === "Visual Canvases" ? [] : groups.filter(([cat]) => cat === filter)),
    [groups, filter],
  );

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1 className="view-title">Templates</h1>
          <p className="view-sub">
            Structured page templates, interactive Mermaid mind maps, and visual drawing canvases.
          </p>
        </div>
        <GlassButton icon="add" onClick={newTemplate}>New Template</GlassButton>
      </header>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
        {categories.map((cat) => (
          <button
            key={cat}
            className={`chip-btn ${filter === cat ? "is-accent" : ""}`}
            onClick={() => setFilter(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {showVisualCanvases && (
        <section className="tpl-section">
          <h2 className="section-label">Visual mind maps and concept canvases</h2>
          <div className="tpl-grid">
            {VISUAL_MINDMAP_PRESETS.map((preset) => (
              <VisualPresetCard key={preset.key} preset={preset} />
            ))}
          </div>
        </section>
      )}

      {templates.length === 0 && !showVisualCanvases ? (
        <EmptyState
          icon="template"
          title="No templates"
          text="Save any page as a template from its menu, or create one here."
          action={<button className="btn btn-tinted btn-standard" onClick={newTemplate}>New Template</button>}
        />
      ) : (
        visibleGroups.map(([cat, list]) => (
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

function VisualPresetCard({ preset }: { preset: VisualCanvasPreset }) {
  const [busy, setBusy] = useState(false);
  const lang = useStore((s) => resolveUiLanguage(s.profile?.language));
  const create = async () => {
    if (busy) return;
    setBusy(true);
    const s = useStore.getState();
    try {
      const id = await createVisualMindMap(preset, lang);
      await s.refreshPages();
      s.openPage(id);
    } catch (e) {
      s.toast({ message: errorMessage(e), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tpl-card">
      <div className="tpl-card-head">
        <span className="tpl-card-icon">{preset.icon}</span>
        <span className="tag">{preset.badge}</span>
      </div>
      <div className="tpl-card-title bidi">{presetText(preset, "title", lang)}</div>
      <div className="tpl-card-desc bidi">{presetText(preset, "description", lang)}</div>
      <div className="tpl-card-foot">
        <span className="grow" />
        <button className="chip-btn is-accent" disabled={busy} onClick={create}>
          {busy ? "Creating…" : "Create Canvas"}
        </button>
      </div>
    </div>
  );
}

function TemplateCard({ t }: { t: PageMeta }) {
  const openPage = useStore((s) => s.openPage);
  const show = useMenu((s) => s.show);
  const pages = useStore((s) => s.pages);
  const description = templateDescription(t) ?? t.preview;
  const kids = Object.values(pages).filter((p) => p.parentId === t.id && !p.deletedAt).length;

  const use = async () => {
    const s = useStore.getState();
    try {
      const p = await pageFromTemplate(t);
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
      <div className="tpl-card-title bidi">{templateName(t) || "Untitled template"}</div>
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
