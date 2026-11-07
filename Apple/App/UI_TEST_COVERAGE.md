# UI automation coverage

The UI tests launch the actual native app. In Debug builds only, a fixed launch argument opens the repository's isolated `worlds-v1-fixture.db` using the regular read-only database API. A second fixed argument requests a known missing fixture to exercise the real error state. The test hook accepts no caller-specified path. It does not open, change, or copy user databases. The fixture is excluded from Release via the Xcode build setting, and the test launch hook is absent from non-Debug builds. CI checks that the Release app does not contain the fixture. Neither check has run until the workflow succeeds.

Screenshots are XCTest attachments, retained in the result bundle and exported by CI where xcresulttool supports it:

- `01-open-database`: initial screen with the real file selection action.
- `02-personal-pages`: personal page list loaded from the isolated fixture.
- `03-page-content`: page selected through the interface and rendered by the real reader.
- `04-database-error`: failed read of a nonexistent fixture and the error alert.

The tests exercise selection of a page and closing the error alert. They do not automate choosing a file in the system picker, editing, collaboration, authentication, shared pages, all content types, RTL, Dynamic Type, different appearances, older operating systems, multiple window sizes, physical devices, or performance. A successful test or screenshot capture does not mean a human reviewed an image. A visual review and corrections remain required.
