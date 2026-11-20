/**
 * Three ways to have Home: the Worlds Home, a board of widgets you arrange,
 * or a Home you make yourself as an HTML page (with its own HTML, CSS, SVG
 * and scripts) that receives your workspace through `worlds.data`.
 */
import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { api, errorMessage } from "../../lib/api";
import type { PageMeta } from "../../lib/types";
import { useStore, pageTitle } from "../../state/store";
import { Icon, type IconName } from "../../ui/Icon";
import { menuAt, type MenuItem } from "../../ui/Menu";
import { PageIcon, relTime } from "../../ui/misc";
import { tr, uiLanguage } from "../../i18n/ui";
import { isResource } from "../../resources/kinds";
import { occurrences, tasksFor, today, formatTime } from "../../planning/model";
import { upcomingReminders } from "../../pages/reminders";
import { HtmlFrame } from "../../htmlpage/HtmlPageView";
import type { ProfileStats } from "../../profile/BlockView";

export type HomeMode = "worlds" | "widgets" | "custom";

export const useHomeMode = (): HomeMode => {
  const m = useStore((s) => s.settings["home.mode"]);
  return m === "widgets" || m === "custom" ? m : "worlds";
};

/** The small menu at the top of Home that switches between the three. */
export function HomeModeButton() {
  const mode = useHomeMode();
  const set = useStore((s) => s.setSetting);
  const choose = (el: HTMLElement) =>
    menuAt(
      el,
      [
        { kind: "label", label: "Home" },
        { label: "Worlds Home", icon: "home", checked: mode === "worlds", onSelect: () => set("home.mode", "worlds") },
        { label: "Widgets", icon: "widgets", checked: mode === "widgets", onSelect: () => set("home.mode", "widgets") },
        { label: "My Own Home", icon: "code", checked: mode === "custom", onSelect: () => startCustomHome() },
        ...(mode === "custom"
          ? ([
              { kind: "separator" },
              { label: "Edit My Home", icon: "edit", onSelect: () => editCustomHome() },
              { label: "Start Over from the Example", icon: "refresh", onSelect: () => startCustomHome(true) },
            ] as MenuItem[])
          : []),
      ],
      "end",
    );
  return (
    <button className="home-mode-btn" aria-label={tr("Home style")} data-tip={tr("Home style")} onClick={(e) => choose(e.currentTarget)}>
      <Icon name="widgets" size={16} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// The workspace snapshot a custom Home receives
// ---------------------------------------------------------------------------

export function homeData() {
  const s = useStore.getState();
  const all = Object.values(s.pages).filter((p) => isResource(p) && !p.deletedAt && !p.archived);
  const brief = (p: PageMeta) => ({ id: p.id, title: pageTitle(p), icon: p.icon, kind: p.kind, updatedAt: p.updatedAt });
  const now = today();
  return {
    name: s.profile?.displayName ?? "",
    language: uiLanguage(),
    theme: document.documentElement.dataset.theme ?? "dark",
    today: now,
    pinned: all.filter((p) => p.pinned).map(brief),
    recent: [...all]
      .sort((a, b) => (b.openedAt ?? b.updatedAt) - (a.openedAt ?? a.updatedAt))
      .slice(0, 20)
      .map(brief),
    tasks: tasksFor(s.pages, "today", now).map((p) => ({ ...brief(p), done: false })),
    events: occurrences(s.pages, now, now)
      .filter((o) => o.kind === "event")
      .map((o) => ({ id: o.page.id, title: pageTitle(o.page), time: o.start ?? null })),
    counts: { pages: all.length },
  };
}

const STARTER = `<!doctype html>
<html>
<head>
<style>
  /* Your Home: change anything. worlds.data has your pinned and recent pages,
     today's tasks and events; worlds.openPage(id) opens a page. */
  :root { --bg: #101014; --card: rgba(255,255,255,0.06); --ink: #f5f5f7; --dim: rgba(235,235,245,0.6); --accent: #2e92ff; }
  :root[data-theme="light"] { --bg: #f4f4f7; --card: #ffffff; --ink: #1d1d1f; --dim: #6e6e73; }
  body { margin: 0; padding: 40px 32px; background: var(--bg); color: var(--ink); min-height: 100vh; box-sizing: border-box; }
  h1 { font-size: 40px; margin: 0 0 4px; letter-spacing: -0.02em; color: var(--ink); }
  .date { color: var(--dim); margin-bottom: 28px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
  .card { background: var(--card); border-radius: 18px; padding: 16px 18px; box-shadow: 0 1px 0 rgba(255,255,255,0.04) inset; }
  .card h2 { font-size: 13px; color: var(--dim); font-weight: 600; margin: 0 0 10px; }
  a { display: block; color: var(--ink); text-decoration: none; padding: 6px 0; }
  a:hover { color: var(--accent); }
  svg { width: 44px; height: 44px; }
</style>
</head>
<body>
  <svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="20" fill="none" stroke="#2e92ff" stroke-width="3"/><path d="M12 24c4 6 16 6 20 0" stroke="#2e92ff" stroke-width="3" fill="none" stroke-linecap="round"/></svg>
  <h1 id="hello">Hello</h1>
  <div class="date" id="date"></div>
  <div class="grid">
    <div class="card"><h2 id="t-pinned">Pinned</h2><div id="pinned"></div></div>
    <div class="card"><h2 id="t-recent">Recent</h2><div id="recent"></div></div>
    <div class="card"><h2 id="t-tasks">Today</h2><div id="tasks"></div></div>
  </div>
<script>
  var ar = worlds.lang === "ar";
  if (ar) { document.getElementById("t-pinned").textContent = "المثبّت"; document.getElementById("t-recent").textContent = "الأخيرة"; document.getElementById("t-tasks").textContent = "اليوم"; }
  function list(el, items, empty) {
    el.innerHTML = "";
    if (!items.length) { el.textContent = empty; return; }
    items.slice(0, 6).forEach(function (p) {
      var a = document.createElement("a");
      a.href = "worlds://page/" + p.id;
      a.textContent = (p.icon && p.icon.length < 4 ? p.icon + " " : "") + p.title;
      el.appendChild(a);
    });
  }
  worlds.onData(function (d) {
    // Follow the Worlds theme, light or dark.
    document.documentElement.dataset.theme = d.theme;
    var h = new Date().getHours();
    var hello = ar ? (h < 12 ? "صباح الخير" : "مساء الخير") : (h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
    document.getElementById("hello").textContent = hello + (d.name ? ", " + d.name : "");
    document.getElementById("date").textContent = new Date().toLocaleDateString(ar ? "ar" : undefined, { weekday: "long", day: "numeric", month: "long" });
    list(document.getElementById("pinned"), d.pinned, ar ? "لا شيء مثبّت" : "Nothing pinned");
    list(document.getElementById("recent"), d.recent, "");
    list(document.getElementById("tasks"), d.tasks, ar ? "لا مهام اليوم" : "No tasks today");
  });
</script>
</body>
</html>`;

/** Make (or reuse) the HTML page that is this person's own Home, and switch to it. */
export async function startCustomHome(fresh = false) {
  const s = useStore.getState();
  try {
    let id = s.settings["home.custom"] as string | undefined;
    if (fresh || !id || !s.pages[id] || s.pages[id].deletedAt) {
      if (!id || !s.pages[id] || s.pages[id].deletedAt) {
        const meta = await api.createPage({ title: uiLanguage() === "ar" ? "واجهتي الرئيسية" : "My Home", kind: "html" } as never);
        id = meta.id;
      }
      const check = await api.htmlPageWrite(id, STARTER);
      if (check.errors.length) throw new Error(check.errors.join("\n"));
      s.setSetting("home.custom", id);
      await s.refreshPages();
    }
    s.setSetting("home.mode", "custom");
  } catch (e) {
    s.toast({ message: errorMessage(e), tone: "error" });
  }
}

export function editCustomHome() {
  const id = useStore.getState().settings["home.custom"] as string | undefined;
  if (id) useStore.getState().openPage(id);
}

export function CustomHome() {
  const id = useStore((s) => s.settings["home.custom"]) as string | undefined;
  const pages = useStore((s) => s.pages);
  const [page, setPage] = useState<{ source: string; state: unknown } | null>(null);
  const [rev, setRev] = useState(0);
  useEffect(() => {
    if (!id) return;
    api
      .page(id)
      .then((p) => {
        const html = (p?.metadata as { html?: { source?: string; state?: unknown } } | undefined)?.html;
        setPage({ source: html?.source ?? "", state: html?.state ?? null });
        setRev((r) => r + 1);
      })
      .catch(() => setPage(null));
  }, [id, pages[id ?? ""]?.updatedAt]);
  if (!id || !page) return null;
  return (
    <div className="home home-custom">
      <div className="home-custom-bar">
        <HomeModeButton />
      </div>
      <HtmlFrame id={id} source={page.source} state={page.state} revision={rev} home={homeData} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

type WidgetType = "today" | "recent" | "pinned" | "calendar" | "reminders" | "streak" | "quote" | "clock" | "stats";
interface Widget {
  id: string;
  type: WidgetType;
  size: "small" | "wide";
}

const WIDGETS: { type: WidgetType; label: string; icon: IconName; size: Widget["size"] }[] = [
  { type: "today", label: "Today", icon: "checklist", size: "wide" },
  { type: "recent", label: "Recent pages", icon: "history", size: "small" },
  { type: "pinned", label: "Pinned", icon: "pin", size: "small" },
  { type: "calendar", label: "Calendar", icon: "calendarDays", size: "small" },
  { type: "reminders", label: "Reminders", icon: "reminder", size: "small" },
  { type: "streak", label: "Writing streak", icon: "flame", size: "wide" },
  { type: "quote", label: "Quote", icon: "quote", size: "small" },
  { type: "clock", label: "Clock", icon: "clock", size: "small" },
  { type: "stats", label: "Your numbers", icon: "activity", size: "small" },
];

const DEFAULT_WIDGETS: Widget[] = [
  { id: "w1", type: "today", size: "wide" },
  { id: "w2", type: "clock", size: "small" },
  { id: "w3", type: "recent", size: "small" },
  { id: "w4", type: "calendar", size: "small" },
  { id: "w5", type: "pinned", size: "small" },
  { id: "w6", type: "streak", size: "wide" },
];

const QUOTES = [
  { en: "The secret of getting ahead is getting started.", ar: "سرّ التقدّم أن تبدأ." },
  { en: "Small steps every day.", ar: "خطوات صغيرة كل يوم." },
  { en: "Write it down, then make it happen.", ar: "اكتبها، ثم حقّقها." },
  { en: "Done is better than perfect.", ar: "المنجَز أفضل من الكامل." },
  { en: "Focus on what matters today.", ar: "ركّز على ما يهم اليوم." },
];

function useStats() {
  const [stats, setStats] = useState<ProfileStats | null>(null);
  useEffect(() => {
    api.profileStats().then(setStats).catch(() => setStats(null));
  }, []);
  return stats;
}

/** Days in a row with edits, and the longest such run in the last 90 days. */
export function streaks(days: { date: string; count: number }[]) {
  const set = new Set(days.filter((d) => d.count > 0).map((d) => d.date));
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  let current = 0;
  const d = new Date();
  if (!set.has(iso(d))) d.setDate(d.getDate() - 1);
  while (set.has(iso(d))) {
    current++;
    d.setDate(d.getDate() - 1);
  }
  let longest = 0;
  let run = 0;
  const start = new Date();
  start.setDate(start.getDate() - 90);
  for (let i = 0; i <= 90; i++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (set.has(iso(day))) longest = Math.max(longest, ++run);
    else run = 0;
  }
  return { current, longest };
}

function WidgetBody({ w }: { w: Widget }): ReactNode {
  const pages = useStore((s) => s.pages);
  const open = (id: string) => useStore.getState().openPage(id);
  const all = useMemo(() => Object.values(pages).filter((p) => isResource(p) && !p.deletedAt && !p.archived), [pages]);
  const stats = useStats();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (w.type !== "clock") return;
    const t = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(t);
  }, [w.type]);
  const ar = uiLanguage() === "ar";
  const row = (p: PageMeta, extra?: ReactNode) => (
    <button key={p.id} className="wg-row" onClick={() => open(p.id)}>
      <PageIcon icon={p.icon} size={15} />
      <span className="bidi">{pageTitle(p)}</span>
      {extra}
    </button>
  );
  switch (w.type) {
    case "today": {
      const d = today();
      const tasks = tasksFor(pages, "today", d).slice(0, 6);
      const events = occurrences(pages, d, d).filter((o) => o.kind === "event").slice(0, 4);
      if (!tasks.length && !events.length) return <p className="wg-empty">{tr("Nothing planned for today.")}</p>;
      return (
        <>
          {events.map((o) => (
            <button key={o.key} className="wg-row" onClick={() => open(o.page.id)}>
              <span className="wg-time">{o.start ? formatTime(o.start) : tr("All day")}</span>
              <span className="bidi">{pageTitle(o.page)}</span>
            </button>
          ))}
          {tasks.map((p) => row(p))}
        </>
      );
    }
    case "recent":
      return [...all]
        .sort((a, b) => (b.openedAt ?? b.updatedAt) - (a.openedAt ?? a.updatedAt))
        .slice(0, 6)
        .map((p) => row(p, <span className="wg-dim">{relTime(p.openedAt ?? p.updatedAt)}</span>));
    case "pinned": {
      const list = all.filter((p) => p.pinned).slice(0, 6);
      return list.length ? list.map((p) => row(p)) : <p className="wg-empty">{tr("Pin pages to keep them here.")}</p>;
    }
    case "reminders": {
      const list = upcomingReminders(pages, 6);
      return list.length ? (
        list.map((r) => (
          <button key={r.key} className="wg-row" onClick={() => open(r.page.id)}>
            <Icon name="reminder" size={13} />
            <span className="bidi">{pageTitle(r.page)}</span>
            <span className="wg-dim">{new Date(r.at).toLocaleString(ar ? "ar" : undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>
          </button>
        ))
      ) : (
        <p className="wg-empty">{tr("Set a reminder on a date property to see it here.")}</p>
      );
    }
    case "calendar": {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const startDay = ar ? 6 : 0;
      const lead = (first.getDay() - startDay + 7) % 7;
      const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const dated = new Set(
        occurrences(pages, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${days}`).map((o) => o.date),
      );
      return (
        <div className="wg-cal">
          <div className="wg-cal-title">{now.toLocaleDateString(ar ? "ar" : undefined, { month: "long", year: "numeric" })}</div>
          <div className="wg-cal-grid">
            {Array.from({ length: lead }, (_, i) => (
              <span key={`l${i}`} />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const day = i + 1;
              const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              return (
                <span key={day} className={`${day === now.getDate() ? "is-today" : ""} ${dated.has(key) ? "has-items" : ""}`}>
                  {day}
                </span>
              );
            })}
          </div>
        </div>
      );
    }
    case "streak": {
      if (!stats) return <p className="wg-empty">{tr("Loading")}</p>;
      const { current, longest } = streaks(stats.activeDays ?? []);
      const map = new Map((stats.activeDays ?? []).map((d) => [d.date, d.count]));
      const cells = Array.from({ length: 84 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (83 - i));
        const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const c = map.get(k) ?? 0;
        return <span key={k} className={`wg-heat l${c === 0 ? 0 : c < 3 ? 1 : c < 8 ? 2 : 3}`} data-tip={`${k}: ${c}`} />;
      });
      return (
        <div className="wg-streak">
          <div className="wg-streak-nums">
            <div>
              <b>{current}</b>
              <span>{tr("days in a row")}</span>
            </div>
            <div>
              <b>{longest}</b>
              <span>{tr("longest run")}</span>
            </div>
            <div>
              <b>{stats.words ?? stats.edits7d}</b>
              <span>{stats.words != null ? tr("words") : tr("edits this week")}</span>
            </div>
          </div>
          <div className="wg-heatmap">{cells}</div>
        </div>
      );
    }
    case "quote": {
      const q = QUOTES[Math.floor(Date.now() / 86400000) % QUOTES.length];
      return <p className="wg-quote bidi">{ar ? q.ar : q.en}</p>;
    }
    case "clock":
      return (
        <div className="wg-clock">
          <b>{now.toLocaleTimeString(ar ? "ar" : undefined, { hour: "numeric", minute: "2-digit" })}</b>
          <span>{now.toLocaleDateString(ar ? "ar" : undefined, { weekday: "long", day: "numeric", month: "long" })}</span>
        </div>
      );
    case "stats":
      return stats ? (
        <div className="wg-stats">
          <div>
            <b>{stats.pages}</b>
            <span>{tr("pages")}</span>
          </div>
          <div>
            <b>{stats.chats}</b>
            <span>{tr("chats")}</span>
          </div>
          <div>
            <b>{stats.automations}</b>
            <span>{tr("automations")}</span>
          </div>
        </div>
      ) : null;
  }
}

export function WidgetsHome() {
  const stored = useStore((s) => s.settings["home.widgets"]) as Widget[] | undefined;
  const widgets = Array.isArray(stored) && stored.length ? stored : DEFAULT_WIDGETS;
  const set = useStore((s) => s.setSetting);
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const save = (next: Widget[]) => set("home.widgets", next);
  const add = (el: HTMLElement) =>
    menuAt(
      el,
      WIDGETS.map((w) => ({
        label: w.label,
        icon: w.icon,
        onSelect: () => save([...widgets, { id: `w${Date.now().toString(36)}`, type: w.type, size: w.size }]),
      })),
    );
  const ar = uiLanguage() === "ar";
  const h = new Date().getHours();
  const greeting = ar ? (h < 12 ? "صباح الخير" : "مساء الخير") : h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className={`home home-widgets ${editing ? "is-editing" : ""}`}>
      <div className="home-top">
        <div className="home-heading">
          <h1 className="home-title">{greeting}</h1>
        </div>
        <div className="home-controls">
          {editing && (
            <button className="btn btn-plain btn-standard" onClick={(e) => add(e.currentTarget)}>
              <Icon name="add" size={15} />
              {tr("Add widget")}
            </button>
          )}
          <button className={`btn btn-${editing ? "tinted" : "plain"} btn-standard`} onClick={() => setEditing(!editing)}>
            <Icon name={editing ? "check" : "edit"} size={15} />
            {editing ? tr("Done") : tr("Edit widgets")}
          </button>
          <HomeModeButton />
        </div>
      </div>
      <div className="wg-grid">
        {widgets.map((w) => {
          const def = WIDGETS.find((d) => d.type === w.type);
          if (!def) return null;
          return (
            <section
              key={w.id}
              className={`wg wg-${w.type} is-${w.size} ${drag === w.id ? "is-dragging" : ""}`}
              draggable={editing}
              onDragStart={(e: DragEvent) => {
                setDrag(w.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e: DragEvent) => editing && drag && e.preventDefault()}
              onDrop={(e: DragEvent) => {
                e.preventDefault();
                if (!drag || drag === w.id) return;
                const from = widgets.findIndex((x) => x.id === drag);
                const to = widgets.findIndex((x) => x.id === w.id);
                const next = [...widgets];
                const [moved] = next.splice(from, 1);
                next.splice(to, 0, moved);
                save(next);
                setDrag(null);
              }}
              onDragEnd={() => setDrag(null)}
            >
              <header className="wg-head">
                <Icon name={def.icon} size={14} />
                <span>{tr(def.label)}</span>
                {editing && (
                  <span className="wg-edit">
                    <button aria-label={tr("Size")} data-tip={w.size === "wide" ? tr("Make small") : tr("Make wide")} onClick={() => save(widgets.map((x) => (x.id === w.id ? { ...x, size: x.size === "wide" ? "small" : "wide" } : x)))}>
                      <Icon name={w.size === "wide" ? "minimize" : "expand"} size={12} />
                    </button>
                    <button aria-label={tr("Remove widget")} data-tip={tr("Remove widget")} onClick={() => save(widgets.filter((x) => x.id !== w.id))}>
                      <Icon name="close" size={12} />
                    </button>
                  </span>
                )}
              </header>
              <div className="wg-body">
                <WidgetBody w={w} />
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
