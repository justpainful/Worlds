import { invoke } from "@tauri-apps/api/core";
import { mockFileUrl as mockAsset } from "../dev/mockTauri";
import type {
  Attachment,
  Automation,
  AutomationSpec,
  Destination,
  HistoryEntry,
  Page,
  PageMeta,
  PendingAction,
  Profile,
  Rendered,
  RenderOptions,
  Run,
  SearchHit,
  Version,
  DiscordInventory,
  BridgeState,
  AiChat,
  AiMessage,
  ResourceKind,
  AiProvider,
  AiModelInfo,
  AiLocalServer,
  AiRunnerStatus,
} from "./types";
import type { JSONContent } from "@tiptap/core";
import {
  drawingExportEnvelope,
  drawingExportBlobEnvelope,
  type DrawingExportContext,
  type DrawingExportPolicyInfo,
  type DrawingExportPolicyUpdate,
} from "../drawing/exportPolicy";

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
  kind?: ResourceKind | "template";
  /** Kind-specific data (file, stream, project, doc settings). */
  metadata?: Record<string, unknown>;
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
  /** Say the tray menu in the interface language. */
  trayLanguage: (arabic: boolean) => invoke<void>("tray_language", { arabic }),
  pages: () => invoke<PageMeta[]>("pages_list"),
  page: (id: string, touch = false) => invoke<Page | null>("page_get", { id, touch }),
  createPage: (page: NewPage) => invoke<PageMeta>("page_create", { page }),
  drawingLoad: (pageId: string) => invoke<import("../drawing/model").DrawingDocument>("drawing_load", { pageId }),
  drawingApply: (pageId: string, operation: import("../drawing/model").DrawingOperation) =>
    invoke<import("../drawing/model").DrawingDocument>("drawing_apply", { pageId, operation }),
  drawingHistoryToggle: (pageId: string, expectedRevision: number, requestId: string, redo: boolean, actor: string) =>
    invoke<import("../drawing/undo").DrawingHistoryResult>("drawing_history_toggle", { pageId, expectedRevision, requestId, redo, actor }),
  drawingPackageStage: (name: string) => invoke<{ page: PageMeta; token: string }>("drawing_package_stage", { name }),
  drawingPackageAbort: (pageId: string, token: string) => invoke<boolean>("drawing_package_abort", { pageId, token }),
  drawingPackageInstall: (
    pageId: string,
    token: string,
    document: import("../drawing/model").DrawingDocument,
    experiments: import("../drawing/package").ImportedPackageExperiment[],
  ) => invoke<{ page: PageMeta; experiments: PageMeta[] }>("drawing_package_install", { pageId, token, document, experiments }),
  drawingHistoryImport: (pageId: string, document: import("../drawing/model").DrawingDocument) =>
    invoke<import("../drawing/model").DrawingDocument>("drawing_history_import", { pageId, document }),
  drawingExport: (path: string, bytes: Uint8Array, context: DrawingExportContext, token: string | null) =>
    invoke<void>("drawing_export_raw", drawingExportEnvelope(bytes, context, token), {
      headers: { "x-worlds-path": encodeURIComponent(path) },
    }),
  drawingExportBlob: async (
    path: string,
    blob: Blob,
    context: DrawingExportContext,
    token: string | null,
    signal?: AbortSignal,
    onCommit?: () => void,
  ) => {
    const packet = await drawingExportBlobEnvelope(blob, context, token, signal);
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    onCommit?.();
    return invoke<void>("drawing_export_raw", packet, { headers: { "x-worlds-path": encodeURIComponent(path) } });
  },
  drawingExportRequirements: (context: DrawingExportContext) => invoke<boolean>("drawing_export_requirements", { context }),
  drawingExportCheck: (context: DrawingExportContext, token: string | null) => invoke<void>("drawing_export_check", { context, token }),
  drawingExportPolicyCached: (pageId: string) => invoke<DrawingExportPolicyInfo>("drawing_export_policy_cached", { pageId }),
  drawingExportPolicy: (pageId: string, token: string | null, update?: DrawingExportPolicyUpdate) =>
    invoke<DrawingExportPolicyInfo>("drawing_export_policy", { pageId, token, update: update ?? null }),
  drawingVersions: (pageId: string) =>
    invoke<{ id: string; revision: number; label: string; author: string; createdAt: number }[]>("drawing_versions", { pageId }),
  drawingVersionSave: (pageId: string, label: string) => invoke<{ id: string }>("drawing_version_save", { pageId, label }),
  drawingVersionImport: (pageId: string, versionId: string, label: string, scene: import("../drawing/model").DrawingScene) =>
    invoke<{ id: string }>("drawing_version_import", { pageId, versionId, label, scene }),
  drawingVersionScene: (pageId: string, versionId: string) =>
    invoke<import("../drawing/model").DrawingScene>("drawing_version_scene", { pageId, versionId }),
  drawingVersionRestore: (
    pageId: string,
    versionId: string,
    expectedRevision: number,
    restoreId: string,
    label: string,
    backupLabel: string,
  ) =>
    invoke<{ operationId: string; backupId: string; document: import("../drawing/model").DrawingDocument }>("drawing_version_restore", {
      pageId,
      versionId,
      expectedRevision,
      restoreId,
      label,
      backupLabel,
    }),
  drawingMaterializeAssets: (pageId: string, scene: import("../drawing/model").DrawingScene, sourceId?: string) =>
    invoke<import("../drawing/model").DrawingScene>("drawing_materialize_assets", { pageId, scene, sourceId: sourceId ?? null }),
  drawingExperimentCreate: (pageId: string, name: string, description: string) =>
    invoke<PageMeta>("drawing_experiment_create", { pageId, name, description }),
  drawingExperiments: (pageId: string) =>
    invoke<{ page: PageMeta; experiment: import("../drawing/model").ExperimentInfo }[]>("drawing_experiments", { pageId }),
  drawingLibraryList: (pageId: string) => invoke<import("../drawing/library").LibraryItem[]>("drawing_library_list", { pageId }),
  drawingLibraryRead: (itemId: string, version?: number) =>
    invoke<import("../drawing/library").LibraryPublication>("drawing_library_read", { itemId, version: version ?? null }),
  drawingLibraryPublish: (input: import("../drawing/library").LibraryPublish) =>
    invoke<import("../drawing/library").LibraryPublication>("drawing_library_publish", {
      input: { ...input, itemId: input.itemId ?? null, expectedVersion: input.expectedVersion ?? null },
    }),
  drawingLibraryInstantiate: (itemId: string, version: number) => invoke<PageMeta>("drawing_library_instantiate", { itemId, version }),
  drawingLibraryRemove: (itemId: string) => invoke<void>("drawing_library_remove", { itemId }),
  drawingReferenceRead: (sourceId: string, token?: string | null, offline = false) =>
    invoke<import("../drawing/references").ReferencePreview>("drawing_reference_read", { sourceId, token: token ?? null, offline }),
  drawingReferenceSearch: (query: string, editable = false, token?: string | null, offline = false) =>
    invoke<PageMeta[]>("drawing_reference_search", { query, editable, token: token ?? null, offline }),
  drawingReferenceTask: (pageId: string, frameId: string, camera: import("../drawing/model").Rect, title: string) =>
    invoke<PageMeta>("drawing_reference_task", { pageId, frameId, camera, title }),
  drawingEmbedInsert: (pageId: string, targetId: string, frameId: string, camera: import("../drawing/model").Rect, versionId?: string) =>
    invoke<void>("drawing_embed_insert", { pageId, targetId, frameId, camera, versionId: versionId ?? null }),
  drawingSyncOpen: (pageId: string, serverUrl: string, workspaceId: string, userId: string) =>
    invoke<import("../drawing/replica").DrawingReplica>("drawing_sync_open", { pageId, serverUrl, workspaceId, userId }),
  drawingSyncPendingPages: () => invoke<string[]>("drawing_sync_pending_pages"),
  drawingSyncRecover: (
    pageId: string,
    input: import("../drawing/session").DrawingRecoveryInput,
    remote: import("../drawing/wire").DrawingWireState,
    title: string,
  ) =>
    invoke<{ copy: PageMeta; document: import("../drawing/model").DrawingDocument }>("drawing_sync_recover", {
      pageId,
      ...input,
      remote,
      title,
    }),
  drawingSyncSnapshot: (pageId: string) => invoke<import("../drawing/replica").DrawingReplica>("drawing_sync_snapshot", { pageId }),
  drawingSyncAccept: (pageId: string, expectedRevision: number, remote: import("../drawing/wire").DrawingWireState) =>
    invoke<import("../drawing/replica").DrawingCheckpointResult>("drawing_sync_accept", { pageId, expectedRevision, remote }),
  drawingSyncError: (pageId: string, status: import("../drawing/replica").DrawingReplica["status"], error: string) =>
    invoke<void>("drawing_sync_error", { pageId, status, error }),
  drawingSyncStoreOriginal: (pageId: string, id: string, info: import("../drawing/wire").DrawingAssetInfo, bytes: Uint8Array) =>
    invoke<void>("drawing_sync_store_original", bytes, {
      headers: {
        "x-worlds-page": encodeURIComponent(pageId),
        "x-worlds-id": encodeURIComponent(id),
        "x-worlds-name": encodeURIComponent(info.fileName),
        "x-worlds-mime": encodeURIComponent(info.mime),
        "x-worlds-sha256": info.sha256,
      },
    }),
  updatePage: (id: string, patch: PagePatch) => invoke<PageMeta>("page_update", { id, patch }),
  /** Merge one key into a page's metadata (properties, look). */
  pageMarkdown: (id: string) => invoke<string>("page_markdown", { id }),
  setPageMeta: (
    id: string,
    key:
      | "properties"
      | "look"
      | "doc"
      | "deck"
      | "project"
      | "gallery"
      | "file"
      | "stream"
      | "experiment"
      | "sheet"
      // A pack item's fields (docs/PACKS.md).
      | "item"
      | import("../planning/model").DataKind,
    value: unknown,
  ) => invoke<PageMeta>("page_meta_set", { id, key, value }),
  movePage: (id: string, parentId: string | null, beforeId: string | null) => invoke<PageMeta>("page_move", { id, parentId, beforeId }),
  deletePage: (id: string) => invoke<void>("page_delete", { id }),
  restorePage: (id: string) => invoke<void>("page_restore", { id }),
  purgePage: (id: string) => invoke<void>("page_purge", { id }),
  duplicatePage: (id: string, deep = true) => invoke<PageMeta>("page_duplicate", { id, deep }),
  /** `base`: when this editor last synced; the save is refused ("conflict") if the page changed since. */
  saveBlocks: (pageId: string, blocks: { id: string; content: JSONContent }[], base?: number) =>
    invoke<{ added: number; changed: number; removed: number; remapped: [string, string][]; updatedAt: number }>("blocks_save", {
      pageId,
      blocks,
      base: base ?? null,
    }),
  search: (query: string, limit = 30, includeTemplates = true) => invoke<SearchHit[]>("search", { query, limit, includeTemplates }),
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
  /** Raw binary IPC: the file is the request body, not a JSON array of numbers. */
  importBytes: (pageId: string | null, name: string, bytes: Uint8Array) =>
    invoke<Attachment>("attachment_import_raw", bytes, {
      headers: { "x-worlds-name": encodeURIComponent(name), "x-worlds-page": pageId ? encodeURIComponent(pageId) : "" },
    }),
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
  aiRun: (request: {
    prompt: string;
    pageId?: string | null;
    chatId?: string | null;
    attachments?: string[];
    blockIds?: string[];
    model?: string;
    effort?: string;
    provider?: string;
  }) => invoke<{ runId: string; chatId: string }>("ai_run", { request }),
  aiChats: (limit = 100) => invoke<AiChat[]>("ai_chats", { limit }),
  aiChat: (id: string) => invoke<{ id: string; messages: AiMessage[] }>("ai_chat", { id }),
  aiChatDelete: (id: string) => invoke<void>("ai_chat_delete", { id }),
  aiChatRename: (id: string, title: string) => invoke<void>("ai_chat_rename", { id, title }),
  aiCancel: (runId: string) => invoke<void>("ai_cancel", { runId }),
  aiStatus: () => invoke<{ available: boolean; version?: string; path?: string; mcpRegistered?: boolean }>("ai_status"),
  aiRegisterMcp: () => invoke<string>("ai_register_mcp"),
  /** Long-lived Claude Code token kept in Windows Credential Manager (never returned to the UI). */
  aiTokenStatus: () => invoke<{ saved: boolean }>("ai_token_status"),
  aiTokenOpenSetup: () => invoke<void>("ai_token_open_setup"),
  aiTokenSave: (token: string) => invoke<void>("ai_token_save", { token }),
  aiTokenClear: () => invoke<void>("ai_token_clear"),
  /** Model providers. Keys go in and are never sent back; `hasKey` only says one is saved. */
  aiProviders: () => invoke<AiProvider[]>("ai_providers"),
  aiProviderSave: (id: string, change: { baseUrl?: string; apiKey?: string }) =>
    invoke<AiProvider>("ai_provider_save", { id, baseUrl: change.baseUrl ?? null, apiKey: change.apiKey ?? null }),
  aiProviderModels: (id: string) => invoke<AiModelInfo[]>("ai_provider_models", { id }),
  aiLocalDetect: () => invoke<AiLocalServer[]>("ai_local_detect"),
  aiCodexStatus: () => invoke<AiRunnerStatus>("ai_codex_status"),
  aiCodexLogin: () => invoke<void>("ai_codex_login"),
  aiClaudeLogin: () => invoke<void>("ai_claude_login"),
  aiClaudeAuthStatus: () => invoke<AiRunnerStatus>("ai_claude_auth_status"),

  // Automations
  automations: () => invoke<Automation[]>("automations_list"),
  automation: (id: string) => invoke<Automation | null>("automation_get", { id }),
  saveAutomation: (automation: { id?: string | null; name: string; enabled: boolean; spec: AutomationSpec }) =>
    invoke<Automation>("automation_save", { automation }),
  deleteAutomation: (id: string) => invoke<void>("automation_delete", { id }),
  runAutomation: (id: string) => invoke<string>("automation_run_now", { id }),
  runs: (automationId?: string | null, limit = 50) => invoke<Run[]>("automation_runs", { automationId: automationId ?? null, limit }),

  // Discord bridge
  discordRender: (pageId: string, options?: RenderOptions, blocks?: JSONContent[]) =>
    invoke<Rendered>("discord_render", { pageId, options: options ?? null, blocks: blocks ?? null }),
  discordStatus: (probe = true) =>
    invoke<{ state: BridgeState; error?: string; bot?: { tag: string }; config: Record<string, unknown> }>("discord_status", { probe }),
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
