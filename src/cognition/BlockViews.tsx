/** Views for Cognition's blocks inside pages. */
import { useEffect, useState } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { tr } from "../i18n/ui";
import { Icon } from "../ui/Icon";
import { Art } from "./art";
import { cardAnswer, cardQuestion, cardState, dayOf, fingerprint, newCard, percentages, type Origin } from "./model";
import { newCognitionId, putCognition, readCognition, removeCognition, useCognition } from "./store";
import { CARD_ART, addQuestion, resolveQuestion } from "./CognitionView";
import type { Row } from "./blocks";

const pageIdOf = (editor: Editor) => (editor.storage as unknown as { worlds?: { pageId: string } }).worlds?.pageId ?? null;
const rowId = () => Math.random().toString(36).slice(2, 9);

function Head({ art, label, children }: { art: string; label: string; children?: React.ReactNode }) {
  return (
    <div className="cg-block-head" contentEditable={false}>
      <Art name={art} size={28} />
      <span className="cg-grow">{tr(label)}</span>
      {children}
    </div>
  );
}

function Rows({ rows, onChange, placeholder, weights }: { rows: Row[]; onChange: (r: Row[]) => void; placeholder: string; weights?: boolean }) {
  return (
    <div className="cg-rows">
      {rows.map((r, i) => (
        <div key={r.id} className="cg-block-row">
          <input
            className="cg-input bidi"
            dir="auto"
            value={r.text}
            placeholder={tr(placeholder)}
            onChange={(e) => onChange(rows.map((x) => (x.id === r.id ? { ...x, text: e.target.value } : x)))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const next = [...rows];
                next.splice(i + 1, 0, { id: rowId(), text: "", weight: weights ? 3 : undefined });
                onChange(next);
              } else if (e.key === "Backspace" && !r.text && rows.length > 1) {
                e.preventDefault();
                onChange(rows.filter((x) => x.id !== r.id));
              }
            }}
          />
          {weights && (
            <input
              className="cg-input cg-weight"
              type="number"
              min={1}
              max={5}
              title={tr("How much it matters, 1 to 5")}
              value={r.weight ?? 3}
              onChange={(e) => onChange(rows.map((x) => (x.id === r.id ? { ...x, weight: Math.min(5, Math.max(1, Number(e.target.value) || 1)) } : x)))}
            />
          )}
          <button className="cg-icon-btn" title={tr("Remove")} onClick={() => onChange(rows.filter((x) => x.id !== r.id))}>
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
      <button className="cg-piece cg-piece-more" onClick={() => onChange([...rows, { id: rowId(), text: "", weight: weights ? 3 : undefined }])}>
        <Icon name="add" size={13} /> {tr("Add")}
      </button>
    </div>
  );
}

/* Memory card ------------------------------------------------------ */

export function CardBlockView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const cards = useCognition("cards");
  const card = cards.find((c) => c.id === node.attrs.cardId);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [shown, setShown] = useState(false);

  if (!card) {
    const create = () => {
      if (!front.trim()) return;
      const c = newCard(newCognitionId("card"), front, back, pageIdOf(editor), Date.now());
      putCognition("cards", c);
      updateAttributes({ cardId: c.id });
    };
    return (
      <NodeViewWrapper className="cg-block cg-card-block">
        <Head art="mem_new" label="Memory card" />
        <div className="cg-form">
          <textarea className="cg-input bidi" dir="auto" rows={2} autoFocus placeholder={tr("What to remember. Put {{braces}} around a part to hide it.")} value={front} onChange={(e) => setFront(e.target.value)} />
          <input className="cg-input bidi" dir="auto" placeholder={tr("Answer (not needed with braces)")} value={back} onChange={(e) => setBack(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
          <div className="cg-form-foot">
            <span className="cg-note">{tr("Worlds brings it back just before you would forget it.")}</span>
            <button className="cg-chip" onClick={create}>{tr("Remember")}</button>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }
  const st = cardState(card, dayOf(Date.now()));
  return (
    <NodeViewWrapper className="cg-block cg-card-block">
      <Head art={CARD_ART[st]} label="Memory card">
        <span className="cg-li-meta">{card.reps > 0 ? `${tr("next in")} ${Math.max(0, card.due - dayOf(Date.now()))}${tr("d")}` : tr("New")}</span>
      </Head>
      <button className="cg-flip bidi" dir="auto" onClick={() => setShown(!shown)}>
        <span className="cg-mini-q">{shown ? cardAnswer(card) || card.back : cardQuestion(card)}</span>
        <span className="cg-li-meta">{shown ? tr("Hide") : tr("Show the answer")}</span>
      </button>
    </NodeViewWrapper>
  );
}

/* Open question ---------------------------------------------------- */

export function QuestionBlockView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const questions = useCognition("questions");
  const q = questions.find((x) => x.id === node.attrs.qid);
  const [text, setText] = useState(q?.text ?? "");
  useEffect(() => setText(q?.text ?? ""), [q?.text]);

  if (!q) {
    const create = () => {
      if (!text.trim()) return;
      updateAttributes({ qid: addQuestion(text, pageIdOf(editor)).id });
    };
    return (
      <NodeViewWrapper className="cg-block cg-q-block">
        <Head art="ctx_question" label="Open question" />
        <div className="cg-block-row">
          <input className="cg-input bidi" dir="auto" autoFocus placeholder={tr("What do you not understand yet?")} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
          <button className="cg-chip" onClick={create}>{tr("Ask")}</button>
        </div>
      </NodeViewWrapper>
    );
  }
  const art = q.state === "resolved" ? "ctx_resolved" : q.state === "unsure" ? "ctx_maybe_misunderstood" : "ctx_question";
  return (
    <NodeViewWrapper className={`cg-block cg-q-block is-${q.state}`}>
      <Head art={art} label={q.state === "resolved" ? "Resolved question" : "Open question"}>
        {q.state !== "resolved" && (
          <button className="cg-chip" onClick={(e) => resolveQuestion(q, e.currentTarget)}>{tr("Resolve")}</button>
        )}
      </Head>
      <input
        className="cg-input bidi"
        dir="auto"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() && text !== q.text && putCognition("questions", { ...q, text: text.trim() })}
      />
      {q.answer && <div className="cg-answer bidi" dir="auto">{q.answer}</div>}
    </NodeViewWrapper>
  );
}

/* Claim, evidence, counter ---------------------------------------- */

export function ArgumentView({ node, updateAttributes }: ReactNodeViewProps) {
  const { claim, evidence, counter } = node.attrs as { claim: string; evidence: Row[]; counter: Row[] };
  return (
    <NodeViewWrapper className="cg-block">
      <Head art="ctx_interpretations" label="Claim and evidence" />
      <input className="cg-input bidi" dir="auto" placeholder={tr("The claim")} value={claim} onChange={(e) => updateAttributes({ claim: e.target.value })} />
      <div className="cg-cols" style={{ marginTop: 10 }}>
        <div className="cg-col is-pro">
          <div className="cg-col-title"><span>{tr("Evidence for")}</span><span>{evidence.filter((r) => r.text.trim()).length}</span></div>
          <Rows rows={evidence.length ? evidence : [{ id: "e0", text: "" }]} onChange={(r) => updateAttributes({ evidence: r })} placeholder="A fact, a source, an example" />
        </div>
        <div className="cg-col is-con">
          <div className="cg-col-title"><span>{tr("Against")}</span><span>{counter.filter((r) => r.text.trim()).length}</span></div>
          <Rows rows={counter.length ? counter : [{ id: "c0", text: "" }]} onChange={(r) => updateAttributes({ counter: r })} placeholder="What speaks against it" />
        </div>
      </div>
    </NodeViewWrapper>
  );
}

/* Pros and cons with weights -------------------------------------- */

export function ProsConsView({ node, updateAttributes }: ReactNodeViewProps) {
  const { topic, pros, cons } = node.attrs as { topic: string; pros: Row[]; cons: Row[] };
  const sum = (rows: Row[]) => rows.filter((r) => r.text.trim()).reduce((n, r) => n + (r.weight ?? 3), 0);
  const p = sum(pros);
  const c = sum(cons);
  return (
    <NodeViewWrapper className="cg-block">
      <Head art="credit_adjustment" label="Pros and cons" />
      <input className="cg-input bidi" dir="auto" placeholder={tr("What are you weighing?")} value={topic} onChange={(e) => updateAttributes({ topic: e.target.value })} />
      <div className="cg-cols" style={{ marginTop: 10 }}>
        <div className="cg-col is-pro">
          <div className="cg-col-title"><span>{tr("Pros")}</span><span>{p}</span></div>
          <Rows weights rows={pros.length ? pros : [{ id: "p0", text: "", weight: 3 }]} onChange={(r) => updateAttributes({ pros: r })} placeholder="A reason for" />
        </div>
        <div className="cg-col is-con">
          <div className="cg-col-title"><span>{tr("Cons")}</span><span>{c}</span></div>
          <Rows weights rows={cons.length ? cons : [{ id: "c0", text: "", weight: 3 }]} onChange={(r) => updateAttributes({ cons: r })} placeholder="A reason against" />
        </div>
      </div>
      {(p > 0 || c > 0) && (
        <div className="cg-verdict">
          {p === c ? tr("Evenly balanced") : p > c ? `${tr("The pros weigh more")} (${p} : ${c})` : `${tr("The cons weigh more")} (${c} : ${p})`}
        </div>
      )}
    </NodeViewWrapper>
  );
}

/* Decision record -------------------------------------------------- */

export function DecisionView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const { decision, options, why, revisit } = node.attrs as { decision: string; options: Row[]; why: string; revisit: string | null };
  const due = revisit && revisit <= new Date().toISOString().slice(0, 10);
  const setRevisit = (date: string | null) => {
    updateAttributes({ revisit: date });
    const id = `rv_${node.attrs.bid ?? decision.slice(0, 20)}`;
    if (date) putCognition("revisits", { id, pageId: pageIdOf(editor), title: decision || tr("A decision"), date });
    else removeCognition("revisits", id);
  };
  return (
    <NodeViewWrapper className={`cg-block ${due ? "is-due" : ""}`}>
      <Head art={due ? "state_delayed" : "resolve"} label="Decision">
        {due && <span className="cg-chip">{tr("Time to look again")}</span>}
      </Head>
      <input className="cg-input bidi" dir="auto" placeholder={tr("What did you decide?")} value={decision} onChange={(e) => updateAttributes({ decision: e.target.value, decided: node.attrs.decided ?? Date.now() })} />
      <div className="cg-col-title" style={{ marginTop: 10 }}><span>{tr("Options you had")}</span></div>
      <Rows rows={options.length ? options : [{ id: "o0", text: "" }]} onChange={(r) => updateAttributes({ options: r })} placeholder="An option" />
      <textarea className="cg-input bidi" dir="auto" rows={2} style={{ marginTop: 8 }} placeholder={tr("Why this one? Your future self will want to know.")} value={why} onChange={(e) => updateAttributes({ why: e.target.value })} />
      <div className="cg-block-row">
        <span className="cg-note">{tr("Look at it again on")}</span>
        <input className="cg-input" type="date" style={{ width: "auto" }} value={revisit ?? ""} onChange={(e) => setRevisit(e.target.value || null)} />
      </div>
    </NodeViewWrapper>
  );
}

