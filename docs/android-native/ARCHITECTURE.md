# Android architecture status

`Android/` is a separate Kotlin and Jetpack Compose application. The desktop
and Apple code are not Android dependencies. The application currently uses
four modules under `core/`; their presence does not imply full feature parity.

- `core/content` stores personal resources and ordered ProseMirror-shaped JSON
  blocks in a private Android SQLite database. Revision checks protect local
  edits from stale writes. The app connects this store to page, document,
  project, gallery, presentation, template, search and history screens. The
  supported operations and remaining limitations are in `FEATURE_PARITY_MATRIX.md`.
- `core/identity` implements identity requests and device-bound session storage.
  The app exposes account, workspace, membership and permission workflows.
- `core/sync` implements the shared wire protocol, socket, session actor,
  replica journal, outbox and recovery. Its native Yrs library is connected
  through JNI. `AccountSyncRuntime` owns account-bound sessions and serializes
  changes around account transitions. Shared text editing and offline recovery
  are described in `YRS_SYNC_FOUNDATION.md`. Personal SQLite resources and
  synchronized Yjs documents are separate stores.
- `core/stylus` converts supported Android MotionEvents into stylus samples and
  contains the bounded stroke recorder and geometry. The app's drawing screen
  connects the engine to a separate SQLite drawing journal and renderer. The
  supported brushes, package limits and hardware gaps are in `STYLUS_SUPPORT.md`.

The app's Compose screens, view models, background synchronization, system
pickers and media playback live in `app/`. The library uses a two-pane layout
at widths of 840 dp and above; other areas still need adaptive layouts. The
current implementation does not yet contain a complete shared design-system or
adaptive-layout module, and the feature and device matrices remain incomplete.

Build and run tests with the Gradle wrapper in `Android/`. GitHub Actions builds
Android packages, runs unit and emulator tests, and checks Yrs against pinned
desktop Yjs dependencies. Local Worker tests are opt-in and use isolated test
accounts. Successful emulation does not establish real-device, production
service, Chromebook or complete cross-platform compatibility.
