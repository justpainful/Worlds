import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Modal } from "../ui/Modal";

/** Small glass input dialog. Resolves to the value, or null when cancelled. */
export function promptText(opts: { title: string; placeholder?: string; initial?: string; validate?: (v: string) => string | null; confirm?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: string | null) => {
      root.unmount();
      host.remove();
      resolve(v);
    };
    function Dialog() {
      const [value, setValue] = useState(opts.initial ?? "");
      const [err, setErr] = useState<string | null>(null);
      const submit = () => {
        const v = value.trim();
        const e = opts.validate?.(v) ?? (v ? null : "Required");
        if (e) return setErr(e);
        done(v);
      };
      return (
        <Modal title={opts.title} onClose={() => done(null)} width={460}
          footer={
            <>
              <button className="btn btn-quiet btn-standard" onClick={() => done(null)}>Cancel</button>
              <button className="btn btn-tinted btn-standard" onClick={submit}>{opts.confirm ?? "Insert"}</button>
            </>
          }>
          <input
            className="field bidi"
            dir="auto"
            autoFocus
            placeholder={opts.placeholder}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setErr(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          {err && <div className="field-error">{err}</div>}
        </Modal>
      );
    }
    root.render(<Dialog />);
  });
}
