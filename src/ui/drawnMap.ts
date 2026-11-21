/**
 * Hand-drawn icons: which drawing stands for each Worlds icon.
 *
 * The drawings come from the owner's bot emoji library (gold and teal sets),
 * copied at 96px into src/assets/drawn/<set>/ (teal adds the bot's own teal
 * drawings; pink and blue are the gold set in Cognition's colours). Icons without a drawing keep
 * their line glyph, so small text tools (headings, alignment) stay crisp.
 */

import { useSyncExternalStore } from "react";

export type DrawnSet = "gold" | "teal" | "pink" | "blue";
export const DRAWN_SETS: DrawnSet[] = ["gold", "teal", "pink", "blue"];

/** Worlds icon name to drawing name (the file name without the set prefix). */
export const DRAWN: Record<string, string> = {
  page: "file",
  pages: "transcript",
  add: "plus",
  close: "deny",
  back: "back",
  search: "details",
  pin: "pin",
  favorite: "star",
  share: "send",
  image: "image",
  file: "file",
  upload: "upload",
  download: "download",
  link: "link",
  mention: "mention",
  checklist: "requirements",
  code: "code",
  template: "layout",
  history: "backfill",
  undo: "reply",
  archive: "archive",
  unarchive: "archive",
  delete: "delete",
  duplicate: "copy",
  move: "category",
  automation: "fast",
  clock: "time",
  schedule: "date",
  calendar: "date",
  calendarDays: "weekly",
  channel: "channel",
  user: "member",
  users: "team",
  dm: "messages",
  send: "send",
  preview: "visible",
  edit: "rename",
  pen: "rename",
  profile: "avatar",
  settings: "settings",
  sliders: "settings",
  activity: "stats",
  owner: "owner",
  lock: "close",
  home: "home",
  check: "accept",
  success: "accept",
  globe: "globe",
  grid: "layout",
  widgets: "layout",
  listView: "list",
  bulletList: "list",
  emoji: "happy",
  callout: "idea",
  folder: "category",
  folderOpen: "category",
  assistant: "wand",
  bell: "ping",
  reminder: "alarm",
  attachment: "attach",
  play: "test",
  pause: "pause",
  info: "info",
  warning: "warning",
  error: "error",
  server: "server",
  monitor: "pc",
  browser: "pc",
  keyboard: "keyboard",
  storage: "database",
  language: "lang",
  translate: "lang",
  appearance: "palette",
  palette: "palette",
  inbox: "inbox",
  refresh: "refresh",
  synced: "refresh",
  repeat: "refresh",
  restore: "reset",
  announce: "publish",
  shield: "perms",
  mic: "voice",
  voice: "voice",
  book: "guide",
  dictionary: "guide",
  reader: "news",
  mapPin: "location",
  flame: "flame",
  puzzle: "puzzle",
  webhook: "webhook",
  device: "phone",
  mail: "invite",
  watch: "timer",
  sticky: "note",
  comment: "describe",
  speaker: "sound",
  waveform: "sound",
  button: "button",
  pointer: "button",
  form: "forms",
  terminal: "terminal",
  prompt: "terminal",
  instructions: "rules",
  exportAll: "download",
  hand: "welcome",
  arrowUp: "up",
  timeline: "trend",
  graph: "handoff",
  layers: "layout",
  disconnected: "cloudOff",
};

