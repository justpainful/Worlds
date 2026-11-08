# Local page Markdown import and export

Android exports an opened local page using the text projection from desktop
`src-tauri/src/content.rs` and the page wrapper from `commands::page_markdown`.
The page title is an H1, nonblank block projections follow in stored order, and
the file ends with a newline. Paragraph marks, headings, nested lists, tasks,
quotes, tables, code, math, diagrams and resource placeholders follow the
desktop projection. Some formatting and original attachments cannot be
represented in Markdown. The saved page is unchanged.

The exporter and clipboard operate on the selected page snapshot. Save uses
Android's document picker. Cancel does not write; an interrupted or failed
export is reported. Imported files create a separate local page. The importer accepts UTF-8 Markdown up to 8 MiB and applies the desktop parser dialect with additional complexity limits. It retains the exact original bytes separately from the editable page. The export dialog can save those original bytes even after page edits. Imported plain code blocks can be edited with their language and block attributes retained. Quote, callout and prompt paragraphs can be displayed and edited while other children are preserved. Table cells can be shown and supported paragraphs edited. Rectangular tables support insertion and confirmed removal of selected rows and columns. Merged and irregular table layouts are identified as incomplete and cannot be resized. Other complex imported nodes may remain read-only, and this parser is not a full CommonMark implementation.

`Android/tools/markdown-contract` calls the actual desktop Rust source to
generate 27 synthetic export fixtures and 28 import cases from the desktop parser. Android instrumentation compares the
produced text against these fixtures, tests a full page, and covers clipboard,
write, cancel and failure behavior. The CI core job regenerates the fixture and
checks for changes. Neither a GitHub Actions run nor other storage providers
have been verified in this workspace.
