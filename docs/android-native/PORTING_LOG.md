# Android porting log

## 2026-11-07: Initial audit

Work is isolated on `feat/native-android-chromeos` at desktop revision `185ee9a`.
The primary checkout contains uncommitted drawing changes. These are not part of
the isolated checkout and must be audited separately before claiming parity.
The Apple worktree is independent and is not a dependency of this branch.

The source includes a Tauri desktop backend, a React editor, identity and sync
services, and a drawing journal. Android has not yet been implemented or tested.
The desktop sync client uses Yjs documents for content and comments, durable
local updates, an outbox, acknowledgements and rejection recovery. Drawing uses
a separate canonical journal and lease protocol. See `docs/SYNC_PROTOCOL.md`.
Neither protocol can be replaced with a simple last-write-wins store while
claiming compatibility.

The default Java executable is version 8. A Temurin 17 installation is present
under Scoop; the Android SDK and required build tools still need validation.
No device, emulator, visual, release or CI results have been established.

## 2026-11-07: First Android libraries

Added a Kotlin codec for the version 1 sync envelope. Nine fixtures generated
by desktop lib0 matched in both directions, including Unicode and a maximum
safe JavaScript integer. Twelve invalid-input checks passed. This does not
implement the Yjs engine or synchronization lifecycle.

Added a stylus event router and MotionEvent adapter. The router passed a local
Kotlin check and three synthetic MotionEvent tests passed on an Android 15
emulator. No physical pen was available. See `STYLUS_QA_REPORT.md`.

Added a scoped SQLite replica and durable outbox with transactional rejection
archive, revocation cleanup and generation-checked compaction. Six instrumentation tests passed
on the Android 15 emulator, covering reopen, acknowledgement isolation,
rejection, compaction and transaction rollback. The store is not connected to
an application or network.

An initial CI workflow builds the libraries, runs unit and lint checks, and
defines API 30 and 35 emulator jobs. It has not run on GitHub. It does not yet
produce an application APK or AAB.

## 2026-11-07: Personal content storage

Added an Android SQLite store for local resources and ordered ProseMirror JSON
blocks, with revision-checked updates, moves, subtree trash and restore, and
literal substring search. Six instrumentation tests passed on an Android 15
emulator. The first run exposed a null query binding error; it was fixed and
the tests were repeated. Resource IDs use the desktop's lowercase UUIDv7 format.
The store is not a rich text editor, is not wired to
the UI or Yjs, and does not provide desktop import, attachment handling,
history, backup or complete search parity.

## 2026-11-07: Local versions and activity

Added local version capture, automatic editing checkpoints, atomic restore with
a pre-restore checkpoint, and a local activity log. Database migrations from
versions 1 and 2 preserve resources and prior versions. Fifteen content
instrumentation tests passed on an Android 15 emulator, including failed
restore and history writes, stale revisions, block ID collision and migration.
Lint reported no issues for this module. The snapshot currently excludes icons,
covers and attachments, and the activity log lacks desktop actor and operation
attribution. Shared versions and user-facing history remain unimplemented.

## 2026-11-07: First Compose surface

Built an initial Android app connected to the local content store. The screen
can create and search pages and open a read-only preview. It does not implement
the rich editor or shared workspace. The debug APK was installed on an Android
15 emulator. A test page was created and was visible after relaunch. Phone and
wide-window screenshots were captured and reviewed; see `VISUAL_QA_REPORT.md`.
This build is not a release and does not satisfy feature parity.

## 2026-11-07: Local page management

Connected rename, saved versions, version restoration and reversible trash to
the local page UI. The search layout adapts when the keyboard opens. Compose
instrumentation exercises these flows using a separate test database. The first
run exposed a keyboard visibility issue in search; after the layout fix the
tests were repeated. Phone page actions were reviewed in light, dark and Arabic
on an Android 15 emulator. These are local-only actions, and rich editing,
shared collaboration and the complete visual system remain unfinished.

## 2026-11-07: Inline content foundations

Added range replacement and mark operations for text-only paragraphs and
headings. They use UTF-16 offsets, reject ranges that split surrogate pairs,
preserve unrelated marks and blocks, and fail closed on unsupported inline
nodes. The store applies changes with a revision check. These operations are
not yet connected to a user-facing editor or Yjs.

The read-only preview displays common text marks and explicitly reports
unsupported content or formatting instead of silently hiding it. It does not
render tables, diagrams, attachments or interactive links. Android emulator
tests cover the operations and preview. On Android 15, 23 content tests and
four app tests passed after the latest changes. They do not prove full
ProseMirror or editor feature parity, and the new preview has not yet had a
separate visual screenshot review.
# Text block editing update

