import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Glass } from "../glass/Glass";
import { LAYER } from "../glass/profiles";
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
  const titleId = useId(), close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const topmost = () => { const roots = document.querySelectorAll(".modal-root"); return panel.current?.closest(".modal-root") === roots[roots.length - 1]; };
    const focusable = () => [...(panel.current?.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]') ?? [])].filter((el) => el.tabIndex >= 0 && !el.matches(':disabled, [aria-disabled="true"]') && el.getClientRects().length > 0);
    const raf = requestAnimationFrame(() => { setShown(true); if (topmost() && !panel.current?.contains(document.activeElement)) (focusable()[0] ?? panel.current)?.focus(); });
    const onKey = (e: KeyboardEvent) => {
      if (!topmost() || e.defaultPrevented) return;
      // Portaled menus and popovers handle their own Escape before the sheet.
      if (e.key === "Escape" && document.querySelector(".popover, .menu-panel")) return;
      if (e.key === "Escape") {
        e.preventDefault(); e.stopImmediatePropagation(); close.current();
      } else if (e.key === "Tab") {
        const controls = focusable(), current = document.activeElement, index = controls.indexOf(current as HTMLElement);
        if (!controls.length) { e.preventDefault(); panel.current?.focus(); }
        else if (e.shiftKey && index <= 0) { e.preventDefault(); controls.at(-1)?.focus(); }
        else if (!e.shiftKey && (index === -1 || index === controls.length - 1)) { e.preventDefault(); controls[0].focus(); }
      }
    };
    const keepFocus = (e: FocusEvent) => { if (e.target instanceof Element && e.target.closest(".popover, .menu-panel")) return; if (topmost() && e.target instanceof Node && !panel.current?.contains(e.target)) (focusable()[0] ?? panel.current)?.focus(); };
    document.addEventListener("keydown", onKey, true); document.addEventListener("focusin", keepFocus);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey, true); document.removeEventListener("focusin", keepFocus);
      if (prev?.isConnected) prev.focus();
    };
  }, []);
  return createPortal(
    <div className={`modal-root ${shown ? "is-in" : ""}`}>
      <div className="modal-scrim" onPointerDown={onClose} />
      <Glass
        ref={panel}
        material="sheet"
        layer={LAYER.modal}
        className={`modal-panel ${className}`}
        style={{ width }}
        radius="var(--r-float)"
        role="dialog"
        aria-modal
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Dialog"}
        tabIndex={-1}
      >
        {!bare && (title || true) && (
          <header className="modal-head">
            <div id={titleId} className="modal-title bidi">{title}</div>
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
