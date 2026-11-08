# Isolated collaboration harness

This macOS-only development harness uses copies of the synthetic schema-v11
fixtures and the actual Swift session, Rust store, Yjs bridge, WebSocket and
local sync Worker. It accepts only the hard-coded `127.0.0.1:18790` service and
requires `WORLDS_REQUIRE_LIVE_SERVICE=1`, `WORLDS_LIVE_SYNC_URL` set to
`ws://127.0.0.1:18790`, and disposable local editor/viewer fixture tokens in
`WORLDS_LIVE_EDITOR_TOKEN` and `WORLDS_LIVE_VIEWER_TOKEN`. Never provide a real
account token. Start the repository's isolated identity and sync Workers with
their disposable configuration first. No production server is supported.

Build the collaboration XCFramework, set `WORLDS_REQUIRE_COLLABORATION=1`,
generate the project using `xcodegen generate` in this directory, and build or
run the `CollaborationHarness-macOS` scheme on a Mac. Supply the environment
to the application process, not only the Xcode build process.

The scenario checks two independent clients, durable offline outbox across a
session restart, convergence and a viewer rejection. It deletes its temporary
fixture directory after the run. It does not establish process-crash recovery,
actual editor integration, durable rejection recovery UX, token refresh,
presence correctness, production permissions, or Apple device validation.
It is not linked to the shipping application. Apple build and execution must
be verified in CI; they cannot be performed on this Windows host.
