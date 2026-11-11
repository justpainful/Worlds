import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { Automation, PageMeta } from "../lib/types";
import { useStore, pageTitle } from "../state/store";
import { emit } from "../lib/bus";
import { describeDestination, describeTrigger } from "../lib/automationText";
import { Segmented } from "../ui/Segmented";
import { GlassButton } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { EmptyState, PageIcon, relTime } from "../ui/misc";
import { useMenu } from "../ui/Menu";
import { pageMenu } from "../shell/pageActions";
import { LAYER } from "../glass/profiles";
import { Tonal } from "../ui/tonal/Tonal";
import { GlassBackdrop } from "../profile/GlassBackdrop";
import { isResource } from "../resources/kinds";
import { newResourceMenu } from "../resources/create";
import { PACKS_ASKED_KEY, setPackEnabled, usePack } from "../packs/packs";
import { formatTime, occurrences, tasksFor, today } from "../planning/model";
import { createItem } from "../planning/actions";
import { ItemRow, QuickAdd } from "../planning/ui";
import { StudyHomeSection } from "../study/StudyViews";
import { loadSample } from "../demo/sampleActions";

type View = "grid" | "list";

export function HomeView() {
  const pages = useStore((s) => s.pages);
  const setPalette = useStore((s) => s.setPalette);
  const open = useStore((s) => s.open);
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const view = (settings["home.view"] as View) ?? "grid";
  const study = usePack("study");
  const now = today();
  const dueTasks = useMemo(() => tasksFor(pages, "today", now).slice(0, 6), [pages, now]);
  const todayEvents = useMemo(() => occurrences(pages, now, now).filter((o) => o.kind === "event").slice(0, 4), [pages, now]);
  const [autos, setAutos] = useState<Automation[]>([]);
  const [loadingSample, setLoadingSample] = useState(false);
  const sample = () => {
    setLoadingSample(true);
    loadSample().finally(() => setLoadingSample(false));
  };

  useEffect(() => {
    const load = () => api.automations().then(setAutos).catch(() => {});
    load();
    window.addEventListener("worlds:changed", load);
    return () => window.removeEventListener("worlds:changed", load);
  }, []);

  const all = useMemo(() => Object.values(pages).filter((p) => isResource(p) && !p.deletedAt && !p.archived), [pages]);
  const templates = useMemo(
    () => Object.values(pages).filter((p) => p.kind === "template" && !p.deletedAt).sort((a, b) => a.sortKey - b.sortKey),
    [pages],
  );
  const pinned = useMemo(() => all.filter((p) => p.pinned).sort((a, b) => (a.pinOrder ?? 0) - (b.pinOrder ?? 0)), [all]);
  const recent = useMemo(
    () => [...all].sort((a, b) => (b.openedAt ?? b.updatedAt) - (a.openedAt ?? a.updatedAt)).slice(0, 12),
    [all],
  );
  // Suggested: favourites and recently edited pages you have not opened lately.
  const suggested = useMemo(() => {
    const recentIds = new Set(recent.slice(0, 4).map((p) => p.id));
    return all
      .filter((p) => !recentIds.has(p.id) && !p.pinned && (p.favorite || p.updatedAt > (p.openedAt ?? 0)))
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt)
      .slice(0, 4);
  }, [all, recent]);
  const soon = useMemo(
    () =>
      autos
        .filter((a) => a.enabled && a.nextRunAt && a.nextRunAt - Date.now() < 7 * 86_400_000)
        .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))
        .slice(0, 4),
    [autos],
  );

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  })();

  if (all.length === 0) {
    return (
      <div className="home home-empty">
        <GlassBackdrop />
        <div className="home-hero">
          <h1 className="home-title">{greeting}</h1>
          <p className="home-sub">Start with a blank page, pick a template, or look around a sample workspace.</p>
          <div className="home-hero-actions">
            <GlassButton icon="add" prominent size="large" onClick={(e) => newResourceMenu(e.currentTarget)} layer={LAYER.floating}>
              New
            </GlassButton>
            <GlassButton icon="folderOpen" size="large" disabled={loadingSample} onClick={sample} layer={LAYER.floating}>
              Load sample workspace
            </GlassButton>
          </div>
          <p className="home-sample-note">A student's week in Arabic and English: pages, a document, a spreadsheet, a drawing, slides, subjects and tasks. It stays on this device, and you can remove it anytime in Settings.</p>
        </div>
        <TemplateRow templates={templates} />
      </div>
    );
  }

  return (
    <div className="home">
      <GlassBackdrop />
      <div className="home-top">
        <h1 className="home-title">{greeting}</h1>
        <div className="home-controls" data-tonal-group>
          <Tonal
            as="button"
            interactive
            className="sf-piece"
            radius="var(--r-capsule)"
            onClick={() => setPalette(true, "pages")}
            aria-label="Search pages"
          >
            <span className="sf-piece-row">
              <Icon name="search" size={15} className="sf-glass" />
              <span className="sf-piece-text">Search</span>
              <kbd className="sf-kbd">Ctrl K</kbd>
            </span>
          </Tonal>
          <Segmented
            value={view}
            onChange={(v) => setSetting("home.view", v)}
            label="Layout"
            size="standard"
            options={[
              { value: "grid", icon: "grid" },
              { value: "list", icon: "listView" },
            ]}
          />
          <GlassButton icon="add" prominent onClick={(e) => newResourceMenu(e.currentTarget, { align: "end" })}>New</GlassButton>
        </div>
      </div>

      {!settings[PACKS_ASKED_KEY] && <PackPrompt />}
      <HomeSection title="Today" action={<button className="link-btn" onClick={() => open({ kind: "tasks" })}>All tasks</button>}>
        <QuickAdd placeholder="Add a task for today" onAdd={(p) => createItem("task", { title: p.title, data: { due: p.due ?? now, time: p.time, priority: p.priority } })} />
        {todayEvents.length > 0 && <div className="home-events">{todayEvents.map((o) => <button key={o.key} className="soon-row" onClick={() => open({ kind: "page", pageId: o.page.id })}><span className="soon-time"><span className="soon-hour">{o.start ? formatTime(o.start) : "All day"}</span></span><span className="soon-main"><span className="bidi">{pageTitle(o.page)}</span></span></button>)}</div>}
        {dueTasks.length > 0 && <div className="pl-list">{dueTasks.map((p) => <ItemRow key={p.id} p={p} />)}</div>}
      </HomeSection>
      {study && <HomeSection title="Study" action={<button className="link-btn" onClick={() => open({ kind: "study" })}>All subjects</button>}><StudyHomeSection /></HomeSection>}
      {suggested.length > 0 && (
        <HomeSection title="Suggested">
          <PageCollection pages={suggested} view={view} />
        </HomeSection>
      )}

      <HomeSection title="Pinned">
        {pinned.length ? (
          <PageCollection pages={pinned} view={view} />
        ) : (
          <EmptyState compact icon="pin" title="No pinned pages" text="Pin pages you return to often. They stay at the top of the sidebar too." />
        )}
      </HomeSection>

      <HomeSection title="Recent">
        {recent.length ? <PageCollection pages={recent} view={view} /> : <EmptyState compact icon="clock" title="No recent pages" />}
      </HomeSection>

      <HomeSection title="Scheduled soon" action={<button className="link-btn" onClick={() => open({ kind: "automations" })}>All automations</button>}>
        {soon.length === 0 ? (
          <EmptyState compact icon="schedule" title="No scheduled runs" text="Nothing is due this week." action={<button className="chip-btn" onClick={() => emit("automation:new", { pageId: null })}>Create automation</button>} />
        ) : (
          <div className="soon-list">
            {soon.map((a) => (
              <button key={a.id} className="soon-row" onClick={() => open({ kind: "automations", automationId: a.id })}>
                <span className="soon-time">
                  <span className="soon-day">{new Date(a.nextRunAt!).toLocaleDateString(undefined, { weekday: "short" })}</span>
                  <span className="soon-hour">{new Date(a.nextRunAt!).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
                </span>
                <span className="soon-main">
                  <span className="bidi">{a.name}</span>
                  <span className="soon-sub">{describeTrigger(a.spec.trigger)} · <bdi>{describeDestination(a.spec.destination)}</bdi></span>
                </span>
                <span className="soon-rel">{relTime(a.nextRunAt)}</span>
              </button>
            ))}
          </div>
        )}
      </HomeSection>

      <TemplateRow templates={templates} />
    </div>
  );
}