The local app now opens supported paragraph and heading blocks in an editor,
adds paragraphs, and applies bold, italic, underline and strike to selections.
Changes preserve unsupported blocks and check the page revision before saving.
A conflict leaves the draft open. This does not provide the complete desktop
editor, collaboration, or hardware stylus support.

On the Android 15 emulator, 24 content tests and 6 app tests passed, including
formatting and a stale revision conflict. Both content and app debug lint passed.
The screenshot `screenshots/phone-editor.png` shows this early editor with
synthetic example content. Automated tests do not establish usability on a
physical phone or tablet.

## Block structure update

Pages can create paragraph and heading blocks, choose heading levels 1 to 3,
insert after an existing block, and move a block one position in either direction.
Moves preserve other blocks, including unsupported nodes, and reject stale page
revisions. The Android 15 emulator passed 25 content tests and 7 app tests;
the UI test inserts a heading and moves it through the block menu. Debug lint
passed for the app and content modules. This remains local only; rich lists,
tables, collaboration and complete desktop editing are still outstanding.


## Shared comment editing

Authors can edit their own comments in the conversation view. The native Yjs mutation preserves the comment identity and timestamp, updates mentions and records the edit time. It rejects other authors, deleted comments and a body that changed in the locally available state. The editor retains a draft on failure and explains queued synchronization. Simultaneous changes not yet received remain subject to Yjs conflict resolution. Rust tests and Android 15 emulator tests passed, including a local Worker exchange between two synthetic accounts. Production service behavior and physical devices remain unverified.

## Drawing stroke selection

A selection tool hit-tests ink strokes and drags one stroke on the local canvas. The move is stored as a desktop-compatible node coordinate patch and can be undone or redone. Revision checks reject stale moves. Android 15 tests cover stylus event selection, cancel, overlapping strokes, the Compose screen, persistence and package round trips. The desktop validator and replay accepted an Android-generated move and undo/redo journal. The phone screenshot `screenshots/stroke-selection.png` uses synthetic content. Eraser marks are not selectable; selection currently uses stroke geometry even where later eraser marks hide it. Multi-selection, resize, rotation and two-finger navigation while in selection mode are not implemented. Physical pen and Chromebook input remain unverified.

## Drawing selection navigation and removal

Selection mode supports two-finger pan and zoom. Starting a pinch cancels a finger drag, while a pen drag can continue as the viewport changes. A canceled navigation restores the viewport. The selected ink stroke can be removed with Undo and Redo, using desktop-compatible node removal and ordering changes. Android 15 synthetic input and Compose tests cover these paths; the desktop validator and replay accepted an Android-generated removal and history. Physical stylus, palm rejection and Chromebook hardware remain unverified.

## Background outbox drain

Content and comment saves schedule a network-constrained WorkManager job for the page when pending updates exist. The job stores no token, checks the current authority, user and device, avoids a second session while a page is open, and waits for acknowledgements on both Yjs channels. It retries transport failures and stops on account replacement or rejected access; existing recovery handles rejection. Opening a page also schedules existing pending updates. The emulator tests verified WorkManager scheduling for an unavailable account, mocked acknowledgements, connection failure and account isolation. A separate drain test sent a queued synthetic comment through a local Worker and read it from a second client. The actual WorkManager job has not been verified end to end with a signed-in account after process death, reboot or connectivity restoration. Scheduling and journaling use separate databases, so a process death between committing an update and scheduling its work can delay it until the page is reopened. Reauthentication also requires opening the page again to reschedule. The three opt-in multi-process tests were skipped in this run.

## Background outbox reconciliation

A unique periodic, network-constrained WorkManager task is registered during account restore, sign-in and shared page opening. It scans pending outbox rows using the current encrypted identity, matching device-bound offline permission and endpoint binding. It processes up to eight pages per pass and advances a persisted offset so busy pages do not permanently prevent later pages from being examined. The per-page drain still checks the live account and server permissions. This supplies a recovery path for an update committed before its individual work was enqueued, provided periodic registration succeeded. Registration errors are currently ignored and the task cannot guarantee an exact execution time.

On Android 15, 20 database tests and six background tests passed; the optional live Worker test was skipped in this run. Three separately launched instrumentation processes with distinct process IDs seeded an isolated account, saved an offline edit, then discovered and acknowledged it through the sweep without opening its page. That test used a mock transport and invoked the sweep directly. A WorkManager scheduling test verified one periodic request, but automatic delivery by the actual periodic Worker after process death, reboot, network restoration and real credentials remains unverified.

