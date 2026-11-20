/**
 * Worlds plugins: small packages that add to the app without touching its
 * code. A plugin is JSON with one of four kinds:
 *
 *   block     an interactive block (HTML, CSS and scripts in a sandboxed
 *             frame with no network); it can keep state per block.
 *   theme     colour tokens for the light and dark themes (CSS custom
 *             properties only, nothing that loads from elsewhere).
 *   home      an HTML Home (see views/home/HomeModes.tsx).
 *   template  a page in Markdown that becomes a template.
 *
 * Installed plugins live in settings ("plugins.installed"). The gallery is
 * the list built into the app plus the one published on enterworlds.space;
 * anyone can also share a plugin as a .worlds.json file or a link.
 */
import { api, errorMessage } from "../lib/api";
import { useStore } from "../state/store";
import { tr } from "../i18n/ui";
import { BUILTIN_PLUGINS } from "./catalog";

export type PluginKind = "block" | "theme" | "home" | "template";

export interface Plugin {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  kind: PluginKind;
  /** Arabic name and description, shown in the Arabic interface. */
  nameAr?: string;
  descriptionAr?: string;
  icon?: string;
  /** block and home */
  html?: string;
  /** block: the frame's starting height */
  height?: number;
  /** theme: tokens per theme, e.g. { "--accent": "#ff6f6f" } */
  dark?: Record<string, string>;
  light?: Record<string, string>;
  /** template */
  markdown?: string;
}

const KEY = "plugins.installed";
export const GALLERY_URL = "https://enterworlds.space/gallery/plugins.json";
const MAX = 400 * 1024;

export function installed(): Plugin[] {
  const v = useStore.getState().settings[KEY];
  return Array.isArray(v) ? (v as Plugin[]) : [];
}

