/**
 * A map of your places: pins on an OpenStreetMap map, each with a name and
 * optionally a page. Drag to move, scroll to zoom, Add pin then click the
 * map. Tiles come from openstreetmap.org (credited in the corner).
 */
import { useRef, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { useStore, pageTitle } from "../../state/store";
import { tr } from "../../i18n/ui";
import { Icon } from "../../ui/Icon";
import { menuAt } from "../../ui/Menu";
import { promptText } from "../prompt";
import { choosePage } from "../choosePage";

interface Pin {
  id: string;
  lat: number;
  lon: number;
  name: string;
  pageId?: string | null;
}

const TILE = 256;
const lon2x = (lon: number, z: number) => ((lon + 180) / 360) * TILE * 2 ** z;
const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z;
};
const x2lon = (x: number, z: number) => (x / (TILE * 2 ** z)) * 360 - 180;
const y2lat = (y: number, z: number) => {
  const n = Math.PI - (2 * Math.PI * y) / (TILE * 2 ** z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

function PlacesMapView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const a = node.attrs as { lat: number; lon: number; zoom: number; pins: Pin[]; height: number };
  const pins = Array.isArray(a.pins) ? a.pins : [];
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState({ lat: a.lat, lon: a.lon, zoom: a.zoom });
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const pages = useStore((s) => s.pages);
  const editable = editor.isEditable;
  const w = box.current?.clientWidth ?? 640;
  const h = a.height;
  const cx = lon2x(view.lon, view.zoom);
  const cy = lat2y(view.lat, view.zoom);
  const left = cx - w / 2;
  const top = cy - h / 2;
  const n = 2 ** view.zoom;
  const tiles: { x: number; y: number; key: string }[] = [];
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + w) / TILE); tx++)
    for (let ty = Math.max(0, Math.floor(top / TILE)); ty <= Math.min(n - 1, Math.floor((top + h) / TILE)); ty++) tiles.push({ x: tx, y: ty, key: `${view.zoom}/${tx}/${ty}` });

  const save = (patch: Partial<typeof a>) => updateAttributes(patch);

  const onUp = async (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) return save({ lat: view.lat, lon: view.lon, zoom: view.zoom });
    if (!adding || !editable) return;
    const r = box.current!.getBoundingClientRect();
    const lon = x2lon(left + e.clientX - r.left, view.zoom);
    const lat = y2lat(top + e.clientY - r.top, view.zoom);
    setAdding(false);
    const name = await promptText({ title: tr("Name this place"), placeholder: tr("Cafe, office, trip"), confirm: tr("Add pin") });
    if (!name) return;
    save({ pins: [...pins, { id: Math.random().toString(36).slice(2, 9), lat, lon, name }], lat: view.lat, lon: view.lon, zoom: view.zoom });
  };

  const pinMenu = (el: HTMLElement, p: Pin) =>
    menuAt(el, [
      { kind: "label", label: p.name },
      ...(p.pageId && pages[p.pageId] ? [{ label: `${tr("Open")} ${pageTitle(pages[p.pageId])}`, icon: "page" as const, onSelect: () => useStore.getState().openPage(p.pageId!) }] : []),
      ...(editable
        ? [
            {
              label: p.pageId ? tr("Link Another Page") : tr("Link a Page"),
              icon: "link" as const,
              onSelect: async () => {
                const id = await choosePage(el);
                if (id) save({ pins: pins.map((x) => (x.id === p.id ? { ...x, pageId: id } : x)) });
              },
            },
            {
              label: tr("Rename"),
              icon: "edit" as const,
              onSelect: async () => {
                const name = await promptText({ title: tr("Rename place"), initial: p.name, confirm: tr("Rename") });
                if (name) save({ pins: pins.map((x) => (x.id === p.id ? { ...x, name } : x)) });
              },
            },
            { kind: "separator" as const },
            { label: tr("Remove Pin"), icon: "delete" as const, danger: true, onSelect: () => save({ pins: pins.filter((x) => x.id !== p.id) }) },
          ]
        : []),
    ]);

  return (
    <NodeViewWrapper className="places-map" contentEditable={false}>
      <div
        ref={box}
        className={`pm-frame ${adding ? "is-adding" : ""}`}
        style={{ height: h }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest(".pm-pin, .pm-tools")) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, cx, cy, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
          if (d.moved) setView({ ...view, lon: x2lon(d.cx - dx, view.zoom), lat: Math.max(-85, Math.min(85, y2lat(d.cy - dy, view.zoom))) });
        }}
        onPointerUp={onUp}
        onWheel={(e) => {
          if (!e.ctrlKey && !e.metaKey && !adding) return;
          e.preventDefault();
          const zoom = Math.max(2, Math.min(18, view.zoom + (e.deltaY < 0 ? 1 : -1)));
          setView({ ...view, zoom });
          save({ zoom });
        }}
      >
        {tiles.map((t) => {
          const wx = ((t.x % n) + n) % n;
          return <img key={t.key} className="pm-tile" alt="" draggable={false} src={`https://tile.openstreetmap.org/${view.zoom}/${wx}/${t.y}.png`} style={{ left: t.x * TILE - left, top: t.y * TILE - top }} />;
        })}
        {pins.map((p) => (
          <button
            key={p.id}
            className={`pm-pin ${p.pageId ? "has-page" : ""}`}
            style={{ left: lon2x(p.lon, view.zoom) - left, top: lat2y(p.lat, view.zoom) - top }}
            onClick={(e) => pinMenu(e.currentTarget, p)}
            aria-label={p.name}
          >
            <Icon name="mapPin" size={22} />
            <span className="pm-label bidi">{p.name}</span>
          </button>
        ))}
        <div className="pm-tools">
          <button aria-label={tr("Zoom in")} onClick={() => (setView({ ...view, zoom: Math.min(18, view.zoom + 1) }), save({ zoom: Math.min(18, view.zoom + 1) }))}>
            <Icon name="add" size={14} />
          </button>
          <button aria-label={tr("Zoom out")} onClick={() => (setView({ ...view, zoom: Math.max(2, view.zoom - 1) }), save({ zoom: Math.max(2, view.zoom - 1) }))}>
            <Icon name="minimize" size={14} />
          </button>
          {editable && (
            <button className={adding ? "is-on" : ""} onClick={() => setAdding(!adding)}>
              <Icon name="mapPin" size={14} />
              <span>{adding ? tr("Click the map") : tr("Add pin")}</span>
            </button>
          )}
        </div>
        <a className="pm-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          © OpenStreetMap
        </a>
      </div>
      {pins.length > 0 && (
        <div className="pm-list">
          {pins.map((p) => (
            <button key={p.id} onClick={() => setView({ lat: p.lat, lon: p.lon, zoom: Math.max(view.zoom, 13) })}>
              <Icon name="mapPin" size={13} />
              <span className="bidi">{p.name}</span>
              {p.pageId && pages[p.pageId] && <span className="pm-page bidi">{pageTitle(pages[p.pageId])}</span>}
            </button>
          ))}
        </div>
      )}
    </NodeViewWrapper>
  );
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    placesMap: { insertPlacesMap: () => ReturnType };
  }
}

export const PlacesMap = Node.create({
  name: "placesMap",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    const json = (name: string, fallback: unknown) => ({
      default: fallback,
      parseHTML: (el: HTMLElement) => {
        try {
          return JSON.parse(el.getAttribute(`data-${name}`) ?? "");
        } catch {
          return fallback;
        }
      },
      renderHTML: (attrs: Record<string, unknown>) => ({ [`data-${name}`]: JSON.stringify(attrs[name] ?? fallback) }),
    });
    return { lat: { default: 24.7136 }, lon: { default: 46.6753 }, zoom: { default: 5 }, height: { default: 360 }, pins: json("pins", []) };
  },
  parseHTML() {
    return [{ tag: "div[data-places-map]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-places-map": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PlacesMapView, { stopEvent: ({ event }) => !event.type.startsWith("drag") });
  },
  addCommands() {
    return {
      insertPlacesMap:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: "placesMap" }),
    };
  },
});
