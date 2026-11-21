/**
 * Cognition: the home of your own thinking. Today's reviews and open
 * questions, your memory cards, sparks between ideas, Jigsaw boards and the
 * Aha! journal. Every view is drawn in Cognition's hand-drawn style.
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { PageMeta } from "../lib/types";
import { pageTitle, useStore } from "../state/store";
import { tr } from "../i18n/ui";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Segmented } from "../ui/Segmented";
import { relTime } from "../ui/misc";
import { choosePage } from "../editor/choosePage";
import { promptText } from "../editor/prompt";
import { Art } from "./art";
import {
  JIGSAW_TEMPLATES,
  cardAnswer,
  cardQuestion,
  cardState,
  completeness,
  dayOf,
  dueCards,
  newCard,
  questionAge,
  resurface,
  review,
  templateOf,
  type CardState,
  type Grade,
  type Jigsaw,
  type PieceKind,
  type Question,
  type Spark,
} from "./model";
import { newCognitionId, putCognition, readCognition, recordAha, removeCognition, useCognition } from "./store";

/** All pages as a list, stable between renders. */
function usePageList(): PageMeta[] {
  const map = useStore((s) => s.pages);
  return useMemo(() => Object.values(map), [map]);
}

export type CognitionSection = "today" | "memory" | "questions" | "sparks" | "jigsaw" | "aha";

const SECTIONS: { value: CognitionSection; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "memory", label: "Memory" },
  { value: "questions", label: "Questions" },
  { value: "sparks", label: "Sparks" },
  { value: "jigsaw", label: "Jigsaw" },
  { value: "aha", label: "Aha!" },
];

export const CARD_ART: Record<CardState, string> = {
  new: "mem_new",
  learning: "mem_recalled",
  remembered: "mem_remembered",
  fading: "mem_forgotten",
  outdated: "mem_outdated",
};
const CARD_LABEL: Record<CardState, string> = { new: "New", learning: "Learning", remembered: "Remembered", fading: "Fading", outdated: "Outdated" };

export function CognitionView({ section }: { section?: string }) {
  const [tab, setTab] = useState<CognitionSection>((SECTIONS.find((s) => s.value === section)?.value ?? "today") as CognitionSection);
  useEffect(() => {
    if (section && SECTIONS.some((s) => s.value === section)) setTab(section as CognitionSection);
  }, [section]);
  return (
    <div className="pl-view cg-view">
      <header className="cg-head">
        <Art name="aha-27" size={58} className="cg-head-mark" />
        <div>
          <h1 className="pl-title">Cognition</h1>
          <p className="pl-sub">{tr("Aha! · Cognition 27")} · {tr("Tools for your own thinking, understanding and memory")}</p>
        </div>
      </header>
      <div className="cg-tabs">
        <Segmented value={tab} onChange={setTab} options={SECTIONS.map((s) => ({ value: s.value, label: tr(s.label) }))} label={tr("Cognition")} />
      </div>
      {tab === "today" && <TodayPanel go={setTab} />}
      {tab === "memory" && <MemoryPanel />}
      {tab === "questions" && <QuestionsPanel />}
      {tab === "sparks" && <SparksPanel />}
      {tab === "jigsaw" && <JigsawPanel />}
      {tab === "aha" && <AhaPanel />}
    </div>
  );
}

/* ---------------------------------------------------------------- */

function Sticker({ art, title, children, action, tone = "plain" }: { art?: string; title: string; children?: React.ReactNode; action?: React.ReactNode; tone?: "plain" | "pink" | "blue" | "cream" | "yellow" }) {
  return (
    <section className={`cg-card cg-${tone}`}>
      <div className="cg-card-head">
        {art && <Art name={art} size={44} />}
        <h2 className="cg-card-title">{title}</h2>
        {action && <div className="cg-card-action">{action}</div>}
      </div>
      {children}
    </section>
  );
}

