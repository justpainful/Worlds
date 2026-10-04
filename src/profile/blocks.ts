/**
 * Profile Blocks: a small, typed widget system for the profile.
 *
 * Blocks are templates with fields, never a free canvas. They live in the
 * profile row as JSON (validated on the Rust side: id + type, at most 12).
 */

import { BRIDGE } from "../discord/bridge";

export type BlockType = "info" | "progress" | "quote" | "grid" | "list" | "media" | "frame" | "fields" | "links" | "badges" | "dynamic";

/** 12-column grid sizes: columns x rows. */
export type BlockSize = "12x1" | "8x1" | "6x1" | "4x1" | "3x1" | "6x2" | "12x2";

export type BlockStyle = "soft" | "tinted" | "solid" | "compact" | "showcase" | "minimal";

export type ImageFit = "contain" | "cover" | "original";
export type ImageSide = "right" | "left" | "top" | "background";

/** An icon is an uploaded image ("img:<attachmentId>"), a product icon ("pi:<name>") or an emoji. */
export type IconRef = string;

export interface Item {
  icon?: IconRef;
  title: string;
  subtitle?: string;
  url?: string;
}

export interface Field {
  key: string;
  value: string;
}

export type DynamicSource = "streak" | "latest-page" | "session" | "activity" | "bridge";

interface Base {
  id: string;
  type: BlockType;
  size: BlockSize;
  style: BlockStyle;
  /** Accent colour (#rrggbb) for tinted styles, progress bars and labels. */
  accent?: string;
  hidden?: boolean;
  /** Optional click target for the whole block. */
  url?: string;
}

export interface InfoBlock extends Base {
  type: "info";
  label?: string;
  labelIcon?: IconRef;
  title: string;
  subtitle?: string;
  badge?: string;
  image?: string;
  imageSide?: ImageSide;
  imageFit?: ImageFit;
  focus?: string;
}
export interface ProgressBlock extends Base {
  type: "progress";
  icon?: IconRef;
  title: string;
  caption?: string;
  value: number;
  max: number;
  /** Show "value/max" (default) or a percentage. */
  display?: "ratio" | "percent" | "none";
}
export interface QuoteBlock extends Base {
  type: "quote";
  label?: string;
  labelIcon?: IconRef;
  statement: string;
  subtext?: string;
  image?: string;
  imageSide?: ImageSide;
  imageFit?: ImageFit;
  focus?: string;
  align?: "start" | "center";
}
export interface GridBlock extends Base {
  type: "grid";
  title?: string;
  columns: 1 | 2 | 3 | 4;
  items: Item[];
}
export interface ListBlock extends Base {
  type: "list";
  title?: string;
  items: Item[];
}
export interface MediaBlock extends Base {
  type: "media";
  media?: string;
  /** Video files play muted and looped. */
  isVideo?: boolean;
  fit: ImageFit;
  focus?: string;
  caption?: string;
}
/** Frame shapes, as a phone home screen (and the LiquidGlassWidgets frame widget) uses them. */
export type FrameShape = "square" | "circle" | "classic" | "upright" | "phone" | "portrait" | "column" | "wide" | "pano" | "large" | "auto";

export const FRAME_SHAPES: { id: FrameShape; label: string; ratio: number }[] = [
  { id: "auto", label: "Auto (the picture's own shape)", ratio: 0 },
  { id: "square", label: "Square", ratio: 1 },
  { id: "large", label: "Large square", ratio: 1 },
  { id: "circle", label: "Circle", ratio: 1 },
  { id: "classic", label: "Classic 4:3", ratio: 4 / 3 },
  { id: "upright", label: "Upright 3:4", ratio: 3 / 4 },
  { id: "phone", label: "Phone 9:16", ratio: 9 / 16 },
  { id: "portrait", label: "Portrait", ratio: 1 / 2.1 },
  { id: "column", label: "Column 1:3", ratio: 0.95 / 2.85 },
  { id: "wide", label: "Wide", ratio: 2.1 },
  { id: "pano", label: "Panorama 3:1", ratio: 3 },
];

