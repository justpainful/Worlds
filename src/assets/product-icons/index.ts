/**
 * The product icon set: miniature, lit renders on squircle tiles.
 *
 * Every `<name>.svg` / `<name>.png` in this folder is an icon; `<name>-sm.*`
 * is its simplified artwork for 32px and below. Files are picked up
 * automatically, and `catalog-*.json` files add labels, categories and
 * search keywords for the icon picker.
 */

const art = {
  ...(import.meta.glob("./*.svg", { eager: true, query: "?url", import: "default" }) as Record<string, string>),
  ...(import.meta.glob("./*.png", { eager: true, import: "default" }) as Record<string, string>),
  // Machine-local icons (never committed), same naming rules.
  ...(import.meta.glob("/private/icons/*.svg", { eager: true, query: "?url", import: "default" }) as Record<string, string>),
  ...(import.meta.glob("/private/icons/*.png", { eager: true, import: "default" }) as Record<string, string>),
};

export type ProductIconName = string;

export const PRODUCT_ICONS: Record<ProductIconName, { full: string; small: string }> = {};

for (const [path, url] of Object.entries(art)) {
  const m = path.match(/^(?:\.|\/private\/icons)\/(.+?)(-sm)?\.(svg|png)$/);
  if (!m) continue;
  const entry = (PRODUCT_ICONS[m[1]] ??= { full: "", small: "" });
  if (m[2]) entry.small = url;
  else entry.full = url;
}
for (const [name, e] of Object.entries(PRODUCT_ICONS)) {
  if (!e.full) delete PRODUCT_ICONS[name];
  else if (!e.small) e.small = e.full;
}

export interface IconMeta {
  name: string;
  label: string;
  category: string;
  keywords: string[];
}

const catalogs = {
  ...(import.meta.glob("./catalog-*.json", { eager: true, import: "default" }) as Record<string, IconMeta[]>),
  ...(import.meta.glob("/private/icons/catalog-*.json", { eager: true, import: "default" }) as Record<string, IconMeta[]>),
};

const CORE: IconMeta[] = [
  ["home", "Home", "Worlds"], ["claude", "Claude", "Worlds"], ["pages", "Pages", "Worlds"], ["templates", "Templates", "Worlds"],
  ["automations", "Automations", "Worlds"], ["integrations", "Integrations", "Worlds"], ["activity", "Activity", "Worlds"],
  ["trash", "Trash", "Worlds"], ["settings", "Settings", "Worlds"], ["profile", "Profile", "Worlds"], ["search", "Search", "Worlds"],
  ["discord", "Discord", "Worlds"], ["presentation", "Presentation", "Files"], ["spreadsheet", "Spreadsheet", "Files"],
  ["document", "Document", "Files"], ["pdf", "PDF", "Files"], ["image", "Image", "Files"], ["video", "Video", "Files"], ["audio", "Audio", "Files"],
  ["code", "Code", "Files"], ["archive", "Archive", "Files"], ["file", "File", "Files"], ["gamedev", "Game Development", "Creative"],
  ["design", "Design", "Creative"], ["engineering", "Engineering", "Creative"], ["creative", "Creative Direction", "Creative"],
  ["music", "Music", "Creative"], ["writing", "Writing", "Creative"], ["star", "Star", "Symbols"], ["rocket", "Rocket", "Symbols"],
].map(([name, label, category]) => ({ name, label, category, keywords: [] }));

/** Every icon with its label and category, core set first. */
export const ICON_CATALOG: IconMeta[] = (() => {
  const seen = new Set<string>();
  const out: IconMeta[] = [];
  for (const m of [...CORE, ...Object.values(catalogs).flat()]) {
    if (!m?.name || seen.has(m.name) || !PRODUCT_ICONS[m.name]) continue;
    seen.add(m.name);
    out.push({ ...m, keywords: m.keywords ?? [] });
  }
  for (const name of Object.keys(PRODUCT_ICONS)) {
    if (!seen.has(name)) out.push({ name, label: name.replace(/-/g, " "), category: "More", keywords: [] });
  }
  return out;
})();
