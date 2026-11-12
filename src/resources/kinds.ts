/**
 * Resource kinds. Every resource is a row in the pages store with a `kind`;
 * a Page is one kind among several. See docs/CONTENT.md.
 */
import type { PageMeta, ResourceKind } from "../lib/types";
import { isKindHidden } from "../packs/registry";

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
  drawing: { label: "Drawing", plural: "Drawings", icon: "paintbrush", blurb: "Draw, edit images and explain visually" },
  spreadsheet: { label: "Spreadsheet", plural: "Spreadsheets", icon: "spreadsheet", blurb: "Tables, formulas, sheets and financial or data models" },
  project: { label: "Project", plural: "Projects", icon: "briefcase", blurb: "Gather documents, files and pages in one place" },
  gallery: { label: "Gallery", plural: "Galleries", icon: "image", blurb: "Photos, videos and GIFs together" },
  file: { label: "File", plural: "Files", icon: "file", blurb: "A picture, video, PDF or document from your PC" },
  stream: { label: "Stream", plural: "Streams", icon: "film", blurb: "A video stream link such as m3u8" },
  // Planning (for everyone)
  task: { label: "Task", plural: "Tasks", icon: "checklist", blurb: "Something to do, with a date, priority and steps" },
  event: { label: "Event", plural: "Events", icon: "calendar", blurb: "Something at a time: a meeting, a class, an appointment" },
  inbox: { label: "Capture", plural: "Inbox", icon: "inbox", blurb: "A quick note to sort out later" },
  goal: { label: "Goal", plural: "Goals", icon: "target", blurb: "Something to reach, with steps and progress" },
  // Study pack
  subject: { label: "Subject", plural: "Subjects", icon: "graduation", blurb: "A course, with its teacher, timetable and work" },
  lesson: { label: "Lesson", plural: "Lessons", icon: "notebook", blurb: "Notes from one lesson" },
  assignment: { label: "Assignment", plural: "Assignments", icon: "clipboard", blurb: "Homework with a due date and a grade" },
  exam: { label: "Exam", plural: "Exams", icon: "medal", blurb: "A test, its scope and its result" },
  requirement: { label: "To bring", plural: "To bring", icon: "printer", blurb: "Something to bring, print or prepare" },
};

/**
 * What a card shows when a resource has no text preview. Spreadsheets,
 * drawings and slides keep their content outside blocks, so "Empty page"
 * would be wrong for them: they show what they are instead.
 */
export function emptyPreview(kind: string): string {
  if (kind === "page" || kind === "template") return "Empty page";
  if (kind === "document") return "Empty document";
  return KIND_INFO[kind as ResourceKind]?.label ?? "Empty page";
}

/**
 * Item kinds are things you plan and tick off rather than documents you open
 * and write in. They live in their own views (Tasks, Calendar, Inbox, a
 * subject's page) instead of the sidebar tree, Home's Recent and pickers.
 */
export const ITEM_KINDS: ReadonlySet<string> = new Set(["task", "event", "inbox", "goal", "assignment", "exam", "requirement"]);

/** Kinds that live under their own sidebar section rather than the page tree. */
const OWN_SECTION_KINDS: ReadonlySet<string> = new Set(["subject", "lesson"]);

export function isItemKind(kind: string): boolean {
  return ITEM_KINDS.has(kind);
}

/** Creatable from New, in menu order. */
export const NEW_KINDS: ResourceKind[] = ["page", "document", "spreadsheet", "presentation", "drawing", "project", "gallery"];

/** Anything the user browses and works with (templates are blueprints; items live in their own views). */
export function isResource(p: Pick<PageMeta, "kind">): boolean {
  return p.kind !== "template" && !ITEM_KINDS.has(p.kind) && !isKindHidden(p.kind);
}

/** Whether a resource appears in the sidebar's page tree. */
export function isTreeKind(kind: string): boolean {
  return kind !== "template" && !ITEM_KINDS.has(kind) && !OWN_SECTION_KINDS.has(kind) && !isKindHidden(kind);
}

/** Kinds whose content is text blocks (Discord sends, tasks, Claude text tools). */
export function isTextKind(kind: string): boolean {
  return kind === "page" || kind === "document" || kind === "lesson";
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