/* Five whys -------------------------------------------------------- */

export function WhysView({ node, updateAttributes }: ReactNodeViewProps) {
  const { problem, whys } = node.attrs as { problem: string; whys: Row[] };
  const rows = whys.length ? whys : Array.from({ length: 5 }, (_, i) => ({ id: `w${i}`, text: "" }));
  const last = [...rows].reverse().find((r) => r.text.trim());
  return (
    <NodeViewWrapper className="cg-block">
      <Head art="reconsider" label="Five whys" />
      <input className="cg-input bidi" dir="auto" placeholder={tr("The problem")} value={problem} onChange={(e) => updateAttributes({ problem: e.target.value })} />
      <ol className="cg-whys">
        {rows.map((r, i) => (
          <li key={r.id}>
            <span className="cg-why-n">{tr("Why?")}</span>
            <input
              className="cg-input bidi"
              dir="auto"
              placeholder={i === 0 ? tr("Because...") : tr("And why is that?")}
              value={r.text}
              onChange={(e) => updateAttributes({ whys: rows.map((x) => (x.id === r.id ? { ...x, text: e.target.value } : x)) })}
            />
          </li>
        ))}
      </ol>
      {last && rows.filter((r) => r.text.trim()).length >= 3 && (
        <div className="cg-verdict">
          {tr("Root cause")}: <span className="bidi" dir="auto">{last.text}</span>
        </div>
      )}
    </NodeViewWrapper>
  );
}

