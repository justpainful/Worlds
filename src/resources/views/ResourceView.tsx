import { useStore } from "../../state/store";
import { PageView } from "../../views/PageView";
import { DocumentView } from "./DocumentView";
import { FileView } from "./FileView";
import { GalleryView } from "./GalleryView";
import { PresentationView } from "./PresentationView";
import { ProjectView } from "./ProjectView";
import { StreamView } from "./StreamView";

/** Opens a resource with the view made for its kind. */
export function ResourceView({ pageId, paneId }: { pageId: string; paneId: string }) {
  const kind = useStore((s) => s.pages[pageId]?.kind);
  switch (kind) {
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
    default:
      // Pages, templates, and anything not loaded yet (PageView handles missing pages).
      return <PageView pageId={pageId} paneId={paneId} />;
  }
}
