import { lazy, Suspense } from "react";
import { useStore } from "../../state/store";
import { PageView } from "../../views/PageView";
import { DocumentView } from "./DocumentView";
import { FileView } from "./FileView";
import { GalleryView } from "./GalleryView";
import { PresentationView } from "./PresentationView";
import { ProjectView } from "./ProjectView";
import { StreamView } from "./StreamView";
import { TaskView, EventView, GoalView } from "../../planning/ItemViews";
import { SubjectView, StudyItemView } from "../../study/StudyViews";
import { InboxView } from "../../planning/InboxView";
import { PackItemView } from "../../packs/views/PackItemView";
import { isPackKind } from "../../packs/registry";

// Drawings and spreadsheets are large and opened less often, so their views load on first use.
const DrawingView = lazy(() => import("../../drawing/DrawingView").then((m) => ({ default: m.DrawingView })));
const SpreadsheetView = lazy(() => import("../../spreadsheet/SpreadsheetView").then((m) => ({ default: m.SpreadsheetView })));

/** Opens a resource with the view made for its kind. */
export function ResourceView({ pageId, paneId }: { pageId: string; paneId: string }) {
  const kind = useStore((s) => s.pages[pageId]?.kind);
  switch (kind) {
    case "drawing":
      return (
        <Suspense fallback={null}>
          <DrawingView key={pageId} id={pageId} paneId={paneId} />
        </Suspense>
      );
    case "spreadsheet":
      return (
        <Suspense fallback={null}>
          <SpreadsheetView key={pageId} pageId={pageId} />
        </Suspense>
      );
    case "document":
      return <DocumentView key={pageId} id={pageId} />;
    case "presentation":
      return <PresentationView key={pageId} id={pageId} />;
    case "project":
      return <ProjectView key={pageId} id={pageId} />;
    case "gallery":
      return <GalleryView key={pageId} id={pageId} />;
    case "file":
      return <FileView key={pageId} id={pageId} />;
    case "stream":
      return <StreamView key={pageId} id={pageId} />;
    case "task":
      return <TaskView key={pageId} id={pageId} />;
    case "event":
      return <EventView key={pageId} id={pageId} />;
    case "goal":
      return <GoalView key={pageId} id={pageId} />;
    case "inbox":
      return <InboxView />;
    case "subject":
      return <SubjectView key={pageId} id={pageId} />;
    case "assignment":
    case "exam":
    case "requirement":
      return <StudyItemView key={pageId} id={pageId} />;
    default:
      // An item of a pack kind (freelance.invoice) opens as its fields.
      if (kind && isPackKind(kind)) return <PackItemView key={pageId} id={pageId} />;
      // Pages, lessons, templates, and anything not loaded yet (PageView handles missing pages).
      return <PageView pageId={pageId} paneId={paneId} />;
  }
}