export interface FrameBlock extends Base {
  type: "frame";
  /** One picture, or several shown as a slideshow. */
  photos: string[];
  shape: FrameShape;
  /** Fill crops to the shape; whole shows all of it over a blurred copy of itself. */
  fit: "fill" | "whole";
  radius: number;
  shadow: boolean;
  focus?: string;
  text?: string;
  textPos?: "top" | "bottom";
  /** Seconds per picture when there are several. */
  interval?: number;
}

export interface FieldsBlock extends Base {
  type: "fields";
  title?: string;
  fields: Field[];
}
export interface LinksBlock extends Base {
  type: "links";
  title?: string;
  links: Item[];
}
export interface BadgesBlock extends Base {
  type: "badges";
  title?: string;
  badges: Item[];
}
export interface DynamicBlock extends Base {
  type: "dynamic";
  source: DynamicSource;
  title?: string;
  /** For "session": the daily goal in minutes. */
  goal?: number;
}

export type ProfileBlock =
  | InfoBlock
  | ProgressBlock
  | QuoteBlock
  | GridBlock
  | ListBlock
  | MediaBlock
  | FrameBlock
  | FieldsBlock
  | LinksBlock
  | BadgesBlock
  | DynamicBlock;

export const MAX_BLOCKS = 12;
export const FEATURED = 3;
/** Types that may appear at most twice. */
const LIMITED: Partial<Record<BlockType, number>> = { info: 2, quote: 2, media: 2, dynamic: 2, badges: 2, frame: 6 };

export const SIZES: { id: BlockSize; label: string; cols: number; rows: number }[] = [
  { id: "12x1", label: "Wide", cols: 12, rows: 1 },
  { id: "12x2", label: "Wide and tall", cols: 12, rows: 2 },
  { id: "8x1", label: "Two thirds", cols: 8, rows: 1 },
  { id: "6x1", label: "Half", cols: 6, rows: 1 },
  { id: "6x2", label: "Half and tall", cols: 6, rows: 2 },
  { id: "4x1", label: "Third", cols: 4, rows: 1 },
  { id: "3x1", label: "Quarter", cols: 3, rows: 1 },
];

export const STYLES: { id: BlockStyle; label: string; note: string }[] = [
  { id: "soft", label: "Soft Glass", note: "Clear Liquid Glass" },
  { id: "tinted", label: "Tinted Glass", note: "Glass tinted with the accent" },
  { id: "solid", label: "Solid", note: "Dark card, art bleeds off the edge" },
  { id: "compact", label: "Compact", note: "Tighter, smaller type" },
  { id: "showcase", label: "Showcase", note: "Large art, bold title" },
  { id: "minimal", label: "Minimal", note: "No card, just content" },
];

export const TYPES: { id: BlockType; label: string; note: string; icon: string }[] = [
  { id: "info", label: "Info", note: "Label, title, subtitle and art", icon: "pi:star" },
  { id: "progress", label: "Progress", note: "A bar with current and max", icon: "pi:activity" },
  { id: "quote", label: "Statement", note: "A line that says who you are", icon: "pi:writing" },
  { id: "grid", label: "Grid", note: "Skills, projects or apps", icon: "pi:design" },
  { id: "list", label: "List", note: "Three to six rows", icon: "pi:pages" },
  { id: "media", label: "Media", note: "Image, GIF or a short video", icon: "pi:video" },
  { id: "frame", label: "Frame", note: "Photos as art, like desktop widgets", icon: "pi:image" },
  { id: "fields", label: "Fields", note: "Role, location, focus", icon: "pi:document" },
  { id: "links", label: "Links", note: "Buttons to your places", icon: "pi:integrations" },
  { id: "badges", label: "Badges", note: "A small shelf of badges", icon: "pi:rocket" },
  { id: "dynamic", label: "Live", note: "Updates itself from Worlds", icon: "pi:automations" },
];

export const DYNAMIC_SOURCES: { id: DynamicSource; label: string }[] = [
  { id: "session", label: "Today's session" },
  { id: "streak", label: "Streak" },
  { id: "activity", label: "Last 4 weeks" },
  { id: "latest-page", label: "Latest page" },
  { id: "bridge", label: "Discord bot" },
];

/** The block's live source; profiles saved before the bridge rename keep working. */
export function dynamicSource(source: string | undefined): DynamicSource {
  return (source && source === BRIDGE.legacySource ? "bridge" : source) as DynamicSource;
}