function PackPrompt() {
  const setSetting = useStore((s) => s.setSetting);
  const open = useStore((s) => s.open);
  const done = (study: boolean) => { setSetting(PACKS_ASKED_KEY, true); if (study) { setPackEnabled("study", true); open({ kind: "study" }); } };
  return (
    <div className="res-card pack-prompt">
      <div className="pack-prompt-text"><strong>Do you use Worlds for school or university?</strong><span>Turn on the Study pack for subjects, a class timetable, assignments and exams. Otherwise it stays out of the way. You can change this anytime in Settings → Packs.</span></div>
      <div className="pack-prompt-actions"><button className="btn btn-quiet btn-compact" onClick={() => done(false)}>No, keep it simple</button><button className="btn btn-tinted btn-compact" onClick={() => done(true)}>Turn on Study</button></div>
    </div>
  );
}
function HomeSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="home-section">
      <header className="home-section-head">
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function TemplateRow({ templates }: { templates: PageMeta[] }) {
  const open = useStore((s) => s.open);
  const openPage = useStore((s) => s.openPage);
  const refresh = useStore((s) => s.refreshPages);
  if (!templates.length) {
    return (
      <HomeSection title="Templates">
        <EmptyState compact icon="template" title="No templates" text="Save any page as a template from its menu." />
      </HomeSection>
    );
  }
  return (
    <HomeSection title="Templates" action={<button className="link-btn" onClick={() => open({ kind: "templates" })}>All templates</button>}>
      <div className="tpl-strip">
        {templates.slice(0, 6).map((t) => (
          <button
            key={t.id}
            className="tpl-chip"
            onClick={async () => {
              const p = await api.instantiate(t.id);
              await refresh();
              openPage(p.id);
            }}
          >
            <span className="tpl-chip-icon">{t.icon ?? "📄"}</span>
            <span className="bidi">{t.title.replace("{{date}}", "").trim()}</span>
          </button>
        ))}
      </div>
    </HomeSection>
  );
}

