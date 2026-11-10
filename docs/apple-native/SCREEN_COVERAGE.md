# Native screen coverage

This list tracks observed source routes and requested native verification. It is an incomplete inventory, not a count of completed features. A build or synthetic screenshot does not prove interaction parity. Unless otherwise stated, neither native behavior nor visual review is complete.

| Source screen or state | Source entry point | Current Apple evidence and missing work |
| --- | --- | --- |
| Home | `src/views/HomeView.tsx` | No native home workflow. |
| Resource navigation | `src/views/RouteView.tsx`, `src/resources/views/ResourceView.tsx` | Read-only personal page list and navigation exist. Resource tree, tabs, panes, multiple windows and full routes remain. |
| Page and block editor | `src/views/PageView.tsx`, `src/editor/PageEditor.tsx` | Selected text blocks are readable. Native editor and safe persistence are experimental and not connected. |
| Document | `src/resources/views/DocumentView.tsx` | No complete native document editor or pagination. |
| Presentation | `src/resources/views/PresentationView.tsx` | Isolated model and partial view only. Editing, media, presentation controls and persistence remain. |
| Project | `src/resources/views/ProjectView.tsx` | Isolated model only. UI, persistence, permissions and integrations remain. |
| Gallery | `src/resources/views/GalleryView.tsx` | Isolated model only. UI, import and production persistence remain. |
| File and attachment | `src/resources/views/FileView.tsx`, `src/editor/views/FilePreview.tsx` | Isolated preview modules only. Native navigation, security scope lifetime and actual format coverage need end-to-end checks. |
| Stream | `src/resources/views/StreamView.tsx` | No native stream workflow. AVFoundation components alone do not prove HLS playback. |
| Drawing | `src/drawing/DrawingView.tsx` | Isolated data, tools and approximate renderer. No integrated editor, storage, collaboration or export parity. |
| Search | `src/shell/CommandPalette.tsx`, `src-tauri/src/store/search.rs` | Personal search and selected results are integrated. Initial iPhone, iPad and macOS UI scenarios passed in run 42388460952. Shared search, command palette and full behavior remain. |
| Templates | `src/views/TemplatesView.tsx` | No native template workflow. |
| Automations | `src/views/AutomationsView.tsx` | Isolated models and read-only data; no native workflow, scheduler or delivery. |
| Settings and profile | `src/views/SettingsView.tsx`, `src/views/ProfileView.tsx` | No native settings or profile workflow. |
| Activity and approvals | `src/views/ActivityView.tsx`, `src-tauri/src/discord` | No native activity or approval workflow. |
| Integrations | `src/views/IntegrationsView.tsx` | No complete native integration workflow. |
| Trash | `src/views/TrashView.tsx` | No native restore or purge workflow. |
| AI chat | `src/views/ChatView.tsx`, `src/ai/chat` | Isolated macOS process runner, not a native chat workflow. iOS service path, MCP authorization and persistence remain. |
| Collaboration and presence | `src/sync/useCollab.tsx`, `src/sync/provider.ts` | Isolated Swift/Worker integration tests passed; editing integration, presence and permission UX remain. |
| Dialogs, sheets and menus | Feature-specific source components | Initial open and error states have limited screenshots. Remaining states not inventoried or reviewed. |

## Required visual states per implemented workflow

Capture and manually inspect normal, loading, empty, failure, confirmation, long-content and interaction states as applicable. Repeat on requested iPhone sizes, iPad orientations and resizable windows, macOS window sizes, light and dark modes, Dynamic Type and RTL. `VISUAL_QA_REPORT.md` records actual reviewed images and unresolved defects. Do not substitute the initial read-only fixture screens for the missing workflows.
