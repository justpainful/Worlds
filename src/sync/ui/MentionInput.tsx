import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { Person } from "../comments";

export interface MentionInputHandle {
  focus: () => void;
  clear: () => void;
}

/**
 * A plain text field for comments with "@" suggestions from the people who
 * have been on the page. Enter sends, Shift+Enter starts a new line.
 */
export const MentionInput = forwardRef<
  MentionInputHandle,
  { people: Person[]; placeholder: string; onSubmit: (body: string, mentions: string[]) => void; autoFocus?: boolean; disabled?: boolean }
>(function MentionInput({ people, placeholder, onSubmit, autoFocus, disabled }, ref) {
  const [value, setValue] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const [mentions, setMentions] = useState<Map<string, string>>(new Map());
  const area = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => area.current?.focus(),
    clear: () => {
      setValue("");
      setMentions(new Map());
    },
  }));

  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return people.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6);
  }, [people, query]);

  const readQuery = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(before);
    setQuery(m ? m[2] : null);
    setPick(0);
  };

  const choose = (p: Person) => {
    const el = area.current;
    if (!el) return;
    const caret = el.selectionStart;
    const before = value.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${p.name} `);
    const next = before + value.slice(caret);
    setValue(next);
    setMentions(new Map(mentions).set(p.id, p.name));
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  };

  const submit = () => {
    const body = value.trim();
    if (!body) return;
    const ids = [...mentions].filter(([, name]) => body.includes(`@${name}`)).map(([id]) => id);
    onSubmit(body, ids);
    setValue("");
    setMentions(new Map());
  };

  return (
    <div className="mention-input">
      <textarea
        ref={area}
        className="mention-field bidi"
        dir="auto"
        rows={2}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        onChange={(e) => {
          setValue(e.target.value);
          readQuery(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={(e) => {
          if (matches.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setPick((i) => (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              choose(matches[pick]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setQuery(null);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {matches.length > 0 && (
        <div className="mention-list" role="listbox">
          {matches.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={i === pick}
              className={`mention-option ${i === pick ? "is-active" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(p)}
            >
              <span className="mention-dot" style={{ background: p.color }} />
              <span className="bidi">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
