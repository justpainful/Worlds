# API parity inventory

Snapshot: 2026-11-07. Original checkout HEAD `185ee9a1019c8b7bc685d22dabf1b699579189cc`, with uncommitted changes including `src-tauri/src/lib.rs` and untracked `src-tauri/src/screen_drawing.rs`. The two screen-drawing entries below therefore describe that working tree, not necessarily HEAD. This inventory is a source-indexed audit, not proof that every endpoint has been traced or works. Source locations are relative to the original checkout.

## Counting rules and evidence

Each registered Tauri command, listed MCP tool, named account subaction, and identity route has one row. Sync service routes are counted by route/method family where the source branches share a handler. These are different surfaces and overlap in functionality; do not add them to obtain a feature count. MCP descriptions are source-declared intentions, not verified results. Handler matches are lexical pointers, not proof that every branch and dependency was followed. Exact-name test references are candidates only, not evidence of coverage or passing. `not located` does not establish absence. Dynamic route construction and indirect dispatch need manual review. No percentage or parity completion is inferred.

| Surface | Count | Evidence scope |
| --- | ---: | --- |
| Tauri commands | 130 | registered names from `generate_handler!` |
| Account subactions | 42 | string-dispatch branches inside the account command |
| MCP tools | 139 | declarations in the four chained tool lists |
| Identity route registrations | 50 | lexical method and static path registrations |
| Sync route families | 19 | manually enumerated branches in `services/sync/src/index.ts` |

## Cross-cutting data, rights, failures and test pointers

- Local store and Tauri: `src-tauri/src/db.rs` and `src-tauri/src/store/` use SQLite, WAL, transactions, migration backups, change records and attachment files. `commands.rs` returns command errors as strings. Individual access paths are not all traced here. Verify each handler before marking it equivalent. Tests include `src-tauri/src/store_tests.rs`; file presence is not a passing result.
- Account: `src-tauri/src/account/client.rs`, `commands.rs`, `permissions.rs`, `secrets.rs`, and `sync.rs` implement device-bound refresh, cached access and account sync. Permission levels include none/view/comment/edit/full and ancestor inheritance. Auth HTTP errors include offline, signed-out and service status. Relevant source tests include `src-tauri/src/account/tests.rs` and the ignored service integration module `account/e2e.rs`. Native identity and passkey support still needs actual Apple and service verification.
- MCP: `src-tauri/src/mcp.rs:30` runs stdio JSON-RPC, routes tools through `account::guarded_tool_call`, tags actor and operation, and executes under SQLite transactions. Discord requests go through pending approval. Tool-specific authorization, side effects and undo still require tracing individually. Relevant tests are in `src-tauri/src/account/tests.rs`, drawing modules, and `src/mcp` where applicable.
- Collaboration: `src-tauri/src/sync/mod.rs` persists snapshots, ordered updates, outbox, cursors, attachments and rejected causal states; `src/sync/provider.ts` sends `worlds-sync.v1` Yjs frames. `services/sync/src/protocol.ts` defines ack and close codes. Existing service tests are under `services/sync/test/`. A local isolated run in this Apple worktree exercised Rust Yrs, a SQLite fixture and the current local Worker, not the Swift session. Its source is `Apple/RustCollaboration/tests/live_service.rs`. End-to-end Apple collaboration, presence, editor mapping and permission revocation remain incomplete.
- Drawing: `src-tauri/src/drawing*.rs` and `services/sync/src/drawing-*.ts` use drawing operations and separate sync and export authority, not only the page Yjs protocol. The source working tree contains uncommitted drawing changes. Tests are discoverable in drawing test modules and `services/sync/test/drawing*.test.ts`; no global pass claim is made.
- AI and automation: `src-tauri/src/ai.rs` executes local Claude Code with a strict MCP config; `automations.rs` schedules inside the running process, and `discord/` includes rendering, bridge and approval queue. iOS child-process and background timing parity are not established.
- Identity HTTP routes use Hono, D1 and route-level auth/role checks. `workspaces.use("*", requireAuth)` and `me` middleware protect their routes, while sign-in and invitation routes have specific handling. Never infer an individual route privilege from its name. Sync routes authenticate via JWT except health, signed blobs and separately protected internal endpoints. Sync storage includes Durable Objects and R2. Check errors and rights in the cited handler and its downstream functions. Relevant tests: `services/identity/test/` and `services/sync/test/`, not run for this inventory.

## Registered Tauri commands

Each row records registration and a declaration location only. Per-command argument validation, authorization, persistence and failure paths remain to be traced unless separately supported in the cross-cutting notes.

