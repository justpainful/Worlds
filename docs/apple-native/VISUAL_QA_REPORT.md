# Visual QA report

Three failure screenshots from the macOS UI job in [run 42384584985](https://github.com/justpainful/Worlds/actions/runs/42384584985) were manually inspected. They are available in the `Worlds-macOS-UI-results` artifact.

| State | Observation | Resolution |
| --- | --- | --- |
| Initial window | Sidebar is too narrow: the title wraps into several fragments and the open action is not directly visible. | Unresolved, correction and recapture required. |
| Database error | The alert is visibly present while the UI test failed to identify it. The narrow sidebar remains visible underneath. | Investigate macOS accessibility hierarchy and correct the query or application as appropriate. |
| Personal page list | Fixture page appears in the sidebar, but the test failed to locate it. The narrow sidebar leaves limited space for page titles. | Fix layout and inspect accessibility identification, then recapture. |

The captures are from an incomplete read-only application and do not establish overall visual quality. Light and dark appearances, device sizes, text scaling, safe areas, RTL, glass effects and other interactive states remain unverified. Further captures must record platform, device, OS, screen, state, issue and resolution.

One iPad portrait failure screenshot from the same run was also inspected in `Worlds-iPad-UI-results`: the fixture page is visibly present and the sidebar and detail area fit at that size. The automated test failed to locate the visible page, so the accessibility identifier and navigation must be retested. The screenshot does not cover landscape, resizing, editing or other content.

Four iPhone screenshots from the same run were inspected in `Worlds-iPhone-UI-results`: opening, personal page list, page content and database error. These states fit the captured screen, and the corresponding three UI tests passed. The page content displays the title twice in close succession, once in navigation and once in the page; this needs a layout correction and recapture. The images show only an isolated read-only fixture on one simulator, not full app parity or a complete device matrix.
