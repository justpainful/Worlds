# WorldsSearch scope

This read-only search engine follows `src-tauri/src/store/search.rs`: FTS5 trigram terms and BM25 ranking, private-use highlight delimiters in snippets, then a title LIKE fallback with duplicate suppression. It includes archived pages and excludes deleted pages. Templates can be excluded. Parent titles are included only when the parent also passes the personal-data filter. Requests are capped at 1,000 results and 4,096 UTF-8 bytes; original Worlds does not enforce the same limits.

Pages with workspace IDs, explicitly shared sync metadata, malformed metadata or unrecognized sync metadata are omitted. This is a conservative filter, not account authentication or shared-workspace authorization. Shared search and search UI command palette behavior are not implemented. The module reads the existing FTS index and never updates or rebuilds it. It reports SQLite errors, including unsupported FTS5/trigram configurations, instead of silently treating a title-only fallback as full search. The search object retains a security scope for its lifetime when one is supplied. The host app must still obtain the appropriate file grant and account authorization.

Tests use an isolated synthetic database derived from the eleven original schema migrations. They cover FTS, Arabic, short titles, archive, trash, templates, permissions, highlights and read-only behavior. Four tests passed on macOS in Actions run 42387357673. The module is included in SwiftPM and a personal-search UI has been added; that UI is awaiting its first complete CI run and visual review.

