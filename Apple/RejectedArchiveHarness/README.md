# Rejected archive UI harness

The harness creates a temporary copy of the synthetic v11 database and uses the
real SQLite and Yjs store. Its permission provider is an in-memory fixture; it
does not communicate with the identity or sync services. The UI test opens a
record, revokes that fixture permission and verifies that refreshing clears the
details. No user account, production data, network send or clipboard write is
used by the test. Build the collaboration XCFramework first and run the
`RejectedArchiveHarness-macOS` scheme on macOS or `RejectedArchiveHarness-iOS`
on an iPhone or iPad simulator. Apple CI and visual inspection
are still required before drawing conclusions about the UI.
