# UI automation coverage

The UI tests launch the actual native app. In Debug builds only, a fixed launch argument opens the repository's isolated `worlds-v1-fixture.db` using the regular read-only database API. A second fixed argument requests a known missing fixture to exercise the real error state. The test hook accepts no caller-specified path. It does not open, change, or copy user databases. The fixture is excluded from Release via the Xcode build setting, and the test launch hook is absent from non-Debug builds. CI checks that the Release app does not contain the fixture. Neither check has run until the workflow succeeds.

Search tests use a second isolated fixture containing personal and shared rows; they verify personal search, navigation, empty results and exclusion of the shared result. Both test fixtures are excluded from Release.

Screenshots are XCTest attachments, retained in the result bundle and exported by CI where xcresulttool supports it:

- `01-open-database`: initial screen with the real file selection action.
- `02-personal-pages`: personal page list loaded from the isolated fixture.
- `03-page-content`: page selected through the interface and rendered by the real reader.
- `04-database-error`: failed read of a nonexistent fixture and the error alert.
- `05-personal-search-results`: personal search results without the shared row.
- `06-search-result-page`: opening the personal result.
- `07-search-no-results`: query without matching results.

The tests exercise selection of a page and closing the error alert. They do not automate choosing a file in the system picker, editing, collaboration, authentication, shared pages, all content types, RTL, Dynamic Type, different appearances, older operating systems, multiple window sizes, physical devices, or performance. A successful test or screenshot capture does not mean a human reviewed an image. A visual review and corrections remain required.

In run 42389924247, the macOS search-results screen capture showed the desktop without the app window even though the interaction test passed. That image is invalid for visual review. macOS captures now activate the app and capture its window directly; this change still requires a new CI run and visual inspection.

Run 42391128440: the macOS search-results and no-results captures were manually inspected. Both showed the app window and sidebar search; the earlier desktop-only capture did not recur in these two images. This does not constitute review of other screens, sizes, appearances, or platforms.
The owner also reviewed these two captures: the no-results message wraps in the narrow column, and the overall appearance remains simple. Brand fidelity, dark appearance and other window sizes have not been reviewed.
Run 42391128440: the iPhone search-results and no-results captures were manually inspected; the keyboard keys were visible in both. Other states and device sizes remain unreviewed.
Run 42391128440: iPad portrait search-results and no-results captures were inspected at 1640 x 2360 pixels. The keyboard was complete and the no-results message wrapped in the narrow sidebar. Landscape, Split View and other sizes remain unreviewed.

Run 42391128440 for commit d672eec completed successfully. The five existing UI tests ran on iPhone 17, iPad (A16) and macOS 26. The associated package and native bridge jobs passed their isolated fixture tests. Search and page viewing are covered only for the documented states above; editing, RTL, dark mode, landscape and real-device behavior are not established by this run. See https://github.com/justpainful/Worlds/actions/runs/42391128440.
