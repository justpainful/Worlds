import { invoke } from "@tauri-apps/api/core";
import { mockFileUrl as mockAsset } from "../dev/mockTauri";
import type {
  Attachment, Automation, AutomationSpec, Destination, HistoryEntry, Page, PageMeta, PendingAction, Profile,
  Rendered, RenderOptions, Run, SearchHit, Version, DiscordInventory, BridgeState, AiChat, AiMessage,
} from "./types";
import type { JSONContent } from "@tiptap/core";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface Bootstrap {
  profile: Profile;
  pages: PageMeta[];
  settings: Record<string, unknown>;
  dataDir: string;
}

export interface NewPage {
  title?: string;
  icon?: string | null;
  parentId?: string | null;
  afterId?: string | null;
  kind?: "page" | "template";
  markdown?: string;
  blocks?: JSONContent[];
}

export interface PagePatch {
  title?: string;
  icon?: string | null;
  cover?: string | null;
  pinned?: boolean;
  favorite?: boolean;
  archived?: boolean;
  metadata?: Record<string, unknown>;
  instructions?: string[];
  templateCategory?: string | null;
}

export interface BackupInfo {
  file: string;
  createdAt: number;
  reason: string;
  size: number;
}

export interface BackupState {
  backups: BackupInfo[];
  pendingRestore: string | null;
  /** Set once after launch when the database was restored or recovered. */
  note: string | null;
  folder: string;
}

