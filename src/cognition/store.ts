/**
 * Cognition's data lives in settings (one key per kind), so it is saved with
 * the workspace, backed up with it, and needs no new tables.
 */
import { useStore } from "../state/store";
import type { Aha, Card, Jigsaw, Question, Spark } from "./model";

const KEYS = {
  cards: "cognition.cards",
  questions: "cognition.questions",
  sparks: "cognition.sparks",
  aha: "cognition.aha",
  jigsaws: "cognition.jigsaws",
} as const;

type Kinds = { cards: Card; questions: Question; sparks: Spark; aha: Aha; jigsaws: Jigsaw };
type Kind = keyof Kinds;

const EMPTY: never[] = [];

export function useCognition<K extends Kind>(kind: K): Kinds[K][] {
  return useStore((s) => (s.settings[KEYS[kind]] as Kinds[K][] | undefined) ?? (EMPTY as Kinds[K][]));
}

export function readCognition<K extends Kind>(kind: K): Kinds[K][] {
  return (useStore.getState().settings[KEYS[kind]] as Kinds[K][] | undefined) ?? [];
}

function write<K extends Kind>(kind: K, list: Kinds[K][]) {
  useStore.getState().setSetting(KEYS[kind], list);
}

/** Add or replace by id. */
export function putCognition<K extends Kind>(kind: K, item: Kinds[K]) {
  const list = readCognition(kind);
  const i = list.findIndex((x) => x.id === item.id);
  write(kind, i < 0 ? [...list, item] : list.map((x, j) => (j === i ? item : x)));
}

export function removeCognition(kind: Kind, id: string) {
  write(kind, readCognition(kind).filter((x) => x.id !== id) as never[]);
}

export function newCognitionId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Keep a moment of understanding in the Aha! journal. */
export function recordAha(kind: Aha["kind"], title: string, detail?: string, pageId?: string | null) {
  putCognition("aha", { id: newCognitionId("aha"), at: Date.now(), kind, title, detail, pageId: pageId ?? null });
}
