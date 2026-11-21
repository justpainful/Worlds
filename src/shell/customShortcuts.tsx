/**
 * Keyboard shortcuts of your own: any command in the command palette can
 * get a key combination. They are kept in settings (`shortcuts.custom`, a
 * map from combination to command id) and checked before the built-in keys.
 */
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../state/store";
import { shortcutKey } from "../lib/keys";
import { tr } from "../i18n/ui";
import { Icon } from "../ui/Icon";
import { MenuSelect } from "../ui/MenuSelect";
import { commands } from "./CommandPalette";

const KEY = "shortcuts.custom";

/** "Ctrl+Shift+K" for a key event, or null for a lone modifier. */
export function comboOf(e: KeyboardEvent | React.KeyboardEvent): string | null {
  const k = shortcutKey(e);
  if (["control", "shift", "alt", "meta", "Control", "Shift", "Alt", "Meta"].includes(k)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  const name = k.length === 1 ? k.toUpperCase() : k === " " ? "Space" : k.charAt(0).toUpperCase() + k.slice(1);
  // A plain letter would get in the way of typing; require a modifier, or a function key.
  if (!parts.length && !/^F\d{1,2}$/.test(name)) return null;
  return [...parts, name].join("+");
}

export function customShortcuts(): Record<string, string> {
  const v = useStore.getState().settings[KEY];
  return v && typeof v === "object" ? (v as Record<string, string>) : {};
}

let installed = false;

/** Listen for custom shortcuts across the app. */
export function installCustomShortcuts() {
  if (installed) return;
  installed = true;
  window.addEventListener(
    "keydown",
    (e) => {
      const map = customShortcuts();
      if (!Object.keys(map).length) return;
      const combo = comboOf(e);
      const id = combo ? map[combo] : undefined;
      if (!id) return;
      const cmd = commands().find((c) => c.id === id);
      if (!cmd) return;
      e.preventDefault();
      e.stopPropagation();
      cmd.run("current");
    },
    true,
  );
}

/** Settings: the list of custom shortcuts, with a recorder for new ones. */
export function ShortcutSettings() {
  const map = (useStore((s) => s.settings[KEY]) as Record<string, string> | undefined) ?? {};
  const set = useStore((s) => s.setSetting);
  const all = useMemo(() => commands().sort((a, b) => tr(a.title).localeCompare(tr(b.title))), []);
  const [cmd, setCmd] = useState(all[0]?.id ?? "");
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setRecording(false);
      const combo = comboOf(e);
      if (!combo) return;
      setRecording(false);
      if (map[combo] && map[combo] !== cmd) {
        const other = all.find((c) => c.id === map[combo]);
        setError(`${combo} ${tr("was used for")} ${tr(other?.title ?? map[combo])}; ${tr("it now runs the new command.")}`);
      } else setError(null);
      const next = Object.fromEntries(Object.entries(map).filter(([, id]) => id !== cmd));
      next[combo] = cmd;
      set(KEY, next);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, cmd, map, set, all]);

  const entries = Object.entries(map);
  return (
    <div className="shortcut-settings">
      {entries.length > 0 && (
        <ul className="sc-list">
          {entries.map(([combo, id]) => {
            const c = all.find((x) => x.id === id);
            return (
              <li key={combo}>
                <Icon name={c?.icon ?? "command"} size={15} />
                <span className="bidi">{tr(c?.title ?? id)}</span>
                <kbd>{combo}</kbd>
                <button
                  className="icon-btn"
                  aria-label={tr("Remove shortcut")}
                  onClick={() => set(KEY, Object.fromEntries(entries.filter(([k]) => k !== combo)))}
                >
                  <Icon name="close" size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="sc-add">
        <MenuSelect value={cmd} onChange={(e) => setCmd(e.target.value)} aria-label={tr("Command")}>
          {all.map((c) => (
            <option key={c.id} value={c.id}>
              {tr(c.title)}
            </option>
          ))}
        </MenuSelect>
        <button className={`btn btn-${recording ? "tinted" : "plain"} btn-compact`} onClick={() => setRecording(!recording)}>
          <Icon name="keyboard" size={14} />
          {recording ? tr("Press the keys") : tr("Record shortcut")}
        </button>
      </div>
      {error && <p className="sc-note">{error}</p>}
    </div>
  );
}