export function PageCollection({ pages, view }: { pages: PageMeta[]; view: View }) {
  const openPage = useStore((s) => s.openPage);
  const all = useStore((s) => s.pages);
  const show = useMenu((s) => s.show);
  if (view === "list") {
    return (
      <div className="page-list">
        {pages.map((p) => (
          <button
            key={p.id}
            className="page-row"
            onClick={(e) => openPage(p.id, e.ctrlKey ? "tab" : e.altKey ? "right" : "current")}
            onContextMenu={(e) => {
              e.preventDefault();
              show(e.clientX, e.clientY, pageMenu(p));
            }}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("application/x-worlds-page", p.id)}
          >
            <PageIcon icon={p.icon} size={16} />
            <span className="page-row-title bidi">{pageTitle(p)}</span>
            {p.parentId && <span className="page-row-parent bidi">{pageTitle(all[p.parentId])}</span>}
            <span className="page-row-time">{relTime(p.updatedAt)}</span>
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="page-grid">
      {pages.map((p) => (
        <button
          key={p.id}
          className="page-card"
          onClick={(e) => openPage(p.id, e.ctrlKey ? "tab" : e.altKey ? "right" : "current")}
          onContextMenu={(e) => {
            e.preventDefault();
            show(e.clientX, e.clientY, pageMenu(p));
          }}
          draggable
          onDragStart={(e) => e.dataTransfer.setData("application/x-worlds-page", p.id)}
        >
          <div className="page-card-top">
            <PageIcon icon={p.icon} size={20} />
            {p.pinned && <Icon name="pin" size={12} className="page-card-pin" />}
          </div>
          <div className="page-card-title bidi">{pageTitle(p)}</div>
          <div className={`page-card-preview bidi ${p.preview ? "" : "is-empty"}`}>{p.preview || "Empty page"}</div>
          <div className="page-card-meta">
            {p.parentId && <span className="bidi">{pageTitle(all[p.parentId])}</span>}
            <span>{relTime(p.updatedAt)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