/* Page fingerprint -------------------------------------------------- */

const ORIGIN_COLOR: Record<Origin, string> = { yours: "#FF9EC6", quoted: "#055BEE", claude: "#FFD63D", imported: "#A9AEBB" };
const ORIGIN_LABEL: Record<Origin, string> = { yours: "Your words", quoted: "Quoted", claude: "Written with Claude", imported: "Imported" };

export function FingerprintView({ editor }: ReactNodeViewProps) {
  const [doc, setDoc] = useState(() => editor.getJSON());
  useEffect(() => {
    const on = () => setDoc(editor.getJSON());
    editor.on("update", on);
    return () => {
      editor.off("update", on);
    };
  }, [editor]);
  const f = fingerprint(doc);
  const pct = percentages(f.counts);
  const addSource = async () => {
    const { promptText } = await import("../editor/prompt");
    const src = await promptText({ title: tr("Where is the quoted text from?"), placeholder: "https://", confirm: tr("Add") });
    if (!src) return;
    const { state } = editor;
    const tr2 = state.tr;
    state.doc.descendants((n, pos) => {
      const m = n.isText ? n.marks.find((x) => x.type.name === "origin" && x.attrs.kind === "quoted" && !x.attrs.source) : null;
      if (m) tr2.addMark(pos, pos + n.nodeSize, m.type.create({ ...m.attrs, source: src }));
    });
    editor.view.dispatch(tr2);
  };
  return (
    <NodeViewWrapper className="cg-block">
      <Head art="credit_contribution" label="Page fingerprint" />
      {f.total === 0 ? (
        <p className="cg-note">{tr("Write something and the fingerprint fills in.")}</p>
      ) : (
        <>
          <div className="cg-origin-bar">
            {(Object.keys(f.counts) as Origin[]).filter((k) => f.counts[k]).map((k) => (
              <i key={k} style={{ width: `${(f.counts[k] / f.total) * 100}%`, background: ORIGIN_COLOR[k] }} />
            ))}
          </div>
          <div className="cg-legend">
            {(Object.keys(f.counts) as Origin[]).filter((k) => f.counts[k]).map((k) => (
              <span key={k} style={{ ["--c" as string]: ORIGIN_COLOR[k] }}>
                {tr(ORIGIN_LABEL[k])} {pct[k]}%
              </span>
            ))}
          </div>
          {f.sources.length > 0 && (
            <ol className="cg-sources">
              {f.sources.map((s) => (
                <li key={s} className="bidi" dir="auto">{s}</li>
              ))}
            </ol>
          )}
          {f.counts.quoted > 0 && (
            <button className="cg-piece cg-piece-more" style={{ marginTop: 8 }} onClick={addSource}>
              <Icon name="link" size={13} /> {tr("Add the source of quoted text")}
            </button>
          )}
        </>
      )}
    </NodeViewWrapper>
  );
}

export { readCognition };
