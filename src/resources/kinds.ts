/**
 * Resource kinds. Every resource is a row in the pages store with a `kind`;
 * a Page is one kind among several. See docs/CONTENT.md.
 */
import type { PageMeta, ResourceKind } from "../lib/types";

export interface KindInfo {
  label: string;
  plural: string;
  /** Product icon used when the resource has no icon of its own. */
  icon: string;
  blurb: string;
}

export const KIND_INFO: Record<ResourceKind, KindInfo> = {
  page: { label: "Page", plural: "Pages", icon: "pages", blurb: "Notes, ideas and anything in blocks" },
  document: { label: "Document", plural: "Documents", icon: "document", blurb: "A formatted document on paper pages" },
  presentation: { label: "Presentation", plural: "Presentations", icon: "presentation", blurb: "Slides to present" },
  project: { label: "Project", plural: "Projects", icon: "briefcase", blurb: "Gather documents, files and pages in one place" },
  gallery: { label: "Gallery", plural: "Galleries", icon: "image", blurb: "Photos, videos and GIFs together" },
  file: { label: "File", plural: "Files", icon: "file", blurb: "A picture, video, PDF or document from your PC" },
  stream: { label: "Stream", plural: "Streams", icon: "film", blurb: "A video stream link such as m3u8" },
};

/** Creatable from New, in menu order. */
export const NEW_KINDS: ResourceKind[] = ["page", "document", "presentation", "project", "gallery"];

/** Anything the user browses and works with (templates are blueprints). */
export function isResource(p: Pick<PageMeta, "kind">): boolean {
  return p.kind !== "template";
}

/** Kinds whose content is text blocks (Discord sends, tasks, Claude text tools). */
export function isTextKind(kind: string): boolean {
  return kind === "page" || kind === "document";
}

/** A product icon that suits a file, by its MIME type or name. */
export function fileIcon(mime: string, name = ""): string {
  const n = name.toLowerCase();
  if (mime === "image/gif" || mime.startsWith("image/")) return "pi:image";
  if (mime.startsWith("video/")) return "pi:video";
  if (mime.startsWith("audio/")) return "pi:audio";
  if (mime === "application/pdf" || n.endsWith(".pdf")) return "pi:pdf";
  if (/\.(xlsx?|csv|tsv|numbers)$/.test(n)) return "pi:spreadsheet";
  if (/\.(pptx?|key)$/.test(n)) return "pi:presentation";
  if (/\.(docx?|rtf|odt|pages|txt|md)$/.test(n)) return "pi:document";
  if (/\.(zip|rar|7z|tar|gz)$/.test(n)) return "pi:archive";
  if (/\.(js|ts|tsx|py|rs|json|html|css|c|cpp|cs|go|java)$/.test(n)) return "pi:code";
  return "pi:file";
}

export function defaultIcon(kind: ResourceKind): string | null {
  return kind === "page" ? null : `pi:${KIND_INFO[kind].icon}`;
}