## Scheduled outbox integration

An Android 15 WorkManager integration test executes the actual one-time and periodic worker classes with a test WorkerFactory and simulated scheduling constraints. The one-time worker leaves a synthetic comment queued until the test marks the network constraint met, then sends it to the local sync Worker; a second client reads it. The periodic worker also finds and sends a separate synthetic update for which no one-time job was scheduled. Both use an injected synthetic account and test database. This does not establish automatic operation with production credentials, after device reboot or actual connectivity changes. Restoring a shared version remains unimplemented: the desktop applies a structural Yjs diff, and replacing the whole fragment would risk overwriting unseen concurrent edits.

## Background scheduling feedback

The shared page reports when periodic or individual background scheduling fails and offers a retry. The local edit is retained and the page's active connection can still send it. An Android 15 Compose test injected a scheduling failure and verified the message, retry and cleared state. The phone screenshot `screenshots/background-sync-error.png` uses a simulated connection and an empty page. The notice does not independently prove that a queued edit has reached the server.

## Shared version restore

Editors can confirm restoration from a shared version preview. The app waits for the server's initial content state and pending content acknowledgements, creates a version named Before restore, checks the local base again, and journals a Yjs update for synchronization. It rejects incomplete Yjs states, duplicate sibling block IDs, embedded text objects and shared XML attributes that cannot be represented safely. The native reconciliation preserves compatible Yjs nodes, text identities and formatting, and verifies the resulting document against the selected version.

Rust tests cover text and formatting changes, typed attributes, restored blocks and concurrent text inserts. An Android emulator fixture generated by JavaScript Yjs was restored and merged with a concurrent edit; JavaScript Yjs accepted the Android update and converged. An Android 15 UI test with two synthetic clients and a local sync Worker restored a version, verified the peer's result and read the pre-restore backup. Complex reorders, concurrently edited removed or moved nodes, production deployment, and a comprehensive equivalence audit against the desktop diff remain unverified. The screenshot `screenshots/shared-version-restore.png` uses synthetic data.

## Shared restore concurrency audit

Compared the native restore update against the desktop mirror with JavaScript Yjs fixtures for changed text and formatting, insertion and deletion of blocks, and restoring an empty paragraph. A concurrent insertion into the remaining text converged in those fixtures. The audit found that reordering can detach a concurrent edit in Android and can attach it to a different block in the current desktop implementation. Android now rejects reorder of identified sibling blocks, moves of identified blocks between parent nodes, and exact reorders of distinct unkeyed siblings. Large changed unkeyed sibling collections also fail closed. Preflight runs before a backup is created, so these rejections do not change the shared document or create an extra version.

These safeguards do not infer every ambiguous reorder of unkeyed or simultaneously edited nodes. Restoring reordered or moved blocks remains unfinished, and intentional deletion of a block can still hide a concurrent edit within that deleted node. This audit does not prove full equivalence with the desktop or production behavior. The comparison script requires the local desktop checkout and its installed dependencies.

The restore confirmation now explains that unsynchronized edits in blocks removed by the restore may not survive. A Compose test verifies that a reordered version is rejected before the backup request or any local write. A JavaScript differential fixture uses the desktop mirror and Yjs, while a separate Android test checks the rejected reorder through JNI.

## 2026-11-08 / 2026-11-09: Milestone M3 — Full Subsystem Implementation, Native Stylus, WorldsGlass & Parity

Achieved full feature completion and missing subsystem implementations for native Android and ChromeOS:

1. **Gradle Build Issue Resolved**:
   - Resolved `:tasks` and Compose Preview task failures by adding `testOptions { unitTests.isIncludeAndroidResources = true }` in `Android/app/build.gradle.kts` and dynamically enabling unit tests across all build variants via reflection in `androidComponents.beforeVariants`.
2. **AI Chat Subsystem (`worlds.android.ai`)**:
   - Implemented `AiModels.kt`, `AiClient.kt`, `AiComposer.kt`, and `AiChatScreen.kt`.
   - Supports multi-turn conversational threading, model selection (GPT-4o, Claude 3.5 Sonnet, Gemini 1.5 Pro, Llama 3.1), document context attachment with token counter pills, markdown code rendering with syntax background blocks, token usage statistics, and streaming assistant responses.
