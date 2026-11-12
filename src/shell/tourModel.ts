/** The guided tour steps and where its card goes, kept free of the app store so tests can load them. */
import type { IconName } from "../ui/Icon";

export interface TourStep {
  /** CSS selector of the part to light up; none or missing shows the card centred. */
  target?: string;
  icon: IconName;
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    target: ".side-nav",
    icon: "home",
    title: "Everything in one place",
    body: "Home, Tasks, Calendar, Inbox and Study sit here, with Claude one click away.",
  },
  {
    target: ".side-scroll",
    icon: "pages",
    title: "Your pages",
    body: "Pages, documents, spreadsheets, drawings and slides share one tree. Drag to reorganize, and pin what you use most.",
  },
  {
    target: "[data-tour=\"search\"]",
    icon: "search",
    title: "Find anything",
    body: "Search every page or run a command from here, or press Ctrl+K anywhere. Arabic and English both work.",
  },
  {
    target: "[data-tour=\"new\"]",
    icon: "add",
    title: "Make something new",
    body: "Start a page, a document on paper, a spreadsheet with formulas, a presentation or a drawing. Ctrl+N makes a page.",
  },
  {
    target: ".side-item[data-tour=\"claude\"]",
    icon: "assistant",
    title: "Claude works with your pages",
    body: "Ask it to write, summarize or reorganize. Every change it makes can be undone.",
  },
  {
    target: ".side-bottom",
    icon: "settings",
    title: "Make it yours",
    body: "Your profile and settings: the interface language, AI providers, backups and more.",
  },
];

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export const CARD_W = 340;
const GAP = 14;

/** Where the card goes: beside the lit part on the side with the most room, kept on screen. */
export function placeCard(box: Box | null, card: { width: number; height: number }, view: { width: number; height: number }): { top: number; left: number } {
  const clampX = (x: number) => Math.max(12, Math.min(x, view.width - card.width - 12));
  const clampY = (y: number) => Math.max(12, Math.min(y, view.height - card.height - 12));
  if (!box) return { top: clampY((view.height - card.height) / 2), left: clampX((view.width - card.width) / 2) };
  const right = view.width - (box.left + box.width);
  const left = box.left;
  if (right >= card.width + GAP * 2 || left >= card.width + GAP * 2) {
    const x = right >= left ? box.left + box.width + GAP : box.left - card.width - GAP;
    return { top: clampY(box.top), left: clampX(x) };
  }
  const below = view.height - (box.top + box.height);
  const y = below >= card.height + GAP ? box.top + box.height + GAP : box.top - card.height - GAP;
  return { top: clampY(y), left: clampX(box.left) };
}