export const api = {
  bootstrap: () => invoke<Bootstrap>("bootstrap"),
  backups: () => invoke<BackupState>("backups_list"),
  backupNow: () => invoke<BackupInfo>("backup_now"),
  backupRestore: (file: string) => invoke<void>("backup_restore", { file }),
  backupCancelRestore: () => invoke<void>("backup_cancel_restore"),
  launchInfo: () => invoke<{ hidden: boolean }>("launch_info"),
  pages: () => invoke<PageMeta[]>("pages_list"),
  page: (id: string, touch = false) => invoke<Page | null>("page_get", { id, touch }),
  createPage: (page: NewPage) => invoke<PageMeta>("page_create", { page }),
  updatePage: (id: string, patch: PagePatch) => invoke<PageMeta>("page_update", { id, patch }),
  /** Merge one key into a page's metadata (properties, look). */
  pageMarkdown: (id: string) => invoke<string>("page_markdown", { id }),
  setPageMeta: (id: string, key: "properties" | "look", value: unknown) => invoke<PageMeta>("page_meta_set", { id, key, value }),
  movePage: (id: string, parentId: string | null, beforeId: string | null) =>
    invoke<PageMeta>("page_move", { id, parentId, beforeId }),
  deletePage: (id: string) => invoke<void>("page_delete", { id }),
  restorePage: (id: string) => invoke<void>("page_restore", { id }),
  purgePage: (id: string) => invoke<void>("page_purge", { id }),
  duplicatePage: (id: string, deep = true) => invoke<PageMeta>("page_duplicate", { id, deep }),
  saveBlocks: (pageId: string, blocks: { id: string; content: JSONContent }[]) =>
    invoke<{ added: number; changed: number; removed: number; remapped: [string, string][]; updatedAt: number }>(
      "blocks_save",
      { pageId, blocks },
    ),
  search: (query: string, limit = 30, includeTemplates = true) =>
    invoke<SearchHit[]>("search", { query, limit, includeTemplates }),
  history: (pageId?: string | null, opId?: string | null, limit = 100) =>
    invoke<HistoryEntry[]>("history_list", { pageId: pageId ?? null, opId: opId ?? null, limit }),
  versions: (pageId: string) => invoke<Version[]>("versions_list", { pageId }),
  version: (versionId: string) => invoke<{ title: string; blocks: JSONContent[] }>("version_get", { versionId }),
  restoreVersion: (versionId: string) => invoke<PageMeta>("version_restore", { versionId }),
  undoOp: (opId: string) => invoke<string[]>("op_undo", { opId }),
  profile: () => invoke<Profile>("profile_get"),
  updateProfile: (patch: Partial<Record<keyof Profile, unknown>>) => invoke<Profile>("profile_update", { patch }),
  profileStats: () => invoke<import("../profile/BlockView").ProfileStats>("profile_stats"),
  mediaRecent: (limit = 60) => invoke<Attachment[]>("media_recent", { limit }),
  importFile: (pageId: string | null, path: string) => invoke<Attachment>("attachment_import", { pageId, path }),
  importBytes: (pageId: string | null, name: string, bytes: Uint8Array) =>
    invoke<Attachment>("attachment_import_bytes", { pageId, name, bytes: Array.from(bytes) }),
  attachment: (id: string) => invoke<Attachment | null>("attachment_get", { id }),
  attachmentPath: (id: string) => invoke<string>("attachment_path", { id }),
  pageAppendMarkdown: (pageId: string, markdown: string) => invoke<number>("page_append_markdown", { pageId, markdown }),
  previewPrepare: (attachmentId: string) => invoke<Record<string, unknown>>("preview_prepare", { attachmentId }),
  instantiate: (templateId: string, parentId: string | null = null, title: string | null = null) =>
    invoke<PageMeta>("template_instantiate", { templateId, parentId, title }),
  saveTemplate: (pageId: string) => invoke<PageMeta>("template_save", { pageId }),
  setSetting: (key: string, value: unknown) => invoke<void>("settings_set", { key, value }),
  saveSession: (session: unknown) => invoke<void>("session_save", { session }),
  dataDir: () => invoke<string>("data_dir"),
  setTransparency: (level: "off" | "mica" | "acrylic") => invoke<void>("window_set_transparency", { level }),

  // AI
  aiRun: (request: { prompt: string; pageId?: string | null; chatId?: string | null; attachments?: string[]; blockIds?: string[]; model?: string; effort?: string }) =>
    invoke<{ runId: string; chatId: string }>("ai_run", { request }),
  aiChats: (limit = 100) => invoke<AiChat[]>("ai_chats", { limit }),
  aiChat: (id: string) => invoke<{ id: string; messages: AiMessage[] }>("ai_chat", { id }),
  aiChatDelete: (id: string) => invoke<void>("ai_chat_delete", { id }),
  aiChatRename: (id: string, title: string) => invoke<void>("ai_chat_rename", { id, title }),
  aiCancel: (runId: string) => invoke<void>("ai_cancel", { runId }),
  aiStatus: () =>
    invoke<{ available: boolean; version?: string; path?: string; mcpRegistered?: boolean }>("ai_status"),
  aiRegisterMcp: () => invoke<string>("ai_register_mcp"),

  // Automations
  automations: () => invoke<Automation[]>("automations_list"),
  automation: (id: string) => invoke<Automation | null>("automation_get", { id }),
  saveAutomation: (automation: { id?: string | null; name: string; enabled: boolean; spec: AutomationSpec }) =>
    invoke<Automation>("automation_save", { automation }),
  deleteAutomation: (id: string) => invoke<void>("automation_delete", { id }),
  runAutomation: (id: string) => invoke<string>("automation_run_now", { id }),
  runs: (automationId?: string | null, limit = 50) =>
    invoke<Run[]>("automation_runs", { automationId: automationId ?? null, limit }),

  // Discord bridge
  discordRender: (pageId: string, options?: RenderOptions, blocks?: JSONContent[]) =>
    invoke<Rendered>("discord_render", { pageId, options: options ?? null, blocks: blocks ?? null }),
  discordStatus: (probe = true) =>
    invoke<{ state: BridgeState; error?: string; bot?: { tag: string }; config: Record<string, unknown> }>(
      "discord_status",
      { probe },
    ),
  discordDestinations: (refresh = false) => invoke<DiscordInventory>("discord_destinations", { refresh }),
  discordSend: (pageId: string, destination: Destination, options?: RenderOptions, blocks?: JSONContent[]) =>
    invoke<{ messageId?: string; channelId?: string; url?: string }>("discord_send", {
      pageId,
      destination,
      options: options ?? null,
      blocks: blocks ?? null,
    }),
  pending: () => invoke<PendingAction[]>("pending_actions"),
  resolvePending: (id: string, approve: boolean) => invoke<unknown>("pending_resolve", { id, approve }),
};

/** URL for an attachment served by the local `wfile` protocol. */
export function fileUrl(id: string | null | undefined): string {
  if (!id) return "";
  if ((window as unknown as { __WORLDS_MOCK__?: boolean }).__WORLDS_MOCK__) return mockAsset(id);
  return `http://wfile.localhost/${id}`;
}

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
