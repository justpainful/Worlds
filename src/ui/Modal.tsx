import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Glass } from "../glass/Glass";
import { LAYER } from "../glass/materials";
import { IconButton } from "./Button";

/** Glass sheet over a dimming scrim. Escape / scrim click closes. */
export function Modal({
  title,
  onClose,
  children,
  width = 560,
  footer,
  className = "",
  bare = false,
}: {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  footer?: ReactNode;
  className?: string;
  bare?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <div className={`modal-root ${shown ? "is-in" : ""}`}>
      <div className="modal-scrim" onPointerDown={onClose} />
      <Glass
        ref={panel}
        material="dense"
        layer={LAYER.modal}
        className={`modal-panel ${className}`}
        style={{ width }}
        radius="var(--r-float)"
        role="dialog"
        aria-modal
      >
        {!bare && (title || true) && (
          <header className="modal-head">
            <div className="modal-title bidi">{title}</div>
            <IconButton icon="close" label="Close" onClick={onClose} />
          </header>
        )}
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </Glass>
    </div>,
    document.body,
  );
}

/** Small confirmation for genuinely destructive actions only. */
export function confirmDialog(opts: { title: string; message: string; confirm: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    import("react-dom/client").then(({ createRoot }) => {
      const root = createRoot(host);
      const done = (v: boolean) => {
        root.unmount();
        host.remove();
        resolve(v);
      };
      root.render(
        <Modal title={opts.title} onClose={() => done(false)} width={420}
          footer={
            <>
              <button className="btn btn-quiet btn-standard" onClick={() => done(false)}>Cancel</button>
              <button className={`btn ${opts.danger ? "btn-danger" : "btn-tinted"} btn-standard`} autoFocus onClick={() => done(true)}>
                {opts.confirm}
              </button>
            </>
          }>
          <p className="modal-text bidi">{opts.message}</p>
        </Modal>,
      );
    });
  });
}
