import type { JSONContent } from "@tiptap/core";

export interface Profile {
  id: string;
  displayName: string;
  handle: string | null;
  avatar: string | null;
  banner: string | null;
  bio: string | null;
  status: string | null;
  accent: string | null;
  theme: string;
  language: string;
  textDirection: string;
  location: string | null;
  links: { label: string; url: string }[];
  /** Profile Blocks (see src/profile/blocks.ts). */
  blocks: unknown[];
  bannerFocus: string | null;
  avatarCrop: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AiChat {
  id: string;
  title: string;
  pageId: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface ChatAttachment {
  id: string;
  name: string;
  mime: string;
  kind: string;
  size: number;
}

export interface AiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps: { tool: string; ok: boolean | null }[];
  opId: string | null;
  meta: {
    pageId?: string | null;
    attachments?: ChatAttachment[];
    isError?: boolean;
    changeCount?: number;
    pages?: { id: string; title: string | null }[];
    undone?: boolean;
  };
  createdAt: number;
}

export interface PageMeta {
  id: string;
  title: string;
  icon: string | null;
  cover: string | null;
  parentId: string | null;
  sortKey: number;
  ownerId: string | null;
  kind: "page" | "template";
  templateCategory: string | null;
  pinned: boolean;
  pinOrder: number | null;
  favorite: boolean;
  archived: boolean;
  deletedAt: number | null;
  preview: string;
  createdAt: number;
  updatedAt: number;
  openedAt: number | null;
  /** Typed page properties (see src/pages/properties.ts). */
  properties?: unknown[];
  /** Small presentation settings: cover crop, page style. */
  look?: { coverCrop?: string; font?: "default" | "serif" | "mono"; small?: boolean; full?: boolean };
}

export interface Block {
  id: string;
  pageId: string;
  type: string;
  order: number;
  content: JSONContent;
  properties: Record<string, unknown>;
  direction: string;
  createdAt: number;
  updatedAt: number;
}

export interface Backlink {
  pageId: string;
  title: string;
  icon: string | null;
  blockId: string;
  kind: string;
  excerpt: string;
}

export interface Attachment {
  id: string;
  pageId: string | null;
  kind: "image" | "gif" | "video" | "file";
  fileName: string;
  mime: string;
  size: number;
  relPath: string;
  width: number | null;
  height: number | null;
  createdAt: number;
}

export interface Page extends PageMeta {
  metadata: Record<string, unknown>;
  instructions: string[];
  blocks: Block[];
  backlinks: Backlink[];
  attachments: Attachment[];
  breadcrumbs: { id: string; title: string; icon: string | null }[];
}

export interface SearchHit {
  pageId: string;
  title: string;
  icon: string | null;
  kind: string;
  snippet: string;
  parentTitle: string | null;
  updatedAt: number;
}

export interface HistoryEntry {
  id: number;
  pageId: string | null;
  pageTitle: string | null;
  opId: string | null;
  actor: "user" | "ai" | "automation" | "system";
  kind: string;
  summary: string;
  blockId: string | null;
  before: JSONContent | null;
  after: JSONContent | null;
  meta: Record<string, unknown>;
  createdAt: number;
}

export interface Version {
  id: string;
  pageId: string;
  createdAt: number;
  actor: string;
  opId: string | null;
  label: string | null;
  blockCount: number;
}

export type Trigger =
  | { kind: "once"; at: number }
  | { kind: "daily"; time: string }
  | { kind: "weekly"; days: number[]; time: string }
  | { kind: "monthly"; day: number; time: string }
  | { kind: "manual" };

export interface Destination {
  kind: "channel" | "thread" | "dm" | "edit";
  id: string;
  label?: string | null;
  guildId?: string | null;
  channelId?: string | null;
  messageId?: string | null;
}

export interface RenderOptions {
  container?: boolean;
  accentColor?: number;
  noAccent?: boolean;
  includeTitle?: boolean;
  hideCompleted?: boolean;
}

export interface AutomationSpec {
  trigger: Trigger;
  source: { pageId: string };
  transform: { kind: "none" } | { kind: "claude"; instructions: string; model?: string };
  action: { kind: "discord.send"; options?: RenderOptions; mode?: "send" | "editLast" };
  destination?: Destination | null;
  policy: { unattended: boolean; graceMinutes?: number };
}

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  spec: AutomationSpec;
  nextRunAt: number | null;
  lastRunAt: number | null;
  createdAt: number;
  updatedAt: number;
  lastStatus: RunStatus | null;
}

export type RunStatus = "scheduled" | "running" | "waiting" | "succeeded" | "failed" | "skipped" | "cancelled";

export interface Run {
  id: string;
  automationId: string;
  status: RunStatus;
  trigger: string;
  scheduledFor: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  versionId: string | null;
  output: { payload?: unknown; result?: unknown; transformed?: string } | null;
  error: string | null;
}

export interface RenderWarning {
  level: "error" | "warn" | "info";
  message: string;
}

export interface Rendered {
  payload: { flags: number; components: DiscordComponent[] };
  files: { attachmentId: string; name: string; size: number }[];
  warnings: RenderWarning[];
  componentCount: number;
  textChars: number;
}

export interface DiscordComponent {
  type: number;
  [k: string]: unknown;
}

export interface PendingAction {
  id: string;
  kind: string;
  payload: {
    pageId: string;
    destination: Destination;
    options?: RenderOptions;
    automationId?: string;
    automationName?: string;
    runId?: string;
  };
  requestedBy: string;
  opId: string | null;
  status: string;
  createdAt: number;
}

export interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  parentId?: string | null;
  position?: number;
  canSend?: boolean;
}

export interface DiscordGuild {
  id: string;
  name: string;
  icon?: string | null;
  channels: DiscordChannel[];
  threads?: DiscordChannel[];
}

export interface DiscordInventory {
  bot?: { id: string; tag: string; avatar?: string | null };
  guilds: DiscordGuild[];
  users?: { id: string; name: string; avatar?: string | null }[];
  fetchedAt?: number;
  stale?: boolean;
  error?: string;
}

export type BridgeState = "connected" | "not-configured" | "module-missing" | "unauthorized" | "host-unreachable" | "error" | "unknown";