/** Product tiles (sidebar, Home) drawn the same way. */
export const DRAWN_PRODUCT: Record<string, string> = {
  activity: "stats",
  "ai-brain": "idea",
  archive: "archive",
  audio: "sound",
  automations: "fast",
  book: "guide",
  bookmark: "claim",
  briefcase: "mission",
  bug: "bug",
  cake: "gift",
  calculator: "counter",
  calendar: "date",
  cart: "shop",
  "chart-bar": "stats",
  "chart-pie": "pie",
  chat: "messages",
  checklist: "requirements",
  chess: "game",
  claude: "wand",
  clipboard: "requirements",
  clock: "time",
  cloud: "cloud",
  code: "code",
  coffee: "coffee",
  contract: "rules",
  cpu: "chip",
  creative: "icons",
  crown: "crown",
  dallah: "coffee",
  database: "database",
  dates: "date",
  design: "wand",
  desktop: "pc",
  dice: "dice",
  document: "file",
  engineering: "wrench",
  file: "file",
  fire: "flame",
  flowchart: "handoff",
  folder: "category",
  gamedev: "game",
  gamepad: "game",
  gem: "gem",
  gift: "gift",
  "git-branch": "thread",
  globe: "globe",
  graduation: "guide",
  guitar: "music",
  headphones: "voiceHours",
  heart: "heart",
  home: "home",
  image: "image",
  inbox: "inbox",
  index: "list",
  integrations: "plug",
  invoice: "note",
  joystick: "game",
  kanban: "layout",
  key: "grantWrite",
  keyboard: "keyboard",
  lantern: "idea",
  laptop: "pc",
  layers: "layout",
  library: "guide",
  lightbulb: "idea",
  link: "link",
  lock: "close",
  mail: "invite",
  "map-pin": "location",
  medal: "gold",
  meeting: "interview",
  microphone: "voice",
  moon: "idle",
  music: "music",
  notebook: "guide",
  notes: "note",
  pages: "transcript",
  paintbrush: "rename",
  pdf: "file",
  "pen-tool": "rename",
  phone: "phone",
  piano: "music",
  plane: "send",
  presentation: "news",
  profile: "avatar",
  puzzle: "puzzle",
  roadmap: "trend",
  robot: "bot",
  rocket: "rocket",
  search: "details",
  "server-rack": "server",
  settings: "settings",
  "shield-check": "perms",
  smartphone: "phone",
  sparkles: "icons",
  spreadsheet: "layout",
  star: "star",
  sun: "sun",
  sync: "refresh",
  table: "layout",
  tag: "subject",
  target: "target",
  team: "team",
  templates: "layout",
  terminal: "terminal",
  timer: "timer",
  translate: "lang",
  trash: "delete",
  "treasure-chest": "mystery",
  trophy: "trophy",
  video: "test",
  wallet: "wallet",
  wifi: "wifi",
  writing: "rename",
  drawing: "rename",
  gallery: "image",
  project: "category",
};

const files = import.meta.glob("../assets/drawn/*/*.png", { eager: true, import: "default" }) as Record<string, string>;

const BY_SET: Record<DrawnSet, Record<string, string>> = { gold: {}, teal: {}, pink: {}, blue: {} };
for (const [path, url] of Object.entries(files)) {
  const m = path.match(/drawn\/(gold|teal|pink|blue)\/(.+)\.png$/);
  if (m) BY_SET[m[1] as DrawnSet][m[2]] = url;
}

/** The picture for a drawing in a set; the gold set fills any gap in the teal one. */
export function drawnUrl(set: DrawnSet, drawing: string | undefined): string | null {
  if (!drawing) return null;
  return BY_SET[set][drawing] ?? BY_SET.gold[drawing] ?? null;
}

/** Every drawing name the maps use, for the copy script and tests. */
export function drawingsInUse(): string[] {
  return [...new Set([...Object.values(DRAWN), ...Object.values(DRAWN_PRODUCT)])].sort();
}

/** "lines" keeps the line glyphs; a set draws every icon that has a drawing. */
export type IconStyle = "lines" | DrawnSet;
let current: IconStyle = "gold";
const listeners = new Set<() => void>();
export function setIconStyle(style: unknown) {
  const next: IconStyle = style === "lines" || DRAWN_SETS.includes(style as DrawnSet) ? (style as IconStyle) : "gold";
  if (typeof document !== "undefined") document.documentElement.dataset.style = next === "lines" ? "lines" : "drawn";
  if (next === current) return;
  current = next;
  for (const l of listeners) l();
}
export function useIconStyle(): IconStyle {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}
