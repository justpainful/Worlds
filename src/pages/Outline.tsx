import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";

interface Heading {
  pos: number;
  level: number;
  text: string;
}

function read(editor: Editor) {
  const heads: Heading[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading" && node.textContent.trim()) heads.push({ pos, level: node.attrs.level as number, text: node.textContent.trim() });
    return node.type.name !== "heading";
  });
  const text = editor.state.doc.textContent;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return { heads, words };
}

/**
 * A quiet table of contents beside the page: headings with scroll tracking,
 * plus reading stats. Appears only when the page has two or more headings.
 */
export function Outline({ editor }: { editor: Editor | null }) {
  const [state, setState] = useState<{ heads: Heading[]; words: number }>({ heads: [], words: 0 });
  const [active, setActive] = useState(-1);
  const [top, setTop] = useState(150);

  // Never sit on the cover: start below it, and ride up to the toolbar as it scrolls away.
  useEffect(() => {
    if (!editor) return;
    const view = (editor.view.dom as HTMLElement).closest(".page-view");
    const scroller = view?.closest(".pane-scroll");
    if (!view || !scroller) return;
    const place = () => {
      const cover = view.querySelector(".page-cover-wrap");
      const below = cover ? cover.getBoundingClientRect().bottom + 24 : 0;
      setTop(Math.max(150, below));
    };
    place();
    scroller.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    const ro = new ResizeObserver(place);
    ro.observe(view);
    return () => {
      scroller.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
      ro.disconnect();
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    let t = 0;
    const update = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => setState(read(editor)), 250);
    };
    setState(read(editor));
    editor.on("update", update);
    return () => {
      editor.off("update", update);
      window.clearTimeout(t);
    };
  }, [editor]);

  // Scroll spy: the last heading whose top has passed below the toolbar.
  useEffect(() => {
    if (!editor || state.heads.length < 2) return;
    const scroller = (editor.view.dom as HTMLElement).closest(".pane-scroll");
    if (!scroller) return;
    let raf = 0;
    const spy = () => {
      raf = 0;
      const top = scroller.getBoundingClientRect().top + 110;
      let idx = -1;
      state.heads.forEach((h, i) => {
        const el = editor.view.nodeDOM(h.pos) as HTMLElement | null;
        if (el && el.getBoundingClientRect().top <= top) idx = i;
      });
      setActive(idx);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(spy);
    };
    spy();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [editor, state.heads]);

  if (!editor || state.heads.length < 2) return null;
  const minutes = Math.max(1, Math.round(state.words / 200));
  return (
    <nav className="outline" aria-label="On this page" style={{ top, maxHeight: `calc(100vh - ${top + 70}px)` }}>
      <div className="outline-title">On this page</div>
      {state.heads.map((h, i) => (
        <button
          key={`${h.pos}-${i}`}
          className={`outline-item lvl-${h.level} ${i === active ? "is-active" : ""}`}
          dir="auto"
          onClick={() => {
            const el = editor.view.nodeDOM(h.pos) as HTMLElement | null;
            el?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
          {h.text}
        </button>
      ))}
      <div className="outline-stats">
        {state.words.toLocaleString()} words · {minutes} min read
      </div>
    </nav>
  );
}
