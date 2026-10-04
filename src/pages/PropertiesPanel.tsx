import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, errorMessage } from "../lib/api";
import type { PageMeta } from "../lib/types";
import { useStore } from "../state/store";
import { Icon, type IconName } from "../ui/Icon";
import { menuAt } from "../ui/Menu";
import { promptText } from "../editor/prompt";
import { newProperty, nextColor, optionColor, PROP_TYPES, propsOf, type Property, type PropType } from "./properties";

const toast = (e: unknown) => useStore.getState().toast({ message: errorMessage(e), tone: "error" });

/** Typed fields under the page title. Collections read and edit the same data. */
export function PropertiesPanel({ page, editable = true }: { page: PageMeta; editable?: boolean }) {
  const props = propsOf(page);

  const save = async (next: Property[]) => {
    try {
      useStore.getState().patchPageLocal(await api.setPageMeta(page.id, "properties", next));
    } catch (e) {
      toast(e);
    }
  };
  const update = (id: string, patch: Partial<Property>) => save(props.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const addMenu = (el: HTMLElement) =>
    menuAt(
      el,
      PROP_TYPES.map((t) => ({
        label: t.label,
        icon: t.icon as IconName,
        onSelect: () => {
          const taken = new Set(props.map((p) => p.name.toLowerCase()));
          let name = t.label;
          for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${t.label} ${n}`;
          save([...props, newProperty(t.id, name)]);
        },
      })),
    );

  const nameMenu = (el: HTMLElement, p: Property) =>
    menuAt(el, [
      {
        label: "Rename",
        icon: "edit",
        onSelect: async () => {
          const v = await promptText({ title: "Rename property", initial: p.name, confirm: "Rename" });
          if (v?.trim()) update(p.id, { name: v.trim() });
        },
      },
      { kind: "separator" },
      { label: "Delete property", icon: "delete", danger: true, onSelect: () => save(props.filter((x) => x.id !== p.id)) },
    ]);

  if (!props.length) return null;

  return (
    <div className="props">
      {props.map((p) => (
        <div key={p.id} className="prop-row">
          <button className="prop-name" onClick={(e) => editable && nameMenu(e.currentTarget, p)}>
            <Icon name={(PROP_TYPES.find((t) => t.id === p.type)?.icon ?? "text") as IconName} size={14} />
            <span className="bidi">{p.name}</span>
          </button>
          <div className="prop-value">
            <ValueEditor prop={p} editable={editable} onChange={(patch) => update(p.id, patch)} />
          </div>
        </div>
      ))}
      {editable && (
        <button className="prop-add" onClick={(e) => addMenu(e.currentTarget)}>
          <Icon name="add" size={13} />
          Add a property
        </button>
      )}
    </div>
  );
}

function ValueEditor({ prop, editable, onChange }: { prop: Property; editable: boolean; onChange: (patch: Partial<Property>) => void }) {
  const [draft, setDraft] = useState(prop.value === null || prop.value === undefined ? "" : String(prop.value));
  useEffect(() => setDraft(prop.value === null || prop.value === undefined ? "" : String(prop.value)), [prop.value]);
  const commit = (v: string | number | null) => {
    if (v !== prop.value) onChange({ value: v === "" ? null : v });
  };

  const chooseOption = (el: HTMLElement, multi: boolean) => {
    const opts = prop.options ?? [];
    const current = Array.isArray(prop.value) ? prop.value : prop.value ? [String(prop.value)] : [];
    menuAt(el, [
      ...opts.map((o) => ({
        label: o.name,
        checked: current.includes(o.name),
        onSelect: () =>
          multi
            ? onChange({ value: current.includes(o.name) ? current.filter((x) => x !== o.name) : [...current, o.name] })
            : onChange({ value: o.name }),
      })),
      ...(opts.length ? [{ kind: "separator" as const }] : []),
      {
        label: "New option",
        icon: "add" as const,
        onSelect: async () => {
          const v = (await promptText({ title: `New ${prop.name} option`, confirm: "Add" }))?.trim();
          if (!v) return;
          const options = opts.some((o) => o.name === v) ? opts : [...opts, { name: v, color: nextColor(opts.length) }];
          onChange({ options, value: multi ? Array.from(new Set([...current, v])) : v });
        },
      },
      ...(current.length ? [{ label: "Clear", icon: "close" as const, onSelect: () => onChange({ value: multi ? [] : null }) }] : []),
    ]);
  };

  switch (prop.type as PropType) {
    case "status":
    case "select":
      return (
        <button className="prop-pick" disabled={!editable} onClick={(e) => chooseOption(e.currentTarget, false)}>
          {prop.value ? (
            <span className="prop-chip" style={{ ["--chip" as string]: optionColor(prop, String(prop.value)) }}>
              {prop.type === "status" && <span className="prop-dot" />}
              {String(prop.value)}
            </span>
          ) : (
            <span className="prop-empty">Empty</span>
          )}
        </button>
      );
    case "tags": {
      const tags = Array.isArray(prop.value) ? prop.value : [];
      return (
        <button className="prop-pick" disabled={!editable} onClick={(e) => chooseOption(e.currentTarget, true)}>
          {tags.length ? (
            <span className="chip-row">
              {tags.map((t) => (
                <span key={t} className="prop-chip" style={{ ["--chip" as string]: optionColor(prop, t) }}>
                  {t}
                </span>
              ))}
            </span>
          ) : (
            <span className="prop-empty">Empty</span>
          )}
        </button>
      );
    }
    case "checkbox":
      return (
        <button className={`prop-check ${prop.value ? "is-on" : ""}`} disabled={!editable} onClick={() => onChange({ value: !prop.value })} aria-pressed={!!prop.value}>
          {prop.value ? <Icon name="check" size={12} /> : null}
        </button>
      );
    case "date":
      return <input className="prop-input" type="date" value={draft} disabled={!editable} onChange={(e) => commit(e.target.value)} />;
    case "number":
      return (
        <input
          className="prop-input"
          type="number"
          value={draft}
          disabled={!editable}
          placeholder="Empty"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft === "" ? null : Number(draft))}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      );
    case "url":
      return (
        <span className="prop-url">
          <input
            className="prop-input"
            dir="ltr"
            value={draft}
            disabled={!editable}
            placeholder="https://"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(draft.trim() && !/^https?:\/\//.test(draft.trim()) ? `https://${draft.trim()}` : draft.trim())}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          {prop.value ? (
            <button className="prop-open" onClick={() => openUrl(String(prop.value))} aria-label="Open link">
              <Icon name="external" size={13} />
            </button>
          ) : null}
        </span>
      );
    default:
      return (
        <input
          className="prop-input bidi"
          dir="auto"
          value={draft}
          disabled={!editable}
          placeholder="Empty"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      );
  }
}
