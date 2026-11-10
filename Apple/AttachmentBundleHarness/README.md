# Isolated attachment bundle harness

Build a dedicated RustStore XCFramework with `WORLDS_FIXTURE_BUNDLE=1`, then
generate and run the `AttachmentBundleHarness-macOS` scheme in Debug. The
fixture flag must not be used for the product build. The test creates an
artificial SQLite database and attachment in a unique temporary directory,
selects that generated source and checks the real native bundle output and
unchanged source. The screen also offers the native folder picker for manual
experiments; automated UI coverage selects the generated fixture and does not
exercise the system picker. The native bridge only accepts temporary paths.

The published bundle remains explicitly unverified and is not discoverable as
an ordinary local copy. Source database and attachment provenance, cross-file
atomicity and adversarial replacement are not established. The harness is not
linked to the shipping application.