| Command | Area | Declaration pointer | Exact-name test candidates | Status |
| --- | --- | --- | --- | --- |
| `screen_drawing::capture_screen_for_drawing` | drawing | `src-tauri/src/screen_drawing.rs:16` | not located by exact name | Registered, individual trace pending |
| `screen_drawing::end_screen_drawing` | drawing | `src-tauri/src/screen_drawing.rs:45` | not located by exact name | Registered, individual trace pending |
| `commands::bootstrap` | local store | `src-tauri/src/commands.rs:25` | not located by exact name | Registered, individual trace pending |
| `account::commands::account` | platform or other | `src-tauri/src/account/commands.rs:182, src-tauri/src/account/state.rs:49` | output/editorial/app-snapshot/src/drawing/canonical.test.ts, output/editorial/app-snapshot/src/drawing/syncManager.test.ts, output/editorial/app-snapshot/src/sync/provider.test.ts (+13) | Registered, individual trace pending |
| `commands::backups_list` | history and backups | `src-tauri/src/commands.rs:46` | not located by exact name | Registered, individual trace pending |
| `commands::attachment_import_raw` | attachments | `src-tauri/src/commands.rs:261` | not located by exact name | Registered, individual trace pending |
| `commands::backup_now` | history and backups | `src-tauri/src/commands.rs:58` | not located by exact name | Registered, individual trace pending |
| `commands::backup_restore` | history and backups | `src-tauri/src/commands.rs:65` | not located by exact name | Registered, individual trace pending |
| `commands::backup_cancel_restore` | history and backups | `src-tauri/src/commands.rs:70` | not located by exact name | Registered, individual trace pending |
| `commands::launch_info` | platform or other | `src-tauri/src/commands.rs:76` | not located by exact name | Registered, individual trace pending |
| `commands::pages_list` | local store | `src-tauri/src/commands.rs:81` | src-tauri/src/account/tests.rs | Registered, individual trace pending |
| `commands::page_get` | local store | `src-tauri/src/commands.rs:86` | not located by exact name | Registered, individual trace pending |
| `commands::page_create` | local store | `src-tauri/src/commands.rs:96` | not located by exact name | Registered, individual trace pending |
| `drawing::drawing_load` | drawing | `src-tauri/src/drawing.rs:557` | not located by exact name | Registered, individual trace pending |
| `drawing::drawing_apply` | drawing | `src-tauri/src/drawing.rs:559` | not located by exact name | Registered, individual trace pending |
| `drawing::drawing_history_toggle` | drawing | `src-tauri/src/drawing.rs:561` | not located by exact name | Registered, individual trace pending |
| `drawing::drawing_history_import` | drawing | `src-tauri/src/drawing.rs:563` | not located by exact name | Registered, individual trace pending |
| `drawing_package::drawing_package_stage` | drawing | `src-tauri/src/drawing_package.rs:23` | not located by exact name | Registered, individual trace pending |
| `drawing_package::drawing_package_abort` | drawing | `src-tauri/src/drawing_package.rs:24` | not located by exact name | Registered, individual trace pending |
| `drawing_package::drawing_package_install` | drawing | `src-tauri/src/drawing_package.rs:25` | not located by exact name | Registered, individual trace pending |
| `drawing_export::drawing_export_raw` | drawing | `src-tauri/src/drawing_export.rs:719` | not located by exact name | Registered, individual trace pending |
| `drawing_export::drawing_export_requirements` | drawing | `src-tauri/src/drawing_export.rs:564` | not located by exact name | Registered, individual trace pending |
| `drawing_export::drawing_export_policy` | drawing | `src-tauri/src/drawing_export.rs:665` | not located by exact name | Registered, individual trace pending |
| `drawing_export::drawing_export_policy_cached` | drawing | `src-tauri/src/drawing_export.rs:569` | not located by exact name | Registered, individual trace pending |
| `drawing_export::drawing_export_check` | drawing | `src-tauri/src/drawing_export.rs:579` | not located by exact name | Registered, individual trace pending |
| `drawing::drawing_versions` | drawing | `src-tauri/src/drawing.rs:565` | src-tauri/src/sync/tests.rs | Registered, individual trace pending |
| `drawing::drawing_version_save` | drawing | `src-tauri/src/drawing.rs:567` | not located by exact name | Registered, individual trace pending |
| `drawing::drawing_version_import` | drawing | `src-tauri/src/drawing.rs:575` | not located by exact name | Registered, individual trace pending |
| `drawing::drawing_version_scene` | drawing | `src-tauri/src/drawing.rs:569` | not located by exact name | Registered, individual trace pending |
| `drawing::drawing_version_restore` | drawing | `src-tauri/src/drawing.rs:571` | not located by exact name | Registered, individual trace pending |
| `drawing::drawing_materialize_assets` | drawing | `src-tauri/src/drawing.rs:586` | not located by exact name | Registered, individual trace pending |
| `drawing::drawing_experiment_create` | drawing | `src-tauri/src/drawing.rs:597` | not located by exact name | Registered, individual trace pending |
| `drawing::drawing_experiments` | drawing | `src-tauri/src/drawing.rs:603` | not located by exact name | Registered, individual trace pending |
| `drawing_library::drawing_library_list` | drawing | `src-tauri/src/drawing_library.rs:193` | not located by exact name | Registered, individual trace pending |
| `drawing_library::drawing_library_read` | drawing | `src-tauri/src/drawing_library.rs:195` | not located by exact name | Registered, individual trace pending |
| `drawing_library::drawing_library_publish` | drawing | `src-tauri/src/drawing_library.rs:197` | not located by exact name | Registered, individual trace pending |
| `drawing_library::drawing_library_instantiate` | drawing | `src-tauri/src/drawing_library.rs:205` | not located by exact name | Registered, individual trace pending |
| `drawing_library::drawing_library_remove` | drawing | `src-tauri/src/drawing_library.rs:203` | not located by exact name | Registered, individual trace pending |
| `drawing_references::drawing_reference_read` | drawing | `src-tauri/src/drawing_references.rs:62` | not located by exact name | Registered, individual trace pending |
| `drawing_references::drawing_reference_task` | drawing | `src-tauri/src/drawing_references.rs:69` | not located by exact name | Registered, individual trace pending |
| `drawing_references::drawing_embed_insert` | drawing | `src-tauri/src/drawing_references.rs:71` | not located by exact name | Registered, individual trace pending |
| `drawing_references::drawing_reference_search` | drawing | `src-tauri/src/drawing_references.rs:73` | not located by exact name | Registered, individual trace pending |
| `drawing_sync::drawing_sync_open` | drawing | `src-tauri/src/drawing_sync.rs:793` | not located by exact name | Registered, individual trace pending |
| `drawing_sync::drawing_sync_recover` | drawing | `src-tauri/src/drawing_sync.rs:776` | not located by exact name | Registered, individual trace pending |
| `drawing_sync::drawing_sync_pending_pages` | drawing | `src-tauri/src/drawing_sync.rs:789` | not located by exact name | Registered, individual trace pending |
| `drawing_sync::drawing_sync_snapshot` | drawing | `src-tauri/src/drawing_sync.rs:803` | not located by exact name | Registered, individual trace pending |
| `drawing_sync::drawing_sync_accept` | drawing | `src-tauri/src/drawing_sync.rs:807` | not located by exact name | Registered, individual trace pending |
| `drawing_sync::drawing_sync_error` | drawing | `src-tauri/src/drawing_sync.rs:816` | not located by exact name | Registered, individual trace pending |
| `drawing_sync::drawing_sync_store_original` | drawing | `src-tauri/src/drawing_sync.rs:820` | not located by exact name | Registered, individual trace pending |
| `commands::page_update` | local store | `src-tauri/src/commands.rs:127` | not located by exact name | Registered, individual trace pending |
| `commands::page_move` | local store | `src-tauri/src/commands.rs:132` | not located by exact name | Registered, individual trace pending |
| `commands::page_delete` | local store | `src-tauri/src/commands.rs:142` | not located by exact name | Registered, individual trace pending |
| `commands::page_restore` | local store | `src-tauri/src/commands.rs:147` | not located by exact name | Registered, individual trace pending |
| `commands::page_purge` | local store | `src-tauri/src/commands.rs:152` | not located by exact name | Registered, individual trace pending |
| `commands::page_duplicate` | local store | `src-tauri/src/commands.rs:157` | not located by exact name | Registered, individual trace pending |
| `commands::blocks_save` | local store | `src-tauri/src/commands.rs:164` | not located by exact name | Registered, individual trace pending |
| `commands::search` | local store | `src-tauri/src/commands.rs:188, src-tauri/src/drawing_references.rs:9, src-tauri/src/store/search.rs:49` | output/editorial/app-snapshot/src/sync/session.test.ts, output/editorial-current/frontend/src/sync/session.test.ts, src/sync/session.test.ts (+3) | Registered, individual trace pending |
| `commands::history_list` | history and backups | `src-tauri/src/commands.rs:198` | not located by exact name | Registered, individual trace pending |
| `commands::versions_list` | history and backups | `src-tauri/src/commands.rs:208` | not located by exact name | Registered, individual trace pending |
| `commands::version_get` | history and backups | `src-tauri/src/commands.rs:213` | not located by exact name | Registered, individual trace pending |
| `commands::version_restore` | history and backups | `src-tauri/src/commands.rs:218` | not located by exact name | Registered, individual trace pending |
| `commands::op_undo` | history and backups | `src-tauri/src/commands.rs:223` | not located by exact name | Registered, individual trace pending |
| `commands::profile_get` | local store | `src-tauri/src/commands.rs:228` | not located by exact name | Registered, individual trace pending |
| `commands::profile_update` | local store | `src-tauri/src/commands.rs:238` | not located by exact name | Registered, individual trace pending |
| `commands::profile_stats` | local store | `src-tauri/src/commands.rs:233, src-tauri/src/store/profile.rs:167` | not located by exact name | Registered, individual trace pending |
| `commands::page_meta_set` | local store | `src-tauri/src/commands.rs:122` | not located by exact name | Registered, individual trace pending |
| `commands::page_markdown` | local store | `src-tauri/src/commands.rs:101` | not located by exact name | Registered, individual trace pending |
| `commands::media_recent` | platform or other | `src-tauri/src/commands.rs:279` | not located by exact name | Registered, individual trace pending |
| `commands::attachment_import` | attachments | `src-tauri/src/commands.rs:243` | not located by exact name | Registered, individual trace pending |
| `commands::attachment_import_bytes` | attachments | `src-tauri/src/commands.rs:248` | not located by exact name | Registered, individual trace pending |
| `commands::attachment_get` | attachments | `src-tauri/src/commands.rs:284` | not located by exact name | Registered, individual trace pending |
| `commands::attachment_path` | attachments | `src-tauri/src/commands.rs:289` | not located by exact name | Registered, individual trace pending |
| `commands::template_instantiate` | local store | `src-tauri/src/commands.rs:297` | not located by exact name | Registered, individual trace pending |
| `commands::template_save` | local store | `src-tauri/src/commands.rs:314` | not located by exact name | Registered, individual trace pending |
| `commands::settings_set` | local store | `src-tauri/src/commands.rs:321` | not located by exact name | Registered, individual trace pending |
| `commands::session_save` | local store | `src-tauri/src/commands.rs:326` | not located by exact name | Registered, individual trace pending |
| `commands::data_dir` | platform or other | `src-tauri/src/commands.rs:352, src-tauri/src/db.rs:10` | src-tauri/src/drawing_history/tests.rs | Registered, individual trace pending |
| `commands::client_log` | platform or other | `src-tauri/src/commands.rs:346` | not located by exact name | Registered, individual trace pending |
| `window_style::window_set_transparency` | platform or other | `src-tauri/src/window_style.rs:62` | not located by exact name | Registered, individual trace pending |
| `commands::page_append_markdown` | local store | `src-tauri/src/commands.rs:332` | not located by exact name | Registered, individual trace pending |
| `preview::preview_prepare` | platform or other | `src-tauri/src/preview.rs:165` | not located by exact name | Registered, individual trace pending |
| `ai::ai_run` | AI | `src-tauri/src/ai.rs:399` | not located by exact name | Registered, individual trace pending |
| `ai::ai_cancel` | AI | `src-tauri/src/ai.rs:703` | not located by exact name | Registered, individual trace pending |
| `ai::ai_status` | AI | `src-tauri/src/ai.rs:719` | not located by exact name | Registered, individual trace pending |
| `ai::ai_register_mcp` | AI | `src-tauri/src/ai.rs:805` | not located by exact name | Registered, individual trace pending |
| `ai::ai_token_status` | AI | `src-tauri/src/ai.rs:740` | not located by exact name | Registered, individual trace pending |
| `ai::ai_token_open_setup` | AI | `src-tauri/src/ai.rs:747` | not located by exact name | Registered, individual trace pending |
| `ai::ai_token_save` | AI | `src-tauri/src/ai.rs:771` | not located by exact name | Registered, individual trace pending |
| `ai::ai_token_clear` | AI | `src-tauri/src/ai.rs:798` | not located by exact name | Registered, individual trace pending |
| `ai::ai_chats` | AI | `src-tauri/src/ai.rs:638` | not located by exact name | Registered, individual trace pending |
| `ai::ai_chat` | AI | `src-tauri/src/ai.rs:664` | not located by exact name | Registered, individual trace pending |
| `ai::ai_chat_delete` | AI | `src-tauri/src/ai.rs:688` | not located by exact name | Registered, individual trace pending |
| `ai::ai_chat_rename` | AI | `src-tauri/src/ai.rs:696` | not located by exact name | Registered, individual trace pending |
| `automations::automations_list` | automation | `src-tauri/src/automations.rs:439` | not located by exact name | Registered, individual trace pending |
| `automations::automation_get` | automation | `src-tauri/src/automations.rs:444` | not located by exact name | Registered, individual trace pending |
| `automations::automation_save` | automation | `src-tauri/src/automations.rs:449` | not located by exact name | Registered, individual trace pending |
| `automations::automation_delete` | automation | `src-tauri/src/automations.rs:454` | not located by exact name | Registered, individual trace pending |
| `automations::automation_run_now` | automation | `src-tauri/src/automations.rs:464` | not located by exact name | Registered, individual trace pending |
| `automations::automation_runs` | automation | `src-tauri/src/automations.rs:469` | not located by exact name | Registered, individual trace pending |
| `discord::discord_render` | Discord | `src-tauri/src/discord/mod.rs:193` | not located by exact name | Registered, individual trace pending |
| `discord::discord_status` | Discord | `src-tauri/src/discord/mod.rs:204` | not located by exact name | Registered, individual trace pending |
| `discord::discord_destinations` | Discord | `src-tauri/src/discord/mod.rs:216` | not located by exact name | Registered, individual trace pending |
| `discord::discord_send` | Discord | `src-tauri/src/discord/mod.rs:245` | not located by exact name | Registered, individual trace pending |
| `discord::pending_actions` | Discord | `src-tauri/src/discord/mod.rs:274` | not located by exact name | Registered, individual trace pending |
| `discord::pending_resolve` | Discord | `src-tauri/src/discord/mod.rs:300` | not located by exact name | Registered, individual trace pending |
| `sync::commands::sync_page_mode` | collaboration | `src-tauri/src/sync/commands.rs:18` | not located by exact name | Registered, individual trace pending |
| `sync::commands::sync_set_shared` | collaboration | `src-tauri/src/sync/commands.rs:23` | not located by exact name | Registered, individual trace pending |
| `sync::commands::sync_load` | collaboration | `src-tauri/src/sync/commands.rs:28` | not located by exact name | Registered, individual trace pending |
| `sync::commands::sync_append` | collaboration | `src-tauri/src/sync/commands.rs:33` | not located by exact name | Registered, individual trace pending |
| `sync::commands::sync_compact` | collaboration | `src-tauri/src/sync/commands.rs:45` | not located by exact name | Registered, individual trace pending |
| `sync::commands::sync_purge` | collaboration | `src-tauri/src/sync/commands.rs:50` | not located by exact name | Registered, individual trace pending |
| `sync::commands::sync_outbox` | collaboration | `src-tauri/src/sync/commands.rs:55` | src-tauri/src/sync/tests.rs | Registered, individual trace pending |
| `sync::commands::sync_outbox_ack` | collaboration | `src-tauri/src/sync/commands.rs:60` | not located by exact name | Registered, individual trace pending |
| `sync::commands::sync_outbox_ack_upto` | collaboration | `src-tauri/src/sync/commands.rs:65` | not located by exact name | Registered, individual trace pending |
| `sync::commands::sync_outbox_reject` | collaboration | `src-tauri/src/sync/commands.rs:70` | not located by exact name | Registered, individual trace pending |
| `sync::commands::sync_archive_rejection` | collaboration | `src-tauri/src/sync/commands.rs:74` | not located by exact name | Registered, individual trace pending |
| `sync::commands::sync_rejected_list` | collaboration | `src-tauri/src/sync/commands.rs:78` | not located by exact name | Registered, individual trace pending |
| `sync::commands::sync_rejected_read` | collaboration | `src-tauri/src/sync/commands.rs:82` | not located by exact name | Registered, individual trace pending |
| `sync::commands::sync_outbox_fail` | collaboration | `src-tauri/src/sync/commands.rs:87` | not located by exact name | Registered, individual trace pending |
| `sync::commands::sync_outbox_max` | collaboration | `src-tauri/src/sync/commands.rs:92` | not located by exact name | Registered, individual trace pending |
| `sync::commands::sync_cursor_set` | collaboration | `src-tauri/src/sync/commands.rs:97` | not located by exact name | Registered, individual trace pending |
| `sync::commands::sync_status` | collaboration | `src-tauri/src/sync/commands.rs:102` | not located by exact name | Registered, individual trace pending |
| `sync::commands::sync_mirror_check` | collaboration | `src-tauri/src/sync/commands.rs:110` | not located by exact name | Registered, individual trace pending |
| `sync::commands::sync_mirror_adopt` | collaboration | `src-tauri/src/sync/commands.rs:115` | not located by exact name | Registered, individual trace pending |
| `sync::commands::sync_mirror_write` | collaboration | `src-tauri/src/sync/commands.rs:125` | not located by exact name | Registered, individual trace pending |
| `sync::commands::sync_attachment_enqueue` | collaboration | `src-tauri/src/sync/commands.rs:136` | not located by exact name | Registered, individual trace pending |
| `sync::commands::sync_attachment_queue` | collaboration | `src-tauri/src/sync/commands.rs:146` | src-tauri/src/sync/tests.rs | Registered, individual trace pending |
| `sync::commands::sync_attachment_update` | collaboration | `src-tauri/src/sync/commands.rs:151` | not located by exact name | Registered, individual trace pending |
| `sync::commands::sync_attachment_store` | collaboration | `src-tauri/src/sync/commands.rs:158` | not located by exact name | Registered, individual trace pending |
| `sync::commands::sync_access_token` | collaboration | `src-tauri/src/sync/commands.rs:181` | not located by exact name | Registered, individual trace pending |