function Empty({ art, title, text }: { art: string; title: string; text: string }) {
  return (
    <div className="cg-empty">
      <Art name={art} size={96} />
      <div className="cg-empty-title">{tr(title)}</div>
      <div className="cg-empty-text">{tr(text)}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Today                                                             */
/* ---------------------------------------------------------------- */

function TodayPanel({ go }: { go: (s: CognitionSection) => void }) {
  const cards = useCognition("cards");
  const questions = useCognition("questions");
  const jigsaws = useCognition("jigsaws");
  const aha = useCognition("aha");
  const pages = usePageList();
  const openPage = useStore((s) => s.openPage);
  const today = dayOf(Date.now());
  const due = dueCards(cards, today);
  const waiting = questions.filter((q) => q.state !== "resolved").sort((a, b) => a.created - b.created);
  const back = useMemo(
    () => resurface(pages.filter((p) => !p.deletedAt && !p.archived && p.kind !== "template").map((p) => ({ ...p, updatedAt: p.openedAt ?? p.updatedAt })), Date.now()),
    [pages],
  );
  const unfinished = jigsaws.map((j) => ({ j, c: completeness(j) })).filter((x) => x.c.ratio < 1);
  const [reviewing, setReviewing] = useState(false);

  if (reviewing) return <ReviewSession onDone={() => setReviewing(false)} />;

  return (
    <div className="cg-grid">
      <Sticker art={due.length ? "recall" : "rest"} title={due.length ? `${due.length} ${tr("cards to review")}` : tr("Nothing to review today")} tone="pink"
        action={due.length ? <Button variant="tinted" onClick={() => setReviewing(true)}>{tr("Start")}</Button> : <Button onClick={() => go("memory")}>{tr("Add cards")}</Button>}>
        <p className="cg-note">{tr("A few minutes a day keeps what you learned from fading.")}</p>
      </Sticker>

      <Sticker art="ctx_question" title={tr("Open questions")} tone="blue" action={<Button onClick={() => go("questions")}>{tr("All")}</Button>}>
        {waiting.length === 0 ? (
          <p className="cg-note">{tr("No open questions. Write one when something does not make sense yet.")}</p>
        ) : (
          <ul className="cg-list">
            {waiting.slice(0, 4).map((q) => (
              <li key={q.id}>
                <span className="cg-dot" data-state={q.state} />
                <span className="cg-li-text bidi" dir="auto">{q.text}</span>
                <span className="cg-li-meta">{questionAge(q, Date.now())}d</span>
              </li>
            ))}
          </ul>
        )}
      </Sticker>

      {back && (
        <Sticker art="mem_restored" title={tr("From a while ago")} tone="cream">
          <button className="cg-page-link bidi" dir="auto" onClick={() => openPage(back.id)}>
            {pageTitle(back)}
          </button>
          <p className="cg-note">{tr("You last opened it")} {relTime(back.updatedAt)}. {tr("An old idea next to a new one is where sparks come from.")}</p>
        </Sticker>
      )}

      {unfinished.length > 0 && (
        <Sticker art="jigsaw" title={tr("Missing pieces")} tone="yellow" action={<Button onClick={() => go("jigsaw")}>{tr("Boards")}</Button>}>
          <ul className="cg-list">
            {unfinished.slice(0, 3).map(({ j, c }) => {
              const gap = c.slots.find((s) => s.missing > 0);
              return (
                <li key={j.id}>
                  <span className="cg-li-text bidi" dir="auto">{j.title}</span>
                  <span className="cg-li-meta">{gap ? `${tr(gap.slot.label)} (${gap.missing})` : ""} · {Math.round(c.ratio * 100)}%</span>
                </li>
              );
            })}
          </ul>
        </Sticker>
      )}

      <Sticker art="discover" title={tr("Latest Aha! moments")} action={<Button onClick={() => go("aha")}>{tr("Journal")}</Button>}>
        {aha.length === 0 ? (
          <p className="cg-note">{tr("Resolve a question or make a spark, and the moment is kept here.")}</p>
        ) : (
          <ul className="cg-list">
            {[...aha].sort((a, b) => b.at - a.at).slice(0, 4).map((a) => (
              <li key={a.id}>
                <span className="cg-li-text bidi" dir="auto">{a.title}</span>
                <span className="cg-li-meta">{relTime(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Sticker>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Memory                                                            */
/* ---------------------------------------------------------------- */

export function addCards(list: { front: string; back: string }[], pageId: string | null) {
  const now = Date.now();
  for (const c of list) putCognition("cards", newCard(newCognitionId("card"), c.front, c.back, pageId, now));
}

function MemoryPanel() {
  const cards = useCognition("cards");
  const pages = usePageList();
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const today = dayOf(Date.now());
  const due = dueCards(cards, today);

  if (reviewing) return <ReviewSession onDone={() => setReviewing(false)} />;

  const add = () => {
    if (!front.trim()) return;
    addCards([{ front, back }], null);
    setFront("");
    setBack("");
  };
  const byState = (s: CardState) => cards.filter((c) => cardState(c, today) === s).length;

  return (
    <div className="cg-stack">
      <div className="cg-states">
        {(["new", "learning", "remembered", "fading", "outdated"] as CardState[]).map((s) => (
          <div key={s} className="cg-state">
            <Art name={CARD_ART[s]} size={40} />
            <b>{byState(s)}</b>
            <span>{tr(CARD_LABEL[s])}</span>
          </div>
        ))}
        <div className="cg-state-go">
          <Button variant="tinted" disabled={!due.length} onClick={() => setReviewing(true)}>
            {due.length ? `${tr("Review")} ${due.length}` : tr("All caught up")}
          </Button>
        </div>
      </div>

      <Sticker art="remember" title={tr("New card")} tone="cream">
        <div className="cg-form">
          <textarea className="cg-input bidi" dir="auto" rows={2} placeholder={tr("What to remember. Put {{braces}} around a part to hide it.")} value={front} onChange={(e) => setFront(e.target.value)} />
          <input className="cg-input bidi" dir="auto" placeholder={tr("Answer (not needed with braces)")} value={back} onChange={(e) => setBack(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <div className="cg-form-foot">
            <span className="cg-note">{tr("In any page, type /card, or write \"question :: answer\" and choose Remember from the block menu.")}</span>
            <Button variant="tinted" onClick={add} disabled={!front.trim()}>{tr("Add")}</Button>
          </div>
        </div>
      </Sticker>

      {cards.length === 0 ? (
        <Empty art="mem_discovery" title="No cards yet" text="Cards are the things you want to keep. Worlds brings each one back just before you would forget it." />
      ) : (
        <div className="cg-cards">
          {[...cards].sort((a, b) => a.due - b.due).map((c) => {
            const st = cardState(c, today);
            const page = c.pageId ? pages.find((p) => p.id === c.pageId) : null;
            return (
              <div key={c.id} className="cg-mini" data-state={st}>
                <Art name={CARD_ART[st]} size={34} />
                <div className="cg-mini-body">
                  <div className="cg-mini-q bidi" dir="auto">{cardQuestion(c)}</div>
                  <div className="cg-mini-meta">
                    {tr(CARD_LABEL[st])}
                    {c.reps > 0 && !c.outdated ? ` · ${tr("next in")} ${Math.max(0, c.due - today)}${tr("d")}` : ""}
                    {page ? ` · ${pageTitle(page)}` : ""}
                  </div>
                </div>
                <button className="cg-icon-btn" title={c.outdated ? tr("Use again") : tr("Mark as outdated")} onClick={() => putCognition("cards", { ...c, outdated: !c.outdated })}>
                  <Icon name={c.outdated ? "restore" : "archive"} size={15} />
                </button>
                <button className="cg-icon-btn" title={tr("Delete")} onClick={() => removeCognition("cards", c.id)}>
                  <Icon name="delete" size={15} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ReviewSession({ onDone }: { onDone: () => void }) {
  const [queue] = useState(() => dueCards(readCognition("cards"), dayOf(Date.now())).map((c) => c.id));
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const [tally, setTally] = useState({ again: 0, good: 0 });
  const cards = useCognition("cards");
  const card = cards.find((c) => c.id === queue[i]);

  const grade = (g: Grade) => {
    if (!card) return;
    const next = review(card, g, Date.now());
    putCognition("cards", next);
    if (card.lapses > 0 && card.reps === 0 && g !== "again") recordAha("card", cardAnswer(card), tr("Came back after slipping away"), card.pageId);
    setTally((t) => ({ again: t.again + (g === "again" ? 1 : 0), good: t.good + (g === "again" ? 0 : 1) }));
    setShown(false);
    setI(i + 1);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,[contenteditable]")) return;
      if (e.key === " " && !shown) {
        e.preventDefault();
        setShown(true);
      } else if (shown && ["1", "2", "3", "4"].includes(e.key)) grade((["again", "hard", "good", "easy"] as Grade[])[Number(e.key) - 1]);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  if (!card) {
    return (
      <div className="cg-review">
        <div className="cg-review-done">
          <Art name="credit_completed" size={120} />
          <h2>{tr("Session done")}</h2>
          <p className="cg-note">
            {tally.good} {tr("remembered")} · {tally.again} {tr("to see again")}
          </p>
          <Button variant="tinted" onClick={onDone}>{tr("Back")}</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="cg-review">
      <div className="cg-review-top">
        <button className="cg-icon-btn" onClick={onDone} title={tr("End the session")}>
          <Icon name="close" size={16} />
        </button>
        <div className="cg-progress"><i style={{ width: `${(i / queue.length) * 100}%` }} /></div>
        <span className="cg-li-meta">{i + 1} / {queue.length}</span>
      </div>
      <div className={`cg-flash ${shown ? "is-shown" : ""}`}>
        <Art name={shown ? "understand" : "think"} size={72} className="cg-flash-art" />
        <div className="cg-flash-q bidi" dir="auto">{cardQuestion(card)}</div>
        {shown && <div className="cg-flash-a bidi" dir="auto">{cardAnswer(card) || tr("(no answer written)")}</div>}
      </div>
      {!shown ? (
        <div className="cg-review-actions">
          <Button variant="tinted" onClick={() => setShown(true)}>{tr("Show the answer")}</Button>
          <span className="cg-note">{tr("Space")}</span>
        </div>
      ) : (
        <div className="cg-grades">
          {([
            ["again", "Forgot", "cg-g-again"],
            ["hard", "Hard", "cg-g-hard"],
            ["good", "Got it", "cg-g-good"],
            ["easy", "Easy", "cg-g-easy"],
          ] as [Grade, string, string][]).map(([g, label, cls], n) => (
            <button key={g} className={`cg-grade ${cls}`} onClick={() => grade(g)}>
              <b>{tr(label)}</b>
              <span>{n + 1}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Questions                                                         */
/* ---------------------------------------------------------------- */

export function addQuestion(text: string, pageId: string | null): Question {
  const q: Question = { id: newCognitionId("q"), pageId, text: text.trim(), state: "open", created: Date.now(), attempts: [] };
  putCognition("questions", q);
  return q;
}

export async function resolveQuestion(q: Question, anchor?: HTMLElement) {
  const answer = await promptText({ title: tr("What is the answer?"), placeholder: tr("In your own words"), confirm: tr("Resolve") });
  if (answer == null) return;
  let source: string | null = null;
  if (anchor && window.confirm(tr("Link a page that holds the answer?"))) source = await choosePage(anchor);
  putCognition("questions", { ...q, state: "resolved", answer, source, resolved: Date.now() });
  recordAha("question", q.text, answer, source ?? q.pageId);
}

const Q_ART: Record<Question["state"], string> = { open: "ctx_question", unsure: "ctx_maybe_misunderstood", resolved: "ctx_resolved" };
const Q_LABEL: Record<Question["state"], string> = { open: "Open", unsure: "Not sure", resolved: "Resolved" };

function QuestionsPanel() {
  const questions = useCognition("questions");
  const pages = usePageList();
  const openPage = useStore((s) => s.openPage);
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<"open" | "resolved">("open");
  const list = questions.filter((q) => (filter === "open" ? q.state !== "resolved" : q.state === "resolved")).sort((a, b) => b.created - a.created);

  const add = () => {
    if (!text.trim()) return;
    addQuestion(text, null);
    setText("");
  };

  return (
    <div className="cg-stack">
      <div className="cg-ask">
        <Art name="ctx_question" size={40} />
        <input className="cg-input bidi" dir="auto" placeholder={tr("What do you not understand yet?")} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <Button variant="tinted" onClick={add} disabled={!text.trim()}>{tr("Ask")}</Button>
      </div>
      <Segmented value={filter} onChange={setFilter} options={[{ value: "open", label: tr("Waiting") }, { value: "resolved", label: tr("Resolved") }]} label={tr("Questions")} />
      {list.length === 0 ? (
        filter === "open" ? (
          <Empty art="ctx_understood" title="Nothing waiting" text="Write a question whenever something does not click. It stays here until you answer it, and the answer becomes an Aha! moment." />
        ) : (
          <Empty art="ctx_answer" title="No answers yet" text="Resolved questions keep their answer and where you found it." />
        )
      ) : (
        <div className="cg-cards">
          {list.map((q) => {
            const page = q.pageId ? pages.find((p) => p.id === q.pageId) : null;
            const src = q.source ? pages.find((p) => p.id === q.source) : null;
            return (
              <div key={q.id} className="cg-question" data-state={q.state}>
                <Art name={Q_ART[q.state]} size={40} />
                <div className="cg-mini-body">
                  <div className="cg-mini-q bidi" dir="auto">{q.text}</div>
                  {q.answer && <div className="cg-answer bidi" dir="auto">{q.answer}</div>}
                  <div className="cg-mini-meta">
                    {tr(Q_LABEL[q.state])} · {relTime(q.resolved ?? q.created)}
                    {page ? <> · <button className="cg-inline-link" onClick={() => openPage(page.id)}>{pageTitle(page)}</button></> : null}
                    {src ? <> · {tr("answer in")} <button className="cg-inline-link" onClick={() => openPage(src.id)}>{pageTitle(src)}</button></> : null}
                    {q.attempts.length ? ` · ${q.attempts.length} ${tr("tries")}` : ""}
                  </div>
                </div>
                {q.state !== "resolved" && (
                  <>
                    <button className="cg-icon-btn" title={q.state === "unsure" ? tr("Back to open") : tr("I think I get it, not sure")} onClick={() => putCognition("questions", { ...q, state: q.state === "unsure" ? "open" : "unsure" })}>
                      <Icon name="info" size={15} />
                    </button>
                    <button
                      className="cg-icon-btn"
                      title={tr("Note a try")}
                      onClick={async () => {
                        const note = await promptText({ title: tr("What did you try?"), placeholder: tr("Read chapter 3 again") });
                        if (note) putCognition("questions", { ...q, attempts: [...q.attempts, { at: Date.now(), note }] });
                      }}
                    >
                      <Icon name="edit" size={15} />
                    </button>
                    <Button variant="tinted" onClick={(e) => resolveQuestion(q, e.currentTarget)}>{tr("Resolve")}</Button>
                  </>
                )}
                <button className="cg-icon-btn" title={tr("Delete")} onClick={() => removeCognition("questions", q.id)}>
                  <Icon name="delete" size={15} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Sparks                                                            */
/* ---------------------------------------------------------------- */

export async function makeSpark(anchor: HTMLElement, from?: { pageId: string; blockId?: string | null; text: string }) {
  const pages = Object.values(useStore.getState().pages);
  let a = from;
  if (!a) {
    const id = await choosePage(anchor);
    if (!id) return;
    const p = pages.find((x) => x.id === id);
    a = { pageId: id, text: p ? pageTitle(p) : "" };
  }
  const bId = await choosePage(anchor);
  if (!bId) return;
  const b = pages.find((x) => x.id === bId);
  const note = await promptText({ title: tr("What did you see when these two met?"), placeholder: tr("They are the same idea from two sides"), confirm: tr("Make the spark") });
  if (note == null) return;
  const spark: Spark = { id: newCognitionId("spark"), a, b: { pageId: bId, text: b ? pageTitle(b) : "" }, note, at: Date.now() };
  putCognition("sparks", spark);
  recordAha("spark", note || `${a.text} + ${spark.b.text}`, `${a.text} + ${spark.b.text}`, a.pageId);
}

function SparksPanel() {
  const sparks = useCognition("sparks");
  const pages = usePageList();
  const openPage = useStore((s) => s.openPage);
  const [ideas, setIdeas] = useState<{ page: PageMeta; others: { id: string; title: string }[] }[] | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const recent = pages
        .filter((p) => !p.deletedAt && !p.archived && p.kind !== "template" && pageTitle(p).trim().length >= 4)
        .sort((a, b) => (b.openedAt ?? b.updatedAt) - (a.openedAt ?? a.updatedAt))
        .slice(0, 12);
      const links = await api.linkGraph().catch(() => [] as [string, string][]);
      const out: { page: PageMeta; others: { id: string; title: string }[] }[] = [];
      for (const p of recent) {
        const hits = await api.search(pageTitle(p), 8, false).catch(() => []);
        const linked = new Set(links.filter(([from, to]) => to === p.id || from === p.id).flat());
        const others = hits.filter((h) => h.pageId !== p.id && !linked.has(h.pageId)).slice(0, 3).map((h) => ({ id: h.pageId, title: h.title }));
        if (others.length) out.push({ page: p, others });
      }
      if (live) setIdeas(out.slice(0, 6));
    })();
    return () => {
      live = false;
    };
  }, [pages]);

  return (
    <div className="cg-stack">
      <div className="cg-ask">
        <Art name="connect" size={40} />
        <p className="cg-note cg-grow">{tr("A spark joins two ideas and keeps what you saw between them. Pick two pages, or use Spark from any block's menu.")}</p>
        <Button variant="tinted" onClick={(e) => makeSpark(e.currentTarget)}>{tr("New spark")}</Button>
      </div>

      {sparks.length === 0 ? (
        <Empty art="ctx_connections" title="No sparks yet" text="When two ideas from different places turn out to belong together, make a spark." />
      ) : (
        <div className="cg-sparks">
          {[...sparks].sort((a, b) => b.at - a.at).map((s) => (
            <div key={s.id} className="cg-spark">
              <button className="cg-spark-end cg-pink bidi" dir="auto" onClick={() => openPage(s.a.pageId)}>{s.a.text || tr("Untitled")}</button>
              <div className="cg-spark-mid">
                <Art name="discover" size={44} />
              </div>
              <button className="cg-spark-end cg-blue bidi" dir="auto" onClick={() => openPage(s.b.pageId)}>{s.b.text || tr("Untitled")}</button>
              {s.note && <div className="cg-spark-note bidi" dir="auto">{s.note}</div>}
              <div className="cg-spark-foot">
                <span className="cg-li-meta">{relTime(s.at)}</span>
                <button className="cg-icon-btn" title={tr("Delete")} onClick={() => removeCognition("sparks", s.id)}>
                  <Icon name="delete" size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Sticker art="observe" title={tr("Ideas that might meet")} tone="cream">
        <p className="cg-note">{tr("These pages mention each other's names without a link between them.")}</p>
        {ideas == null ? (
          <p className="cg-note">{tr("Looking...")}</p>
        ) : ideas.length === 0 ? (
          <p className="cg-note">{tr("Nothing for now.")}</p>
        ) : (
          <ul className="cg-list">
            {ideas.map(({ page, others }) =>
              others.map((o) => (
                <li key={page.id + o.id}>
                  <span className="cg-li-text bidi" dir="auto">{pageTitle(page)}</span>
                  <span className="cg-li-meta">+</span>
                  <span className="cg-li-text bidi" dir="auto">{o.title}</span>
                  <button
                    className="cg-chip"
                    onClick={async () => {
                      const note = await promptText({ title: tr("What did you see when these two met?"), confirm: tr("Make the spark") });
                      if (note == null) return;
                      putCognition("sparks", { id: newCognitionId("spark"), a: { pageId: page.id, text: pageTitle(page) }, b: { pageId: o.id, text: o.title }, note, at: Date.now() });
                      recordAha("spark", note || `${pageTitle(page)} + ${o.title}`, undefined, page.id);
                    }}
                  >
                    {tr("Spark")}
                  </button>
                </li>
              )),
            )}
          </ul>
        )}
      </Sticker>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Jigsaw                                                            */
/* ---------------------------------------------------------------- */

const PIECE_ART: Record<PieceKind, string> = { page: "b_details", task: "act_approve", event: "state_delayed", question: "ctx_question", source: "ctx_source", note: "ctx_answer" };

function JigsawPanel() {
  const boards = useCognition("jigsaws");
  const [open, setOpen] = useState<string | null>(null);
  const board = boards.find((b) => b.id === open);
  if (board) return <JigsawBoard board={board} onBack={() => setOpen(null)} />;

  const create = async (template: string) => {
    const title = await promptText({ title: tr("What is the board for?"), placeholder: tr("History essay"), confirm: tr("Create") });
    if (!title) return;
    const j: Jigsaw = { id: newCognitionId("jig"), title, template, pieces: [], created: Date.now() };
    putCognition("jigsaws", j);
    setOpen(j.id);
  };

  return (
    <div className="cg-stack">
      <div className="cg-ask">
        <Art name="jigsaw" size={44} />
        <p className="cg-note cg-grow">{tr("A Jigsaw board gathers the pieces of one thing: pages, tasks, dates, questions and sources. It shows what is still missing.")}</p>
      </div>
      <div className="cg-templates">
        {JIGSAW_TEMPLATES.map((t) => (
          <button key={t.id} className="cg-template" onClick={() => create(t.id)}>
            <Icon name="puzzle" size={22} />
            <b>{tr(t.label)}</b>
            <span>{t.slots.map((s) => tr(s.label)).join(", ")}</span>
          </button>
        ))}
      </div>
      {boards.length === 0 ? (
        <Empty art="credit_collaboration" title="No boards yet" text="Pick a kind of board above to start one." />
      ) : (
        <div className="cg-boards">
          {boards.map((b) => {
            const c = completeness(b);
            return (
              <button key={b.id} className="cg-board-tile" onClick={() => setOpen(b.id)}>
                <JigsawMeter ratio={c.ratio} />
                <b className="bidi" dir="auto">{b.title}</b>
                <span>{tr(templateOf(b).label)} · {Math.round(c.ratio * 100)}%</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Four puzzle pieces that fill in as the board does. */
function JigsawMeter({ ratio }: { ratio: number }) {
  const filled = Math.round(ratio * 4);
  const piece = "M2 2 H14 V6 Q19 3 19 9 Q19 15 14 12 V22 H2 V16 Q-3 19 -3 13 Q-3 7 2 10 Z";
  const at = [
    [4, 4],
    [26, 4],
    [4, 28],
    [26, 28],
  ];
  const colors = ["#FF9EC6", "#055BEE", "#FFD63D", "#FF9EC6"];
  return (
    <svg className="cg-meter" viewBox="-4 0 56 54" width="56" height="54" aria-hidden="true">
      {at.map(([x, y], i) => (
        <path key={i} d={piece} transform={`translate(${x} ${y})`} fill={i < filled ? colors[i] : "none"} stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeDasharray={i < filled ? undefined : "3 3"} />
      ))}
    </svg>
  );
}

function JigsawBoard({ board, onBack }: { board: Jigsaw; onBack: () => void }) {
  const pages = usePageList();
  const openPage = useStore((s) => s.openPage);
  const c = completeness(board);
  const save = (b: Jigsaw) => {
    const before = completeness(board).ratio;
    putCognition("jigsaws", b);
    if (before < 1 && completeness(b).ratio >= 1) recordAha("jigsaw", b.title, tr("Every piece is in place"));
  };

  const addPiece = async (slotId: string, kind: PieceKind, anchor: HTMLElement) => {
    let ref: string | null = null;
    let label = "";
    if (kind === "page" || kind === "task" || kind === "event") {
      ref = await choosePage(anchor);
      if (!ref) return;
      const p = pages.find((x) => x.id === ref);
      label = p ? pageTitle(p) : "";
    } else {
      const t = await promptText({ title: kind === "source" ? tr("Source: a link or a book") : kind === "question" ? tr("The question") : tr("Write the piece"), confirm: tr("Add") });
      if (!t) return;
      label = t;
      if (/^https?:\/\//.test(t)) ref = t;
    }
    save({ ...board, pieces: [...board.pieces, { id: newCognitionId("pc"), slot: slotId, kind, ref, label }] });
  };

  return (
    <div className="cg-stack">
      <div className="cg-board-head">
        <button className="cg-icon-btn" onClick={onBack} title={tr("All boards")}>
          <Icon name="back" size={16} />
        </button>
        <JigsawMeter ratio={c.ratio} />
        <div className="cg-grow">
          <h2 className="cg-board-title bidi" dir="auto">{board.title}</h2>
          <div className="cg-li-meta">{tr(templateOf(board).label)} · {Math.round(c.ratio * 100)}% {tr("complete")}</div>
        </div>
        <button
          className="cg-icon-btn"
          title={tr("Delete the board")}
          onClick={() => {
            if (window.confirm(tr("Delete this board? The pages in it stay."))) {
              removeCognition("jigsaws", board.id);
              onBack();
            }
          }}
        >
          <Icon name="delete" size={16} />
        </button>
      </div>
      <div className="cg-slots">
        {c.slots.map(({ slot, have, missing }) => (
          <section key={slot.id} className={`cg-slot ${missing ? "is-missing" : "is-full"}`}>
            <div className="cg-slot-head">
              <Art name={PIECE_ART[slot.kind]} size={32} />
              <b>{tr(slot.label)}</b>
              <span className="cg-li-meta">{have}/{slot.need}</span>
            </div>
            <div className="cg-pieces">
              {board.pieces
                .filter((p) => p.slot === slot.id)
                .map((p) => (
                  <div key={p.id} className="cg-piece">
                    {p.ref && !/^https?:/.test(p.ref) ? (
                      <button className="cg-inline-link bidi" dir="auto" onClick={() => openPage(p.ref!)}>{p.label || tr("Untitled")}</button>
                    ) : p.ref ? (
                      <a className="cg-inline-link" href={p.ref} target="_blank" rel="noreferrer">{p.label}</a>
                    ) : (
                      <span className="bidi" dir="auto">{p.label}</span>
                    )}
                    <button className="cg-icon-btn" title={tr("Remove")} onClick={() => save({ ...board, pieces: board.pieces.filter((x) => x.id !== p.id) })}>
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                ))}
              {Array.from({ length: missing }).map((_, i) => (
                <button key={i} className="cg-piece cg-piece-gap" onClick={(e) => addPiece(slot.id, slot.kind, e.currentTarget)}>
                  <Icon name="add" size={13} /> {tr("Missing piece")}
                </button>
              ))}
              {!missing && (
                <button className="cg-piece cg-piece-more" onClick={(e) => addPiece(slot.id, slot.kind, e.currentTarget)}>
                  <Icon name="add" size={13} />
                </button>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Aha! journal                                                      */
/* ---------------------------------------------------------------- */

const AHA_ART: Record<string, string> = { question: "ctx_resolved", spark: "discover", card: "mem_restored", jigsaw: "credit_completed", note: "understand" };

function AhaPanel() {
  const aha = useCognition("aha");
  const openPage = useStore((s) => s.openPage);
  const lang = document.documentElement.lang === "ar" ? "ar" : "en";
  const groups = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en", { month: "long", year: "numeric" });
    const map = new Map<string, typeof aha>();
    for (const a of [...aha].sort((x, y) => y.at - x.at)) {
      const k = fmt.format(new Date(a.at));
      map.set(k, [...(map.get(k) ?? []), a]);
    }
    return [...map.entries()];
  }, [aha, lang]);

  const add = async () => {
    const title = await promptText({ title: tr("What just clicked?"), placeholder: tr("Fractions are just division"), confirm: tr("Keep it") });
    if (title) recordAha("note", title);
  };

  return (
    <div className="cg-stack">
      <div className="cg-ask">
        <Art name="aha-27" size={44} />
        <p className="cg-note cg-grow">{tr("The moments when something suddenly made sense: resolved questions, sparks, finished boards, and the ones you write down yourself.")}</p>
        <Button variant="tinted" onClick={add}>{tr("Write one")}</Button>
      </div>
      {groups.length === 0 ? (
        <Empty art="think" title="No Aha! moments yet" text="They arrive when two ideas meet. Keep asking." />
      ) : (
        groups.map(([month, list]) => (
          <div key={month} className="cg-month">
            <h3 className="cg-month-title">{month}</h3>
            <ol className="cg-timeline">
              {list.map((a) => (
                <li key={a.id}>
                  <Art name={AHA_ART[a.kind] ?? "understand"} size={38} />
                  <div className="cg-mini-body">
                    <div className="cg-mini-q bidi" dir="auto">{a.title}</div>
                    {a.detail && <div className="cg-answer bidi" dir="auto">{a.detail}</div>}
                    <div className="cg-mini-meta">
                      {relTime(a.at)}
                      {a.pageId ? <> · <button className="cg-inline-link" onClick={() => openPage(a.pageId!)}>{tr("Open the page")}</button></> : null}
                    </div>
                  </div>
                  <button className="cg-icon-btn" title={tr("Delete")} onClick={() => removeCognition("aha", a.id)}>
                    <Icon name="delete" size={14} />
                  </button>
                </li>
              ))}
            </ol>
          </div>
        ))
      )}
    </div>
  );
}