const SAFE_TOKEN = /^--[a-z0-9-]{1,40}$/;
const SAFE_VALUE = /^[#a-z0-9 ,.%()-]{1,80}$/i;

/** Check a plugin before it is installed; returns the reason it cannot be, or null. */
export function validatePlugin(p: unknown): string | null {
  if (!p || typeof p !== "object") return tr("This is not a Worlds plugin.");
  const x = p as Partial<Plugin>;
  if (typeof x.id !== "string" || !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(x.id)) return tr("The plugin has no valid id.");
  if (typeof x.name !== "string" || !x.name.trim()) return tr("The plugin has no name.");
  if (!["block", "theme", "home", "template"].includes(String(x.kind))) return tr("The plugin kind is not known.");
  if (JSON.stringify(p).length > MAX) return tr("The plugin is larger than 400 KB.");
  if ((x.kind === "block" || x.kind === "home") && typeof x.html !== "string") return tr("A block or Home plugin needs HTML.");
  if (x.kind === "theme") {
    for (const tokens of [x.dark ?? {}, x.light ?? {}]) {
      for (const [k, v] of Object.entries(tokens)) {
        if (!SAFE_TOKEN.test(k) || typeof v !== "string" || !SAFE_VALUE.test(v) || /url\s*\(/i.test(v)) return `${tr("A theme value is not allowed")}: ${k}`;
      }
    }
  }
  if (x.kind === "template" && typeof x.markdown !== "string") return tr("A template plugin needs Markdown.");
  if (/<script[^>]+src\s*=|<link[^>]+href\s*=\s*["']?https?:|@import\s+["']?https?:/i.test(x.html ?? "")) return tr("Plugins cannot load anything from the internet.");
  return null;
}

export async function installPlugin(p: Plugin): Promise<void> {
  const why = validatePlugin(p);
  if (why) throw new Error(why);
  const s = useStore.getState();
  const rest = installed().filter((x) => x.id !== p.id);
  s.setSetting(KEY, [...rest, p]);
  // The setting must reach the backend before a block frame asks for the plugin.
  await api.setSetting(KEY, [...rest, p]).catch(() => undefined);
  if (p.kind === "template" && p.markdown) {
    const meta = await api.createPage({ title: p.name, kind: "template", markdown: p.markdown } as never);
    await api.updatePage(meta.id, { templateCategory: "Plugins" } as never).catch(() => undefined);
    await s.refreshPages();
  }
  if (p.kind === "theme") applyPluginTheme();
}

export function uninstallPlugin(id: string) {
  const s = useStore.getState();
  s.setSetting(KEY, installed().filter((x) => x.id !== id));
  if (s.settings["plugins.theme"] === id) s.setSetting("plugins.theme", null);
  applyPluginTheme();
}

/** Put the chosen theme plugin's tokens on the page, for the current light or dark theme. */
export function applyPluginTheme() {
  const s = useStore.getState();
  const id = s.settings["plugins.theme"];
  let el = document.getElementById("worlds-plugin-theme") as HTMLStyleElement | null;
  const theme = installed().find((p) => p.id === id && p.kind === "theme");
  if (!theme) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = "worlds-plugin-theme";
    document.head.appendChild(el);
  }
  const block = (tokens: Record<string, string> | undefined) =>
    Object.entries(tokens ?? {})
      .filter(([k, v]) => SAFE_TOKEN.test(k) && SAFE_VALUE.test(v) && !/url\s*\(/i.test(v))
      .map(([k, v]) => `${k}: ${v};`)
      .join(" ");
  el.textContent = `:root:not([data-theme="light"]) { ${block(theme.dark)} } :root[data-theme="light"] { ${block(theme.light)} }`;
}

/** The gallery: what ships with Worlds plus what is published on enterworlds.space. */
export async function gallery(): Promise<Plugin[]> {
  const out = new Map(BUILTIN_PLUGINS.map((p) => [p.id, p]));
  try {
    const res = await fetch(GALLERY_URL, { cache: "no-store" });
    if (res.ok) {
      const list = (await res.json()) as unknown[];
      for (const p of Array.isArray(list) ? list : []) if (!validatePlugin(p)) out.set((p as Plugin).id, p as Plugin);
    }
  } catch {
    /* offline: the built-in list is enough */
  }
  return [...out.values()];
}

/** Install from a link to a .worlds.json file. */
export async function installFromUrl(url: string) {
  if (!/^https:\/\//i.test(url)) throw new Error(tr("Use an https link."));
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status}`);
  const p = (await res.json()) as Plugin;
  await installPlugin(p);
  return p;
}

/** Install from a .worlds.json file the person picks. */
export function installFromFile(): Promise<Plugin | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      try {
        const p = JSON.parse(await f.text()) as Plugin;
        await installPlugin(p);
        resolve(p);
      } catch (e) {
        useStore.getState().toast({ message: errorMessage(e), tone: "error" });
        resolve(null);
      }
    };
    input.click();
  });
}

function download(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Share the current look (accent and theme tokens of the chosen theme) as a theme plugin file. */
export function exportMyTheme() {
  const root = getComputedStyle(document.documentElement);
  const pick = (names: string[]) => Object.fromEntries(names.map((n) => [n, root.getPropertyValue(n).trim()]).filter(([, v]) => v));
  const theme: Plugin = {
    id: `my-theme-${Date.now().toString(36)}`,
    name: tr("My theme"),
    description: tr("Shared from Worlds"),
    author: useStore.getState().profile?.displayName ?? "",
    version: "1.0.0",
    kind: "theme",
    dark: pick(["--accent", "--accent-rgb"]),
    light: pick(["--accent", "--accent-rgb"]),
  };
  download("my-theme.worlds.json", theme);
}

/** Share a page as a template plugin file. */
export async function exportTemplate(pageId: string) {
  const s = useStore.getState();
  const md = await api.pageMarkdown(pageId);
  const title = s.pages[pageId]?.title || tr("Template");
  download(`${title.replace(/[\\/:*?"<>|]+/g, "-")}.worlds.json`, {
    id: `template-${Date.now().toString(36)}`,
    name: title,
    description: tr("A page template shared from Worlds"),
    author: s.profile?.displayName ?? "",
    version: "1.0.0",
    kind: "template",
    markdown: md,
  } satisfies Plugin);
}