export function canAdd(blocks: ProfileBlock[], type: BlockType) {
  if (blocks.length >= MAX_BLOCKS) return false;
  const limit = LIMITED[type];
  return limit === undefined || blocks.filter((b) => b.type === type).length < limit;
}

const uid = () => `b${Math.random().toString(36).slice(2, 10)}`;

export function newBlock(type: BlockType): ProfileBlock {
  const base = { id: uid(), style: "solid" as BlockStyle };
  switch (type) {
    case "info":
      return { ...base, type, size: "12x1", label: "Now", title: "Working on something new", subtitle: "Add a subtitle", imageSide: "right", imageFit: "contain" };
    case "progress":
      return { ...base, type, size: "12x1", icon: "pi:activity", title: "Current goal", caption: "This week", value: 3, max: 5, display: "ratio" };
    case "quote":
      return { ...base, type, size: "12x1", label: "Motto", statement: "Make it simple, make it right", subtext: "Then make it fast", imageSide: "right", imageFit: "contain" };
    case "grid":
      return {
        ...base,
        type,
        size: "12x1",
        columns: 2,
        items: [
          { icon: "pi:gamedev", title: "Game Development", subtitle: "Better games" },
          { icon: "pi:design", title: "Product Design", subtitle: "Taste included" },
          { icon: "pi:engineering", title: "Software Engineering", subtitle: "Built properly" },
          { icon: "pi:creative", title: "Creative Direction", subtitle: "The whole picture" },
        ],
      };
    case "list":
      return {
        ...base,
        type,
        size: "6x2",
        title: "Currently",
        items: [
          { icon: "pi:music", title: "Listening", subtitle: "Something calm" },
          { icon: "pi:writing", title: "Writing", subtitle: "Notes for the next build" },
          { icon: "pi:gamedev", title: "Playing", subtitle: "Weekend sessions" },
        ],
      };
    case "media":
      return { ...base, type, size: "6x2", fit: "cover", focus: "50,50" };
    case "frame":
      return { ...base, type, size: "4x1", style: "minimal", photos: [], shape: "square", fit: "fill", radius: 26, shadow: true, textPos: "bottom", interval: 8 };
    case "fields":
      return {
        ...base,
        type,
        size: "6x1",
        title: "Details",
        fields: [
          { key: "Role", value: "Builder" },
          { key: "Focus", value: "Worlds" },
        ],
      };
    case "links":
      return { ...base, type, size: "6x1", style: "soft", title: "Find me", links: [{ icon: "pi:discord", title: "Discord", url: "https://discord.com" }] };
    case "badges":
      return { ...base, type, size: "6x1", style: "soft", title: "Badges", badges: [{ icon: "pi:star", title: "Early" }, { icon: "pi:rocket", title: "Shipper" }] };
    case "dynamic":
      return { ...base, type, size: "6x1", style: "tinted", source: "session", goal: 120 };
  }
}

/** Starter blocks for an empty profile: shown as a preview the user can adopt. */
export function starterBlocks(): ProfileBlock[] {
  return [newBlock("info"), { ...newBlock("dynamic"), size: "6x1" }, { ...newBlock("dynamic"), source: "streak", size: "6x1", style: "soft" } as ProfileBlock, newBlock("grid")];
}

export function sizeOf(id: BlockSize) {
  return SIZES.find((s) => s.id === id) ?? SIZES[0];
}

export function parseFocus(focus?: string) {
  const [x, y] = (focus ?? "50,50").split(",").map(Number);
  return { x: Number.isFinite(x) ? x : 50, y: Number.isFinite(y) ? y : 50 };
}

export function sanitize(raw: unknown): ProfileBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((b): b is ProfileBlock => !!b && typeof b === "object" && typeof (b as ProfileBlock).id === "string" && TYPES.some((t) => t.id === (b as ProfileBlock).type))
    .map((b) => ({ ...b, size: SIZES.some((s) => s.id === b.size) ? b.size : "12x1", style: STYLES.some((s) => s.id === b.style) ? b.style : "solid" }))
    .slice(0, MAX_BLOCKS) as ProfileBlock[];
}