## Account command subactions

These are counted separately from their enclosing Tauri command. Action-specific API calls and error paths require individual tracing.

| Action | Dispatch | Status |
| --- | --- | --- |
| `state` | `src-tauri/src/account/commands.rs:196` | Branch located, full trace pending |
| `pageLevel` | `src-tauri/src/account/commands.rs:197` | Branch located, full trace pending |
| `pageWorkspaces` | `src-tauri/src/account/commands.rs:198` | Branch located, full trace pending |
| `setActiveWorkspace` | `src-tauri/src/account/commands.rs:199` | Branch located, full trace pending |
| `setServer` | `src-tauri/src/account/commands.rs:204` | Branch located, full trace pending |
| `emailStart` | `src-tauri/src/account/commands.rs:218` | Branch located, full trace pending |
| `emailVerify` | `src-tauri/src/account/commands.rs:223` | Branch located, full trace pending |
| `passkeySignIn` | `src-tauri/src/account/commands.rs:242` | Branch located, full trace pending |
| `passkeyAdd` | `src-tauri/src/account/commands.rs:263` | Branch located, full trace pending |
| `signOut` | `src-tauri/src/account/commands.rs:270` | Branch located, full trace pending |
| `sync` | `src-tauri/src/account/commands.rs:279` | Branch located, full trace pending |
| `me` | `src-tauri/src/account/commands.rs:290` | Branch located, full trace pending |
| `updateProfile` | `src-tauri/src/account/commands.rs:291` | Branch located, full trace pending |
| `checkUsername` | `src-tauri/src/account/commands.rs:309` | Branch located, full trace pending |
| `devices` | `src-tauri/src/account/commands.rs:315` | Branch located, full trace pending |
| `revokeDevice` | `src-tauri/src/account/commands.rs:316` | Branch located, full trace pending |
| `renameDevice` | `src-tauri/src/account/commands.rs:317` | Branch located, full trace pending |
| `passkeys` | `src-tauri/src/account/commands.rs:326` | Branch located, full trace pending |
| `removePasskey` | `src-tauri/src/account/commands.rs:327` | Branch located, full trace pending |
| `createWorkspace` | `src-tauri/src/account/commands.rs:330` | Branch located, full trace pending |
| `renameWorkspace` | `src-tauri/src/account/commands.rs:338` | Branch located, full trace pending |
| `deleteWorkspace` | `src-tauri/src/account/commands.rs:344` | Branch located, full trace pending |
| `invitePreview` | `src-tauri/src/account/commands.rs:350` | Branch located, full trace pending |
| `join` | `src-tauri/src/account/commands.rs:354` | Branch located, full trace pending |
| `members` | `src-tauri/src/account/commands.rs:367` | Branch located, full trace pending |
| `setRole` | `src-tauri/src/account/commands.rs:375` | Branch located, full trace pending |
| `removeMember` | `src-tauri/src/account/commands.rs:381` | Branch located, full trace pending |
| `leave` | `src-tauri/src/account/commands.rs:386` | Branch located, full trace pending |
| `transfer` | `src-tauri/src/account/commands.rs:392` | Branch located, full trace pending |
| `groups` | `src-tauri/src/account/commands.rs:399` | Branch located, full trace pending |
| `createGroup` | `src-tauri/src/account/commands.rs:400` | Branch located, full trace pending |
| `deleteGroup` | `src-tauri/src/account/commands.rs:409` | Branch located, full trace pending |
| `setGroupMembers` | `src-tauri/src/account/commands.rs:418` | Branch located, full trace pending |
| `invites` | `src-tauri/src/account/commands.rs:430` | Branch located, full trace pending |
| `createInvite` | `src-tauri/src/account/commands.rs:434` | Branch located, full trace pending |
| `revokeInvite` | `src-tauri/src/account/commands.rs:441` | Branch located, full trace pending |
| `audit` | `src-tauri/src/account/commands.rs:450` | Branch located, full trace pending |
| `pageSharing` | `src-tauri/src/account/commands.rs:455` | Branch located, full trace pending |
| `setPagePermission` | `src-tauri/src/account/commands.rs:482` | Branch located, full trace pending |
| `removePagePermission` | `src-tauri/src/account/commands.rs:490` | Branch located, full trace pending |
| `setPageInherit` | `src-tauri/src/account/commands.rs:502` | Branch located, full trace pending |
| `movePage` | `src-tauri/src/account/commands.rs:511` | Branch located, full trace pending |

