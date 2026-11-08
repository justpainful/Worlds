# Experimental personal tabs

This DEBUG-only single-pane experiment opens pages from the current independent
local copy. A page row or search result offers Open in new tab. Normal page
navigation replaces the active tab, and opening a page already in the tab list
selects it. Switching tabs clears the current return stack; separate per-tab
back and forward histories, split panes and non-page routes are not implemented.

The ordered page IDs and active ID are stored as plaintext in UserDefaults under
the local copy UUID. Titles, content and paths are not stored. Up to 20 tabs are
retained. On restore, IDs absent from the current personal snapshot are removed,
and opening or switching a tab checks the same snapshot. This is point-in-time
filtering, not ongoing authorization for shared workspaces. Directly opened
external databases do not use this tab session. The UI requires DEBUG,
WORLDS_EXPERIMENTAL_LOCAL_COPY and WORLDS_EXPERIMENTAL_PERSONAL_TABS.

Apple UI, accessibility, process restart and identity-race testing remain
outstanding. This does not claim full parity with the original session layout.