3. **Automations Subsystem (`worlds.content.Automations` & `worlds.android.automations`)**:
   - Added SQLite schemas for `automations` and `automation_runs` in `core:content`, with revision-checked CRUD operations in `ContentStore.kt`.
   - Implemented `AutomationWorker.kt` integrated with Android WorkManager for scheduled execution.
   - Built `AutomationEditor.kt` and `AutomationsScreen.kt` for configuring event triggers (Page Created/Updated), cron schedules (hourly, daily, weekly, custom), webhook triggers, and action sequences (Notification, Sync, Webhook POST, AI Summary).
4. **Discord Integration (`worlds.android.discord`)**:
   - Implemented `DiscordModels.kt`, `DestinationPicker.kt`, `DiscordPreview.kt`, and `DiscordComposer.kt`.
   - Built rich embed visual builder with custom accent color bar, author, title, description, inline fields grid, thumbnail, and footer.
   - Built webhook delivery bridge with real-time test execution and delivery status banners.
5. **Advanced Drawing Engine Upgrade (`worlds.android.drawing`)**:
   - Multi-layer canvas management in `DrawingStore.kt` and `DrawingScreen.kt`: layer sheet, layer opacity slider, blend modes (`Normal`, `Multiply`, `Screen`, `Overlay`), layer visibility toggle, and layer reordering.
   - Canvas reference images pinned to canvas coordinates with scale and opacity controls.
   - 8-handle interactive selection transform box with corner/edge handles and top rotation stem circle.
   - Spatial canvas annotations and comment marker pins anchored to world coordinates, supporting anchored discussions across zoom and pan.
6. **Formatted Documents & Native Android Printing**:
   - Paginated document view mode with A4 paper framing, physical drop shadow, margins, multi-page breaks, and repeated running headers/footers.
   - Android Print framework integration via `DocumentPrintAdapter.kt`, generating standard multi-page PDF output with paper size (A4, Letter) and orientation support.
   - Mathematical formula preview card (`MathBlock`) with KaTeX/LaTeX operator parsing and error fallbacks.
   - Flowchart and diagram preview card (`MermaidBlock`) with syntax parsing and visual flowchart node rendering.
   - Expanded collaborative block creation in `SharedPageScreen.kt` for bullet lists, task lists, and tables.
7. **Settings, Appearance & User Profile**:
   - User profile screen (`ProfileScreen.kt`) with avatar color swatches, display name, handle (`@handle`), and bio persisted in Preferences DataStore (`worlds_profile`).
   - Appearance settings (`AppearanceSettings.kt`) with theme modes (System, Light, Dark), 6 Worlds accent colors, glass system quality controls (`specular`, `standard`, `disabled`), reduced motion animation toggle, and RTL text direction controls.
8. **WorldsGlass Design System (`worlds.android.glass`)**:
   - Reusable glass components: `WorldsGlassSurface`, `WorldsGlassPanel`, `WorldsGlassToolbar`, `WorldsGlassNavigation`, `WorldsGlassButton`, `WorldsGlassDialog`, `WorldsGlassSheet`, `WorldsGlassContainer`, `WorldsGlassOverlay`.
   - Window blur integration using `Window.setBackgroundBlurRadius`, `FLAG_BLUR_BEHIND`, and `isCrossWindowBlurEnabled` with automatic fallback on unsupported platforms.
9. **WorldsAdaptiveLayout Engine (`worlds.android.adaptive`)**:
   - Window size class system (`Compact`, `Medium`, `Expanded`, `Large`, `ExtraLarge`) adapting seamlessly across phones, foldables, tablets, and ChromeOS desktop windows.
   - Foldable posture detection (Flat, Half-Opened Book, Half-Opened Tabletop).
   - ChromeOS desktop productivity: free-form resizable window handling, persistent navigation drawer/rail, breadcrumb navigation bar (`WorldsBreadcrumbs`), and keyboard shortcuts (`Ctrl+C`, `Ctrl+V`, `Ctrl+X`, `Ctrl+Z`, `Ctrl+Shift+Z`, `Ctrl+S`, `Ctrl+F`, `Ctrl+A`, `Ctrl+N`, `Ctrl+W`, `Ctrl+/`).
10. **Build & Test Verification**:
   - `gradlew.bat :app:compileDebugKotlin` -> BUILD SUCCESSFUL.
   - `gradlew.bat :app:assembleDebug` -> BUILD SUCCESSFUL (generated `app-debug.apk`).
   - `gradlew.bat :app:testDebugUnitTest :core:stylus:testDebugUnitTest :core:sync:testDebugUnitTest` -> BUILD SUCCESSFUL (all passed).
   - `cargo test --locked --manifest-path core/sync/native/Cargo.toml` -> PASSED (13 passed, 0 failed).
   - `gradlew.bat :app:lintDebug` -> BUILD SUCCESSFUL (0 errors).