## MCP tool declarations

Descriptions are copied from source declarations as discovery aids, not claims of tested behavior. Permission checks, storage effects, external actions, and errors must be verified at the dispatcher and downstream function.

| Tool | Source description | Declaration | Handler candidate | Status |
| --- | --- | --- | --- | --- |
| `pages_search` | Full-text search page titles and content (Arabic and English). | `src-tauri/src/mcp.rs:124` | `src-tauri/src/mcp.rs:208` | Declared, full trace pending |
| `pages_list` | List pages as a tree (id, title, parent, flags). Use parentId to list one branch. | `src-tauri/src/mcp.rs:125` | `src-tauri/src/mcp.rs:218` | Declared, full trace pending |
| `pages_read` | Read a page: metadata, assistant instructions, blocks (id, type, markdown), subpages and backlinks. | `src-tauri/src/mcp.rs:126` | `src-tauri/src/mcp.rs:234` | Declared, full trace pending |
| `pages_create` | Create a page (optionally inside a parent) with initial Markdown content. | `src-tauri/src/mcp.rs:127` | `src-tauri/src/mcp.rs:254` | Declared, full trace pending |
| `pages_rename` | Rename a page. | `src-tauri/src/mcp.rs:128` | `src-tauri/src/mcp.rs:268` | Declared, full trace pending |
| `pages_move` | Move a page under another parent (omit parentId for top level), optionally before a sibling. | `src-tauri/src/mcp.rs:129` | `src-tauri/src/mcp.rs:277` | Declared, full trace pending |
| `pages_archive` | Archive or unarchive a page. | `src-tauri/src/mcp.rs:130` | `src-tauri/src/mcp.rs:281` | Declared, full trace pending |
| `blocks_read` | Read blocks of a page, or one block by id. | `src-tauri/src/mcp.rs:131` | `src-tauri/src/mcp.rs:286` | Declared, full trace pending |
| `blocks_insert` | Insert new blocks (parsed from Markdown) after a block, or at the end when afterBlockId is omitted. Use afterBlockId:'start' to insert at the top. | `src-tauri/src/mcp.rs:132` | `src-tauri/src/mcp.rs:294` | Declared, full trace pending |
| `blocks_update` | Replace one block's content. If the Markdown yields several blocks, the first replaces the block and the rest are inserted after it. | `src-tauri/src/mcp.rs:133` | `src-tauri/src/mcp.rs:313` | Declared, full trace pending |
| `blocks_move` | Move a block after another block (omit afterBlockId to move to the top). | `src-tauri/src/mcp.rs:134` | `src-tauri/src/mcp.rs:335` | Declared, full trace pending |
| `blocks_delete` | Delete one block. | `src-tauri/src/mcp.rs:135` | `src-tauri/src/mcp.rs:339` | Declared, full trace pending |
| `references_search` | Pages that mention or link to a page (backlinks) and pages it references. | `src-tauri/src/mcp.rs:136` | `src-tauri/src/mcp.rs:343` | Declared, full trace pending |
| `references_resolve` | Find page ids by (partial) title, to build @[Title](page:ID) mentions. | `src-tauri/src/mcp.rs:137` | `src-tauri/src/mcp.rs:359` | Declared, full trace pending |
| `attachments_add` | Attach a picture, video, audio file or document from the user's Desktop, Downloads, Documents, Pictures, Videos or Music folders to a page and append it as a block. Other locations and program files are refused. | `src-tauri/src/mcp.rs:138` | `src-tauri/src/mcp.rs:367` | Declared, full trace pending |
| `attachments_insert` | Place an existing Worlds attachment (for example a file the user attached in chat) into a page as an image, video or file block. | `src-tauri/src/mcp.rs:139` | `src-tauri/src/mcp.rs:384` | Declared, full trace pending |
| `attachments_read_metadata` | List attachment metadata for a page. | `src-tauri/src/mcp.rs:140` | `src-tauri/src/mcp.rs:403` | Declared, full trace pending |
| `templates_list` | List templates. | `src-tauri/src/mcp.rs:141` | `src-tauri/src/mcp.rs:407` | Declared, full trace pending |
| `templates_instantiate` | Create a new page from a template. | `src-tauri/src/mcp.rs:142` | `src-tauri/src/mcp.rs:415` | Declared, full trace pending |
| `automations_list` | List automations with their schedules and last status. | `src-tauri/src/mcp.rs:143` | `src-tauri/src/mcp.rs:419` | Declared, full trace pending |
| `automations_create` | Create a scheduled automation that renders a page and sends it to Discord through the bridge. Runs created by Claude always wait for the user's approval. | `src-tauri/src/mcp.rs:144` | `src-tauri/src/mcp.rs:420` | Declared, full trace pending |
| `automations_update` | Change an automation's name, trigger, destination or enabled state. | `src-tauri/src/mcp.rs:149` | `src-tauri/src/mcp.rs:441` | Declared, full trace pending |
| `automations_run` | Request a run of an automation now. The user approves the preview in Worlds before anything is sent. | `src-tauri/src/mcp.rs:150` | `src-tauri/src/mcp.rs:463` | Declared, full trace pending |
| `discord_inspect` | Known Discord servers, channels, threads and the bridge bot state (from the last refresh in Worlds). | `src-tauri/src/mcp.rs:151` | `src-tauri/src/mcp.rs:479` | Declared, full trace pending |
| `discord_preview` | Render a page as a Discord Components V2 message and report limit warnings. Sends nothing. | `src-tauri/src/mcp.rs:152` | `src-tauri/src/mcp.rs:484` | Declared, full trace pending |
| `discord_send` | Queue a page to be sent to Discord through the bridge. Nothing is sent until the user approves the preview in Worlds. | `src-tauri/src/mcp.rs:153` | `src-tauri/src/mcp.rs:493` | Declared, full trace pending |
| `discord_edit` | Queue an edit of a Discord message previously sent by Worlds, re-rendered from the page. Requires user approval. | `src-tauri/src/mcp.rs:154` | `src-tauri/src/mcp.rs:493` | Declared, full trace pending |
| `profile_read` | The local profile (owner of all pages). | `src-tauri/src/mcp.rs:155` | `src-tauri/src/mcp.rs:522` | Declared, full trace pending |
| `history_read` | Recent history for a page (or everywhere). | `src-tauri/src/mcp.rs:156` | `src-tauri/src/mcp.rs:529` | Declared, full trace pending |
| `instructions_read` | Global assistant instructions and, if given, the page's instructions. | `src-tauri/src/mcp.rs:157` | `src-tauri/src/mcp.rs:536` | Declared, full trace pending |
| `instructions_update` | Replace the assistant instructions, either global (scope 'global') or for one page (scope 'page' with pageId). Only do this when the user asks. | `src-tauri/src/mcp.rs:158` | `src-tauri/src/mcp.rs:544` | Declared, full trace pending |
| `profile_update` | Update the user's local profile. Only change fields the user asked about. | `src-tauri/src/mcp.rs:162` | `src-tauri/src/mcp.rs:582` | Declared, full trace pending |
| `pages_set_icon` | Set or clear a page's emoji icon. | `src-tauri/src/mcp.rs:170` | `src-tauri/src/mcp.rs:624` | Declared, full trace pending |
| `pages_pin` | Pin or unpin a page (pinned pages sit at the top of the sidebar and Home). | `src-tauri/src/mcp.rs:171` | `src-tauri/src/mcp.rs:629` | Declared, full trace pending |
| `pages_favorite` | Mark or unmark a page as a favourite. | `src-tauri/src/mcp.rs:172` | `src-tauri/src/mcp.rs:634` | Declared, full trace pending |
| `pages_duplicate` | Duplicate a page (with its subpages by default). Returns the new page id. | `src-tauri/src/mcp.rs:173` | `src-tauri/src/mcp.rs:639` | Declared, full trace pending |
| `pages_delete` | Move a page and its subpages to Trash (restorable). Only when the user asks to delete. | `src-tauri/src/mcp.rs:174` | `src-tauri/src/mcp.rs:644` | Declared, full trace pending |
| `pages_restore` | Restore a page from Trash. | `src-tauri/src/mcp.rs:175` | `src-tauri/src/mcp.rs:648` | Declared, full trace pending |
| `trash_list` | Pages currently in Trash. | `src-tauri/src/mcp.rs:176` | `src-tauri/src/mcp.rs:652` | Declared, full trace pending |
| `pages_replace_content` | Replace the entire content of a page with new Markdown. Use for full rewrites or restructuring; prefer blocks_update for small edits. A version is kept, so this is undoable. | `src-tauri/src/mcp.rs:177` | `src-tauri/src/mcp.rs:660` | Declared, full trace pending |
| `templates_create_from_page` | Save a copy of a page (and its subpages) as a reusable template. | `src-tauri/src/mcp.rs:178` | `src-tauri/src/mcp.rs:665` | Declared, full trace pending |
| `chats_search` | Find earlier conversations with Claude in Worlds by title or content. Empty query lists the most recent. | `src-tauri/src/mcp.rs:179` | `src-tauri/src/mcp.rs:669` | Declared, full trace pending |
| `chats_read` | Read an earlier conversation (by chatId, or by title when the user names it). | `src-tauri/src/mcp.rs:180` | `src-tauri/src/mcp.rs:694` | Declared, full trace pending |
| `pages_set_properties` | Replace a page's properties (typed fields under the title, used by collection views). Read the page first and send the full list back with your change. | `src-tauri/src/mcp.rs:181` | `src-tauri/src/mcp.rs:619` | Declared, full trace pending |
| `automations_delete` | Delete an automation (the source page is untouched). Only when the user asks. | `src-tauri/src/mcp.rs:185` | `src-tauri/src/mcp.rs:710` | Declared, full trace pending |
| `workspace_overview` | A snapshot of the whole workspace: counts, pinned and favourite pages, recently edited pages, automations, the owner, and the current local date and time. Call this first when you need orientation. | `src-tauri/src/mcp/more.rs:19` | `src-tauri/src/mcp/page_content.rs:14` | Declared, full trace pending |
| `time_now` | Current local date, time, weekday and UTC offset on this PC. Use it before scheduling or writing dates. | `src-tauri/src/mcp/more.rs:20` | `src-tauri/src/mcp/page_content.rs:13` | Declared, full trace pending |
| `pages_query` | Find pages by structure and properties: parent, title text, a property value, a tag, a status, recent edits. Returns ids, titles, parents and properties. | `src-tauri/src/mcp/more.rs:21` | `src-tauri/src/mcp/page_content.rs:38` | Declared, full trace pending |
| `pages_tree` | The subtree under a page (or the whole workspace) with depth, icons and properties. | `src-tauri/src/mcp/more.rs:34` | `src-tauri/src/mcp/page_content.rs:94` | Declared, full trace pending |
| `pages_export_markdown` | A page's full content as Markdown (title first). Best way to read a long page in one go. | `src-tauri/src/mcp/more.rs:35` | `src-tauri/src/mcp/page_content.rs:109` | Declared, full trace pending |
| `pages_outline` | Headings of a page with their block ids, for navigating long pages. | `src-tauri/src/mcp/more.rs:36` | `src-tauri/src/mcp/page_content.rs:115` | Declared, full trace pending |
| `pages_append_markdown` | Add content at the end of a page. | `src-tauri/src/mcp/more.rs:37` | `src-tauri/src/mcp/page_content.rs:136` | Declared, full trace pending |
| `pages_find_text` | Find blocks containing some text, in one page or across all pages. Returns block ids with excerpts. | `src-tauri/src/mcp/more.rs:38` | `src-tauri/src/mcp/page_content.rs:143` | Declared, full trace pending |
| `pages_replace_text` | Find and replace text inside a page, keeping formatting. Returns how many replacements were made. Undoable. | `src-tauri/src/mcp/more.rs:39` | `src-tauri/src/mcp/page_content.rs:173` | Declared, full trace pending |
| `pages_backlinks` | Pages that mention or link to this page. | `src-tauri/src/mcp/more.rs:40` | `src-tauri/src/mcp/page_content.rs:194` | Declared, full trace pending |
| `pages_set_cover` | Set, change or clear a page's cover image: an attachment id, a local file path, or clear. | `src-tauri/src/mcp/more.rs:41` | `src-tauri/src/mcp/page_content.rs:195` | Declared, full trace pending |
| `pages_set_style` | Page presentation: font (default, serif, mono), small text, full width. | `src-tauri/src/mcp/more.rs:42` | `src-tauri/src/mcp/page_content.rs:210` | Declared, full trace pending |
| `pages_create_many` | Create several pages at once under a parent (for lists of tasks, notes, people). Each item can have an icon, Markdown content and properties. | `src-tauri/src/mcp/more.rs:43` | `src-tauri/src/mcp/page_content.rs:225` | Declared, full trace pending |
| `pages_bulk` | Apply one action to many pages: move, archive, unarchive, pin, unpin, favorite, unfavorite, tag, untag, set_property, set_icon, delete (to Trash). Only when the user asked. | `src-tauri/src/mcp/more.rs:50` | `src-tauri/src/mcp/page_content.rs:257` | Declared, full trace pending |
| `blocks_insert_layout` | Insert a layout block: columns (2 or 3 columns of Markdown), a toggle (collapsible section with a summary line and hidden content), or a collection (a live table, board, gallery or list of subpages or tagged pages). | `src-tauri/src/mcp/more.rs:59` | `src-tauri/src/mcp/page_content.rs:332` | Declared, full trace pending |
| `profile_blocks_add` | Add a Profile Block (widget) to the user's profile. See profile_update for the block format. Returns the new block id. | `src-tauri/src/mcp/more.rs:73` | `src-tauri/src/mcp/profile_history.rs:12` | Declared, full trace pending |
| `profile_blocks_update` | Change fields of one Profile Block by id (merged into the block). | `src-tauri/src/mcp/more.rs:74` | `src-tauri/src/mcp/profile_history.rs:35` | Declared, full trace pending |
| `profile_blocks_remove` | Remove one Profile Block by id. Only when the user asked. | `src-tauri/src/mcp/more.rs:75` | `src-tauri/src/mcp/profile_history.rs:48` | Declared, full trace pending |
| `profile_blocks_move` | Move a Profile Block to a new position (0 is first; the first three are featured). | `src-tauri/src/mcp/more.rs:76` | `src-tauri/src/mcp/profile_history.rs:59` | Declared, full trace pending |
| `profile_set_image` | Set the avatar or banner from an attachment id or a local file path, optionally with a crop \"x,y,zoom\". | `src-tauri/src/mcp/more.rs:77` | `src-tauri/src/mcp/profile_history.rs:69` | Declared, full trace pending |
| `versions_list` | Saved versions of a page (snapshots before big changes), newest first. | `src-tauri/src/mcp/more.rs:78` | `src-tauri/src/mcp/profile_history.rs:92` | Declared, full trace pending |
| `versions_restore` | Restore a page to a saved version (the current state is kept as a version too). Only when the user asked. | `src-tauri/src/mcp/more.rs:79` | `src-tauri/src/mcp/profile_history.rs:93` | Declared, full trace pending |
| `history_undo` | Undo an earlier change by its op id (from history_read). Only when the user asked. | `src-tauri/src/mcp/more.rs:80` | `src-tauri/src/mcp/profile_history.rs:94` | Declared, full trace pending |
| `attachments_list` | Files on a page, or the most recent images, GIFs and videos across the workspace. | `src-tauri/src/mcp/more.rs:81` | `src-tauri/src/mcp/profile_history.rs:95` | Declared, full trace pending |
| `automations_runs` | Recent runs of an automation with status, times and errors. | `src-tauri/src/mcp/more.rs:82` | `src-tauri/src/mcp/profile_history.rs:99` | Declared, full trace pending |
| `tasks_list` | Checklist items across the workspace or one page, with their page, block id, index and state. Use it for to-do overviews. | `src-tauri/src/mcp/more2.rs:31` | `src-tauri/src/mcp/tasks_tables.rs:14` | Declared, full trace pending |
| `tasks_set` | Check or uncheck a checklist item, by its block id plus index (from tasks_list) or by matching its text. | `src-tauri/src/mcp/more2.rs:32` | `src-tauri/src/mcp/tasks_tables.rs:47` | Declared, full trace pending |
| `tasks_add` | Add checklist items to a page (at the end, or after a block). | `src-tauri/src/mcp/more2.rs:33` | `src-tauri/src/mcp/tasks_tables.rs:90` | Declared, full trace pending |
| `tasks_clear_done` | Remove completed checklist items from a page. Only when the user asked. Undoable. | `src-tauri/src/mcp/more2.rs:34` | `src-tauri/src/mcp/tasks_tables.rs:106` | Declared, full trace pending |
| `tables_read` | Every table on a page as rows of cell text, with block ids. | `src-tauri/src/mcp/more2.rs:36` | `src-tauri/src/mcp/tasks_tables.rs:131` | Declared, full trace pending |
| `tables_append_row` | Append a row to a table block. | `src-tauri/src/mcp/more2.rs:37` | `src-tauri/src/mcp/tasks_tables.rs:139` | Declared, full trace pending |
| `tables_update_cell` | Set the text of one table cell (row and column start at 0; row 0 is the header). | `src-tauri/src/mcp/more2.rs:38` | `src-tauri/src/mcp/tasks_tables.rs:156` | Declared, full trace pending |
| `tables_from_csv` | Insert a table built from CSV text (first row becomes the header). | `src-tauri/src/mcp/more2.rs:39` | `src-tauri/src/mcp/tasks_tables.rs:170` | Declared, full trace pending |
| `tables_to_csv` | A table block as CSV text. | `src-tauri/src/mcp/more2.rs:40` | `src-tauri/src/mcp/tasks_tables.rs:188` | Declared, full trace pending |
| `blocks_list_by_type` | Blocks of one type on a page (heading, paragraph, bulletList, orderedList, taskList, table, image, video, file, codeBlock, callout, blockquote, columns, toggle, collection, pageLink, embed). | `src-tauri/src/mcp/more2.rs:42` | `src-tauri/src/mcp/tasks_tables.rs:198` | Declared, full trace pending |
| `blocks_duplicate` | Duplicate a block right after itself. | `src-tauri/src/mcp/more2.rs:43` | `src-tauri/src/mcp/tasks_tables.rs:207` | Declared, full trace pending |
| `blocks_copy_to_page` | Copy blocks to another page (at the end, or after a block there). | `src-tauri/src/mcp/more2.rs:44` | `src-tauri/src/mcp/tasks_tables.rs:211` | Declared, full trace pending |
| `blocks_move_to_page` | Move blocks to another page (copied there, removed here). Undoable. | `src-tauri/src/mcp/more2.rs:45` | `src-tauri/src/mcp/tasks_tables.rs:211` | Declared, full trace pending |
| `blocks_convert` | Turn a block into another kind while keeping its text: paragraph, heading1, heading2, heading3, bullet, numbered, todo, quote, callout, code. | `src-tauri/src/mcp/more2.rs:46` | `src-tauri/src/mcp/tasks_tables.rs:238` | Declared, full trace pending |
| `blocks_set_direction` | Force a block's text direction: rtl for Arabic, ltr for English, auto to follow the first letter. | `src-tauri/src/mcp/more2.rs:47` | `src-tauri/src/mcp/tasks_tables.rs:258` | Declared, full trace pending |
| `pages_stats` | Numbers for a page: words, characters, reading time, blocks by type, headings, open and done tasks, tables, images, links, attachments, dates. | `src-tauri/src/mcp/more2.rs:49` | `src-tauri/src/mcp/page_structure.rs:17` | Declared, full trace pending |
| `pages_links` | What a page points to: page mentions, subpage links and web links. | `src-tauri/src/mcp/more2.rs:50` | `src-tauri/src/mcp/page_structure.rs:50` | Declared, full trace pending |
| `pages_recent` | Recently opened or edited pages. | `src-tauri/src/mcp/more2.rs:51` | `src-tauri/src/mcp/page_structure.rs:60` | Declared, full trace pending |
| `pages_stale` | Pages not edited for a number of days (default 60), oldest first. Good for clean-up suggestions. | `src-tauri/src/mcp/more2.rs:52` | `src-tauri/src/mcp/page_structure.rs:75` | Declared, full trace pending |
| `pages_reorder_children` | Put a parent's subpages (or top-level pages) in an exact order. | `src-tauri/src/mcp/more2.rs:53` | `src-tauri/src/mcp/page_structure.rs:86` | Declared, full trace pending |
| `pages_sort_children` | Sort a parent's subpages by title, created, updated, or a property. | `src-tauri/src/mcp/more2.rs:54` | `src-tauri/src/mcp/page_structure.rs:94` | Declared, full trace pending |
| `pages_merge` | Append the content of several pages into one target page (each under its title as a heading), optionally archiving the sources. | `src-tauri/src/mcp/more2.rs:55` | `src-tauri/src/mcp/page_structure.rs:125` | Declared, full trace pending |
| `pages_split_by_headings` | Split a long page: every heading of a level becomes a subpage holding its section, and a link to it stays in place of the moved content. | `src-tauri/src/mcp/more2.rs:56` | `src-tauri/src/mcp/page_structure.rs:154` | Declared, full trace pending |
| `pages_insert_toc` | Insert a table of contents (a nested list of the page's headings) at the top or after a block. | `src-tauri/src/mcp/more2.rs:57` | `src-tauri/src/mcp/page_structure.rs:205` | Declared, full trace pending |
| `pages_rename_many` | Rename several pages at once: find and replace in titles, or add a prefix or suffix. | `src-tauri/src/mcp/more2.rs:58` | `src-tauri/src/mcp/page_structure.rs:234` | Declared, full trace pending |
| `archive_list` | Archived pages. | `src-tauri/src/mcp/more2.rs:59` | `src-tauri/src/mcp/page_structure.rs:265` | Declared, full trace pending |
| `properties_schema` | The properties used across a set of pages: names, types, options and how many pages fill each. | `src-tauri/src/mcp/more2.rs:61` | `src-tauri/src/mcp/page_structure.rs:274` | Declared, full trace pending |
| `properties_rename` | Rename a property across a set of pages. | `src-tauri/src/mcp/more2.rs:62` | `src-tauri/src/mcp/page_structure.rs:297, src-tauri/src/mcp/page_structure.rs:305` | Declared, full trace pending |
| `properties_remove` | Remove a property from a set of pages. Only when the user asked. | `src-tauri/src/mcp/more2.rs:63` | `src-tauri/src/mcp/page_structure.rs:297, src-tauri/src/mcp/page_structure.rs:311` | Declared, full trace pending |
| `properties_set_options` | Set the options (and colours) of a select, status or tags property across a set of pages. | `src-tauri/src/mcp/more2.rs:64` | `src-tauri/src/mcp/page_structure.rs:297` | Declared, full trace pending |
| `collections_list` | Collection blocks (live tables, boards, galleries) on a page with their settings. | `src-tauri/src/mcp/more2.rs:65` | `src-tauri/src/mcp/page_structure.rs:326` | Declared, full trace pending |
| `collections_update` | Change a collection block: view, source, tag, groupBy, sortBy, sortDir, filter, title. | `src-tauri/src/mcp/more2.rs:66` | `src-tauri/src/mcp/page_structure.rs:334` | Declared, full trace pending |
| `versions_diff` | What changed between a saved version and the page now: lines added and removed. | `src-tauri/src/mcp/more2.rs:68` | `src-tauri/src/mcp/workspace.rs:15` | Declared, full trace pending |
| `templates_read` | A template's content as Markdown. | `src-tauri/src/mcp/more2.rs:70` | `src-tauri/src/mcp/workspace.rs:43` | Declared, full trace pending |
| `templates_update` | Rename a template or change its category. | `src-tauri/src/mcp/more2.rs:71` | `src-tauri/src/mcp/workspace.rs:48` | Declared, full trace pending |
| `templates_delete` | Move a template to Trash. Only when the user asked. | `src-tauri/src/mcp/more2.rs:72` | `src-tauri/src/mcp/workspace.rs:59` | Declared, full trace pending |
| `automations_read` | One automation in full: trigger, source page, destination, options, next and last run. | `src-tauri/src/mcp/more2.rs:74` | `src-tauri/src/mcp/workspace.rs:64` | Declared, full trace pending |
| `automations_toggle` | Turn an automation on or off. | `src-tauri/src/mcp/more2.rs:75` | `src-tauri/src/mcp/workspace.rs:65` | Declared, full trace pending |
| `automations_upcoming` | The next scheduled runs across all enabled automations, soonest first. | `src-tauri/src/mcp/more2.rs:76` | `src-tauri/src/mcp/workspace.rs:80` | Declared, full trace pending |
| `chats_list` | Recent conversations with Claude (titles, ids, linked page). | `src-tauri/src/mcp/more2.rs:78` | `src-tauri/src/mcp/workspace.rs:88` | Declared, full trace pending |
| `chats_rename` | Rename a conversation. | `src-tauri/src/mcp/more2.rs:79` | `src-tauri/src/mcp/workspace.rs:94` | Declared, full trace pending |
| `chats_delete` | Delete a conversation and its messages. Only when the user asked; never the current one. | `src-tauri/src/mcp/more2.rs:80` | `src-tauri/src/mcp/workspace.rs:102` | Declared, full trace pending |
| `profile_blocks_list` | The profile's blocks in order, with ids and which are featured (the first three). | `src-tauri/src/mcp/more2.rs:82` | `src-tauri/src/mcp/workspace.rs:111` | Declared, full trace pending |
| `profile_links_set` | Add or remove one profile link. | `src-tauri/src/mcp/more2.rs:83` | `src-tauri/src/mcp/workspace.rs:115` | Declared, full trace pending |
| `profile_set_status` | Set or clear the short status line under the name. | `src-tauri/src/mcp/more2.rs:84` | `src-tauri/src/mcp/workspace.rs:136` | Declared, full trace pending |
| `search_everything` | One search across pages, templates, conversations, automations and file names. | `src-tauri/src/mcp/more2.rs:86` | `src-tauri/src/mcp/workspace.rs:146` | Declared, full trace pending |
| `attachments_find` | Find attached files by name across the workspace. | `src-tauri/src/mcp/more2.rs:87` | `src-tauri/src/mcp/workspace.rs:167` | Declared, full trace pending |
| `activity_summary` | What changed recently, grouped by page and by who (you, Claude, automations). | `src-tauri/src/mcp/more2.rs:88` | `src-tauri/src/mcp/workspace.rs:176` | Declared, full trace pending |
| `discord_pending` | Discord sends and edits waiting for the user's approval. | `src-tauri/src/mcp/more2.rs:90` | `src-tauri/src/mcp/workspace.rs:191` | Declared, full trace pending |
| `discord_sent` | Recently sent Discord messages from Worlds (page, destination, message id). | `src-tauri/src/mcp/more2.rs:91` | `src-tauri/src/mcp/workspace.rs:204` | Declared, full trace pending |
| `settings_read` | The app's settings: appearance, glass, transparency, motion, density, Claude model and effort, background running. | `src-tauri/src/mcp/more2.rs:93` | `src-tauri/src/mcp/workspace.rs:216` | Declared, full trace pending |
| `drawings_read` | Read a drawing's revision, editable scene, frames, layers, elements and operation journal. | `src-tauri/src/mcp/resources.rs:16` | `src-tauri/src/mcp/resources.rs:141` | Declared, full trace pending |
| `drawings_apply` | Apply one validated, revision-checked drawing operation. Read first. Uses the signed-in user's rights and retains undo history. | `src-tauri/src/mcp/resources.rs:17` | `src-tauri/src/mcp/resources.rs:149` | Declared, full trace pending |
| `drawings_versions` | List saved drawing versions. | `src-tauri/src/mcp/resources.rs:18` | `src-tauri/src/mcp/resources.rs:142` | Declared, full trace pending |
| `drawing_library_list` | List reusable drawing material visible in this drawing's personal and shared libraries. | `src-tauri/src/mcp/resources.rs:19` | `src-tauri/src/mcp/resources.rs:143` | Declared, full trace pending |
| `drawing_library_read` | Read an authorized immutable library publication, editable scene and settings. Optional version chooses an older publication. | `src-tauri/src/mcp/resources.rs:20` | `src-tauri/src/mcp/resources.rs:144` | Declared, full trace pending |
| `drawing_library_publish` | Publish reusable drawing material. Read first; updates require itemId and expectedVersion. Input includes sourceId, name, kind, scope, tags, scene and payload. Keeps originals independent. | `src-tauri/src/mcp/resources.rs:21` | `src-tauri/src/mcp/resources.rs:145` | Declared, full trace pending |
| `drawing_library_remove` | Move a library item to Trash. Inserted copies stay available. | `src-tauri/src/mcp/resources.rs:22` | `src-tauri/src/mcp/resources.rs:146` | Declared, full trace pending |
| `drawing_reference_read` | Read the current user's authorized source preview. Denied, missing and deleted sources return the same unavailable state without a title. | `src-tauri/src/mcp/resources.rs:23` | `src-tauri/src/mcp/resources.rs:147` | Declared, full trace pending |
| `drawing_region_task` | Create a real task page with a drawing region preview and return link. Requires edit on the drawing. | `src-tauri/src/mcp/resources.rs:24` | `src-tauri/src/mcp/resources.rs:148` | Declared, full trace pending |
| `resources_list` | List resources of any kind (page, document, presentation, project, gallery, file, stream) with id, title, kind and parent. Optional filters: kind, parentId. | `src-tauri/src/mcp/resources.rs:25` | `src-tauri/src/mcp/resources.rs:154` | Declared, full trace pending |
| `resources_create` | Create a resource: kind is document, presentation, project, gallery or stream (pages use pages_create; files use files_add). For a stream give url. Returns the new id. | `src-tauri/src/mcp/resources.rs:31` | `src-tauri/src/mcp/resources.rs:168` | Declared, full trace pending |
| `presentations_read` | Read a presentation: every slide with its index, layout, the text of each element, and speaker notes. | `src-tauri/src/mcp/resources.rs:37` | `src-tauri/src/mcp/resources.rs:221` | Declared, full trace pending |
| `presentations_add_slide` | Add a slide. layout: title, title-body, section, two-columns, image or blank. title/body/notes fill the layout's placeholders. after: slide index to insert after (default: end). | `src-tauri/src/mcp/resources.rs:43` | `src-tauri/src/mcp/resources.rs:238` | Declared, full trace pending |
| `presentations_update_slide` | Change a slide's title, body text or speaker notes (by 0-based index). | `src-tauri/src/mcp/resources.rs:49` | `src-tauri/src/mcp/resources.rs:256` | Declared, full trace pending |
| `galleries_add` | Add pictures or videos from the user's personal folders (Desktop, Downloads, Documents, Pictures, Videos, Music) to a gallery, in order. | `src-tauri/src/mcp/resources.rs:55` | `src-tauri/src/mcp/resources.rs:292` | Declared, full trace pending |
| `files_add` | Add a file from the user's personal folders to Worlds as its own File resource (optionally inside a project or page). | `src-tauri/src/mcp/resources.rs:61` | `src-tauri/src/mcp/resources.rs:318` | Declared, full trace pending |
| `projects_update` | Update a project's status (planned, active, paused, done), start or due date (YYYY-MM-DD), or description. | `src-tauri/src/mcp/resources.rs:67` | `src-tauri/src/mcp/resources.rs:343` | Declared, full trace pending |
| `projects_link` | Link an existing resource to a project without moving it (unlink: true removes the link). To move a resource into a project use pages_move. | `src-tauri/src/mcp/resources.rs:73` | `src-tauri/src/mcp/resources.rs:361` | Declared, full trace pending |

## Identity HTTP route registrations

The handler file contains route-specific validation, authorization and data operations. A registration does not prove production deployment or a successful request.

| Method | Path | Registration | Auth context | Status |
| --- | --- | --- | --- | --- |
| GET | `/auth/username/:name` | `services/identity/src/routes/auth.ts:60` | route-specific | Registered, full trace pending |
| POST | `/auth/email/start` | `services/identity/src/routes/auth.ts:72` | route-specific | Registered, full trace pending |
| POST | `/auth/email/verify` | `services/identity/src/routes/auth.ts:90` | route-specific | Registered, full trace pending |
| POST | `/auth/passkey/ticket` | `services/identity/src/routes/auth.ts:184` | route-specific | Registered, full trace pending |
| POST | `/auth/passkey/register/options` | `services/identity/src/routes/auth.ts:194` | route-specific | Registered, full trace pending |
| POST | `/auth/passkey/register/verify` | `services/identity/src/routes/auth.ts:210` | route-specific | Registered, full trace pending |
| POST | `/auth/passkey/login/options` | `services/identity/src/routes/auth.ts:234` | route-specific | Registered, full trace pending |
| POST | `/auth/passkey/login/verify` | `services/identity/src/routes/auth.ts:246` | route-specific | Registered, full trace pending |
| POST | `/auth/token` | `services/identity/src/routes/auth.ts:283` | route-specific | Registered, full trace pending |
| POST | `/auth/refresh` | `services/identity/src/routes/auth.ts:299` | route-specific | Registered, full trace pending |
| POST | `/auth/logout` | `services/identity/src/routes/auth.ts:316` | route-specific | Registered, full trace pending |
| GET | `/me` | `services/identity/src/routes/me.ts:13` | middleware | Registered, full trace pending |
| PATCH | `/me` | `services/identity/src/routes/me.ts:19` | middleware | Registered, full trace pending |
| GET | `/me/devices` | `services/identity/src/routes/me.ts:44` | middleware | Registered, full trace pending |
| PATCH | `/me/devices/:id` | `services/identity/src/routes/me.ts:56` | middleware | Registered, full trace pending |
| DELETE | `/me/devices/:id` | `services/identity/src/routes/me.ts:66` | middleware | Registered, full trace pending |
| GET | `/me/passkeys` | `services/identity/src/routes/me.ts:73` | middleware | Registered, full trace pending |
| DELETE | `/me/passkeys/:id` | `services/identity/src/routes/me.ts:80` | middleware | Registered, full trace pending |
| GET | `/me/audit` | `services/identity/src/routes/me.ts:90` | middleware | Registered, full trace pending |
| POST | `/workspaces` | `services/identity/src/routes/workspaces.ts:61` | middleware, route-specific role | Registered, full trace pending |
| GET | `/workspaces` | `services/identity/src/routes/workspaces.ts:80` | middleware, route-specific role | Registered, full trace pending |
| GET | `/workspaces/:id` | `services/identity/src/routes/workspaces.ts:93` | middleware, route-specific role | Registered, full trace pending |
| PATCH | `/workspaces/:id` | `services/identity/src/routes/workspaces.ts:98` | middleware, route-specific role | Registered, full trace pending |
| DELETE | `/workspaces/:id` | `services/identity/src/routes/workspaces.ts:116` | middleware, route-specific role | Registered, full trace pending |
| GET | `/workspaces/:id/members` | `services/identity/src/routes/workspaces.ts:133` | middleware, route-specific role | Registered, full trace pending |
| PATCH | `/workspaces/:id/members/:userId` | `services/identity/src/routes/workspaces.ts:146` | middleware, route-specific role | Registered, full trace pending |
| DELETE | `/workspaces/:id/members/:userId` | `services/identity/src/routes/workspaces.ts:180` | middleware, route-specific role | Registered, full trace pending |
| POST | `/workspaces/:id/leave` | `services/identity/src/routes/workspaces.ts:197` | middleware, route-specific role | Registered, full trace pending |
| POST | `/workspaces/:id/transfer` | `services/identity/src/routes/workspaces.ts:204` | middleware, route-specific role | Registered, full trace pending |
| GET | `/workspaces/:id/groups` | `services/identity/src/routes/workspaces.ts:233` | middleware, route-specific role | Registered, full trace pending |
| POST | `/workspaces/:id/groups` | `services/identity/src/routes/workspaces.ts:245` | middleware, route-specific role | Registered, full trace pending |
| PATCH | `/workspaces/:id/groups/:gid` | `services/identity/src/routes/workspaces.ts:269` | middleware, route-specific role | Registered, full trace pending |
| DELETE | `/workspaces/:id/groups/:gid` | `services/identity/src/routes/workspaces.ts:280` | middleware, route-specific role | Registered, full trace pending |
| PUT | `/workspaces/:id/groups/:gid/members` | `services/identity/src/routes/workspaces.ts:301` | middleware, route-specific role | Registered, full trace pending |
| POST | `/workspaces/:id/invites` | `services/identity/src/routes/workspaces.ts:340` | middleware, route-specific role | Registered, full trace pending |
| GET | `/workspaces/:id/invites` | `services/identity/src/routes/workspaces.ts:394` | middleware, route-specific role | Registered, full trace pending |
| DELETE | `/workspaces/:id/invites/:inviteId` | `services/identity/src/routes/workspaces.ts:428` | middleware, route-specific role | Registered, full trace pending |
| GET | `/invites/:token` | `services/identity/src/routes/workspaces.ts:484` | route-specific | Registered, full trace pending |
| POST | `/invites/:token/accept` | `services/identity/src/routes/workspaces.ts:501` | route-specific | Registered, full trace pending |
| PUT | `/workspaces/:id/tree` | `services/identity/src/routes/workspaces.ts:545` | middleware, route-specific role | Registered, full trace pending |
| GET | `/workspaces/:id/access` | `services/identity/src/routes/workspaces.ts:635` | middleware, route-specific role | Registered, full trace pending |
| GET | `/workspaces/:id/pages/:pageId/permissions` | `services/identity/src/routes/workspaces.ts:661` | middleware, route-specific role | Registered, full trace pending |
| PUT | `/workspaces/:id/pages/:pageId/permissions` | `services/identity/src/routes/workspaces.ts:712` | middleware, route-specific role | Registered, full trace pending |
| DELETE | `/workspaces/:id/pages/:pageId/permissions/:type/:principalId` | `services/identity/src/routes/workspaces.ts:739` | middleware, route-specific role | Registered, full trace pending |
| PATCH | `/workspaces/:id/pages/:pageId` | `services/identity/src/routes/workspaces.ts:760` | middleware, route-specific role | Registered, full trace pending |
| GET | `/workspaces/:id/audit` | `services/identity/src/routes/workspaces.ts:786` | middleware, route-specific role | Registered, full trace pending |
| GET | `/passkey` | `services/identity/src/routes/pages.ts:86` | browser route | Registered, full trace pending |
| GET | `/join/:token` | `services/identity/src/routes/pages.ts:99` | browser route | Registered, full trace pending |
| GET | `/` | `services/identity/src/index.ts:30` | public discovery | Registered, full trace pending |
| GET | `/.well-known/jwks.json` | `services/identity/src/index.ts:31` | public discovery | Registered, full trace pending |

## Sync Worker route families

Access level, body validation, return statuses and Durable Object calls must be checked per method in the source. Signed blob paths use their capability signature; internal endpoints use separate secrets.

| Methods | Path | Branch | Status |
| --- | --- | --- | --- |
| GET | `/health` | `services/sync/src/index.ts:62` | Branch located, full trace pending |
| POST | `/internal/revoke` | `services/sync/src/index.ts:65` | Branch located, full trace pending |
| POST | `/internal/events` | `services/sync/src/index.ts:80` | Branch located, full trace pending |
| GET, HEAD, PUT | `/v1/blobs/:ws/:hash` | `services/sync/src/index.ts:99` | Branch located, full trace pending |
| PUT | `/v1/blobs/:ws/:hash/parts/:n` | `services/sync/src/index.ts:103` | Branch located, full trace pending |
| GET | `/v1/notifications` | `services/sync/src/index.ts:114` | Branch located, full trace pending |
| POST | `/v1/notifications/read` | `services/sync/src/index.ts:121` | Branch located, full trace pending |
| GET, PUT | `/v1/workspaces/:ws/docs/:doc/drawing/export-policy` | `services/sync/src/index.ts:140` | Branch located, full trace pending |
| POST | `/v1/workspaces/:ws/docs/:doc/drawing/export-authorize` | `services/sync/src/index.ts:140` | Branch located, full trace pending |
| GET, PUT | `/v1/workspaces/:ws/docs/:doc/drawing/state` | `services/sync/src/index.ts:148` | Branch located, full trace pending |
| POST | `/v1/workspaces/:ws/docs/:doc/drawing/operations` | `services/sync/src/index.ts:159` | Branch located, full trace pending |
| GET, POST | `/v1/workspaces/:ws/docs/:doc/drawing/leases` | `services/sync/src/index.ts:165` | Branch located, full trace pending |
| GET | `/v1/workspaces/:ws/docs/:doc/sync` | `services/sync/src/index.ts:175` | Branch located, full trace pending |
| GET | `/v1/workspaces/:ws/docs/:doc/state` | `services/sync/src/index.ts:189` | Branch located, full trace pending |
| GET, POST | `/v1/workspaces/:ws/docs/:doc/versions` | `services/sync/src/index.ts:195` | Branch located, full trace pending |
| GET | `/v1/workspaces/:ws/docs/:doc/versions/:id` | `services/sync/src/index.ts:204` | Branch located, full trace pending |
| POST | `/v1/workspaces/:ws/docs/:doc/attachments/uploads` | `services/sync/src/index.ts:210` | Branch located, full trace pending |
| POST | `/v1/workspaces/:ws/docs/:doc/attachments/uploads/:hash/complete` | `services/sync/src/index.ts:215` | Branch located, full trace pending |
| GET | `/v1/workspaces/:ws/docs/:doc/attachments/:hash` | `services/sync/src/index.ts:217` | Branch located, full trace pending |

## Outstanding work

1. Manually follow every command, subaction, MCP dispatcher and HTTP method from its caller through permission checks, storage, external APIs, errors and return values. Replace discovery labels only when backed by direct evidence.
2. Match test cases to each behavior, run the required original and native suites in isolated environments, and distinguish test discovery, execution and pass results.
3. Compare the original working-tree diff against HEAD, review the uncommitted screen-drawing and drawing transport changes, and agree on the source revision for parity.
4. Inventory route forms not recognized by static extraction, nested dispatch, WebSocket messages, event handlers, scheduled jobs and all APIs owned by dependencies.
5. Record native implementations and actual cross-platform results feature by feature. A prototype, a listed endpoint, an existing test file, or a green unrelated build is not completion.
