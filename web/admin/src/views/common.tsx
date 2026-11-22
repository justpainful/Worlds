import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { signOut } from "../api";
import { errorText, setLang, t, useLang } from "../i18n";
import { Button, MenuButton, Spinner } from "../ui";

/** The glass toolbar at the top of each view: title and subtitle at the leading edge, actions at the trailing edge. */
export function Toolbar({ title, subtitle, children, back }: { title: string; subtitle?: ReactNode; children?: ReactNode; back?: ReactNode }) {
  const lang = useLang();
  const ref = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const scroller = ref.current?.parentElement;
    if (!scroller) return;
    const on = () => setScrolled(scroller.scrollTop > 2);
    scroller.addEventListener("scroll", on, { passive: true });
    return () => scroller.removeEventListener("scroll", on);
  }, []);
  return (
    <header ref={ref} className={`toolbar ${scrolled ? "is-scrolled" : ""}`}>
      {back}
      <div className="toolbar-title">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="toolbar-actions">
        {children}
        <span className="only-phone">
          <MenuButton
            icon="ellipsis.circle"
            label={t("more")}
            items={[
              { key: "lang", label: t("language"), icon: "character.bubble", onSelect: () => setLang(lang === "ar" ? "en" : "ar") },
              { key: "light", label: t("themeLight"), icon: "sun.max", onSelect: () => setThemeQuick("light") },
              { key: "dark", label: t("themeDark"), icon: "moon", onSelect: () => setThemeQuick("dark") },
              { key: "out", label: t("signOut"), icon: "rectangle.portrait.and.arrow.right", onSelect: () => void signOut() },
            ]}
          />
        </span>
      </div>
    </header>
  );
}

function setThemeQuick(th: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", th);
  try {
    localStorage.setItem("worlds.admin.theme", th);
  } catch {
    // This visit only.
  }
}

/** Load something, with loading and error states and a reload. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(fn, deps);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    setLoading(true);
    try {
      const v = await load();
      if (n === seq.current) {
        setData(v);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError(e);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [load]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

export function Loading() {
  return (
    <div className="state">
      <Spinner />
    </div>
  );
}

export function Failed({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="state">
      <p className="form-error" role="alert">
        {errorText(error)}
      </p>
      <Button icon="arrow.clockwise" onClick={retry}>
        {t("retry")}
      </Button>
    </div>
  );
}
