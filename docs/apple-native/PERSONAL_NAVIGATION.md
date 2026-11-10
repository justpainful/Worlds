# Personal page hierarchy

The optional hierarchy is built from the already-filtered personal snapshot.
It excludes archived pages and templates, matching the source sidebar. Pages
whose parent is missing or filtered remain reachable without displaying the
parent's name. Cycles are broken into reachable components. Search continues to
use its separate personal-data filter, and the flat list remains available.

Expansion and hierarchy mode are kept in memory for the open database. For an
independent local copy, the application also saves them under that copy's UUID
in UserDefaults. This stores page IDs as plaintext, but does not store titles,
page contents or database paths. At most 5,000 IDs are saved and restored IDs
are filtered against the current personal snapshot. A directly opened database
does not have durable hierarchy preferences because its stable identity has not
been established.

The snapshot is a point-in-time filter, not an active authorization lease.
Shared workspaces are not supported. Very large hierarchies, selection and
preference updates while switching copies, RTL and VoiceOver require Apple
validation. UI tests and Swift tests have been added but were not run on Windows.
