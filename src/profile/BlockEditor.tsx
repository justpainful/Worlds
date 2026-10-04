import { useState, type ReactNode } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, errorMessage, fileUrl } from "../lib/api";
import { useStore } from "../state/store";
import { Button, IconButton } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Popover } from "../ui/Menu";
import { Modal } from "../ui/Modal";
import { PRODUCT_ICON_NAMES, ProductIcon, RefIcon } from "../ui/ProductIcon";
import { Segmented } from "../ui/Segmented";
import { Select } from "../ui/Select";
import {
  DYNAMIC_SOURCES,
  dynamicSource,
  FRAME_SHAPES,
  SIZES,
  STYLES,
  TYPES,
  canAdd,
  newBlock,
  parseFocus,
  type BlockType,
  type ImageFit,
  type ImageSide,
  type Item,
  type ProfileBlock,
} from "./blocks";

const toast = (e: unknown) => useStore.getState().toast({ message: errorMessage(e), tone: "error" });

async function pickMedia(video = false): Promise<{ id: string; isVideo: boolean } | null> {
  const path = await openDialog({
    multiple: false,
    title: "Choose an image",
    filters: [{ name: "Media", extensions: video ? ["gif", "png", "jpg", "jpeg", "webp", "avif", "mp4", "webm", "mov"] : ["gif", "png", "jpg", "jpeg", "webp", "avif", "svg"] }],
  });
  if (!path || Array.isArray(path)) return null;
  try {
    const a = await api.importFile(null, path);
    return { id: a.id, isVideo: a.kind === "video" || /\.(mp4|webm|mov)$/i.test(path) };
  } catch (e) {
    toast(e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Picker: an Apple-style sheet of block types
// ---------------------------------------------------------------------------

export function BlockPicker({ blocks, onPick, onClose }: { blocks: ProfileBlock[]; onPick: (b: ProfileBlock) => void; onClose: () => void }) {
  return (
    <Modal title="Add a block" onClose={onClose} width={640} className="pb-picker">
      <div className="pb-picker-grid">
        {TYPES.map((t) => {
          const ok = canAdd(blocks, t.id);
          return (
            <button key={t.id} className="pb-picker-item" disabled={!ok} onClick={() => onPick(newBlock(t.id))}>
              <RefIcon value={t.icon} size={44} />
              <span className="pb-picker-label">{t.label}</span>
              <span className="pb-picker-note">{ok ? t.note : "Limit reached"}</span>
            </button>
          );
        })}
      </div>
      <p className="pb-picker-foot">Up to 12 blocks. The first three are featured at the top.</p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="pbi-row">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function Text({ value, onChange, placeholder, area, max = 140 }: { value?: string; onChange: (v: string) => void; placeholder?: string; area?: boolean; max?: number }) {
  return area ? (
    <textarea className="field bidi" dir="auto" rows={2} maxLength={max} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input className="field bidi" dir="auto" maxLength={max} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  );
}

function IconField({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [emoji, setEmoji] = useState("");
  return (
    <>
      <button className="pbi-icon" onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())} aria-label="Choose icon" type="button">
        {value ? <RefIcon value={value} size={28} /> : <Icon name="add" size={14} />}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={300} className="pbi-icon-pop">
          <div className="pbi-icon-grid">
            {PRODUCT_ICON_NAMES.map((n) => (
              <button
                key={n}
                className={`pbi-icon-opt ${value === `pi:${n}` ? "is-on" : ""}`}
                data-tip={n}
                onClick={() => {
                  onChange(`pi:${n}`);
                  setAnchor(null);
                }}
              >
                <ProductIcon name={n} size={32} />
              </button>
            ))}
          </div>
          <div className="pbi-icon-foot">
            <input
              className="field"
              placeholder="Emoji"
              maxLength={4}
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && emoji.trim()) {
                  onChange(emoji.trim());
                  setAnchor(null);
                }
              }}
            />
            <Button
              size="compact"
              icon="upload"
              onClick={async () => {
                const m = await pickMedia();
                if (m) onChange(`img:${m.id}`);
                setAnchor(null);
              }}
            >
              Image
            </Button>
            {value && (
              <IconButton
                icon="close"
                label="No icon"
                onClick={() => {
                  onChange(undefined);
                  setAnchor(null);
                }}
              />
            )}
          </div>
        </Popover>
      )}
    </>
  );
}

const FOCUS_PRESETS: { label: string; v: string }[] = [
  { label: "Center", v: "50,50" },
  { label: "Top", v: "50,0" },
  { label: "Bottom", v: "50,100" },
  { label: "Left", v: "0,50" },
  { label: "Right", v: "100,50" },
];

function ImageField({
  id,
  fit,
  focus,
  side,
  video,
  onChange,
}: {
  id?: string;
  fit?: ImageFit;
  focus?: string;
  side?: ImageSide;
  video?: boolean;
  onChange: (p: { id?: string; fit?: ImageFit; focus?: string; side?: ImageSide; isVideo?: boolean }) => void;
}) {
  const f = parseFocus(focus);
  return (
    <div className="pbi-image">
      <div className="pbi-image-row">
        <Button
          size="compact"
          icon="image"
          onClick={async () => {
            const m = await pickMedia(video);
            if (m) onChange({ id: m.id, isVideo: m.isVideo });
          }}
        >
          {id ? "Replace" : "Choose"}
        </Button>
        {id && <IconButton icon="close" label="Remove image" onClick={() => onChange({ id: undefined })} />}
      </div>
      {id && (
        <>
          {side !== undefined && (
            <Segmented
              value={side}
              options={[
                { value: "left", label: "Left" },
                { value: "right", label: "Right" },
                { value: "background", label: "Full" },
              ]}
              onChange={(v) => onChange({ side: v as ImageSide })}
            />
          )}
          <Segmented
            value={fit ?? "cover"}
            options={[
              { value: "contain", label: "Contain" },
              { value: "cover", label: "Cover" },
              { value: "original", label: "Original" },
            ]}
            onChange={(v) => onChange({ fit: v as ImageFit })}
          />
          {(fit ?? "cover") !== "contain" && (
            <>
              <div
                className="pbi-focus"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  const x = Math.round(((e.clientX - r.left) / r.width) * 100);
                  const y = Math.round(((e.clientY - r.top) / r.height) * 100);
                  onChange({ focus: `${x},${y}` });
                }}
                title="Click to set the focus point"
              >
                {video ? <video src={fileUrl(id)} muted /> : <img src={fileUrl(id)} alt="" />}
                <span className="pbi-focus-dot" style={{ left: `${f.x}%`, top: `${f.y}%` }} />
              </div>
              <div className="pbi-chips">
                {FOCUS_PRESETS.map((p) => (
                  <button key={p.v} className={`chip-btn ${focus === p.v ? "is-on" : ""}`} onClick={() => onChange({ focus: p.v })}>
                    {p.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function ItemsField({ items, onChange, min = 1, max = 6, withUrl }: { items: Item[]; onChange: (v: Item[]) => void; min?: number; max?: number; withUrl?: boolean }) {
  const set = (i: number, p: Partial<Item>) => onChange(items.map((it, j) => (j === i ? { ...it, ...p } : it)));
  return (
    <div className="pbi-items">
      {items.map((it, i) => (
        <div key={i} className="pbi-item">
          <IconField value={it.icon} onChange={(v) => set(i, { icon: v })} />
          <div className="pbi-item-fields">
            <input className="field bidi" dir="auto" placeholder="Title" maxLength={60} value={it.title} onChange={(e) => set(i, { title: e.target.value })} />
            <input className="field bidi" dir="auto" placeholder="Subtitle" maxLength={80} value={it.subtitle ?? ""} onChange={(e) => set(i, { subtitle: e.target.value || undefined })} />
            {withUrl && <input className="field" dir="ltr" placeholder="https://" value={it.url ?? ""} onChange={(e) => set(i, { url: e.target.value || undefined })} />}
          </div>
          <div className="pbi-item-actions">
            <IconButton icon="back" label="Move up" disabled={i === 0} onClick={() => onChange(move(items, i, i - 1))} className="rot90" />
            <IconButton icon="close" label="Remove" disabled={items.length <= min} onClick={() => onChange(items.filter((_, j) => j !== i))} />
          </div>
        </div>
      ))}
      {items.length < max && (
        <button className="chip-btn" onClick={() => onChange([...items, { title: "New item" }])}>
          <Icon name="add" size={13} />
          Add item
        </button>
      )}
    </div>
  );
}

export function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = list.slice();
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

export function BlockInspector({
  block,
  onChange,
  onRemove,
  onClose,
}: {
  block: ProfileBlock;
  onChange: (b: ProfileBlock) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const set = (p: Partial<ProfileBlock>) => onChange({ ...block, ...p } as ProfileBlock);
  const type = TYPES.find((t) => t.id === block.type)!;

  const specific = (): ReactNode => {
    switch (block.type) {
      case "info":
        return (
          <>
            <Row label="Label">
              <div className="pbi-inline">
                <IconField value={block.labelIcon} onChange={(v) => set({ labelIcon: v })} />
                <Text value={block.label} onChange={(v) => set({ label: v })} placeholder="Interactions" />
              </div>
            </Row>
            <Row label="Title"><Text value={block.title} onChange={(v) => set({ title: v })} /></Row>
            <Row label="Subtitle"><Text value={block.subtitle} onChange={(v) => set({ subtitle: v })} /></Row>
            <Row label="Badge"><Text value={block.badge} onChange={(v) => set({ badge: v || undefined })} max={20} placeholder="Optional" /></Row>
            <Row label="Art">
              <ImageField id={block.image} fit={block.imageFit} focus={block.focus} side={block.imageSide ?? "right"} onChange={(p) => set({ image: "id" in p ? p.id : block.image, imageFit: p.fit ?? block.imageFit, focus: p.focus ?? block.focus, imageSide: p.side ?? block.imageSide })} />
            </Row>
          </>
        );
      case "quote":
        return (
          <>
            <Row label="Label">
              <div className="pbi-inline">
                <IconField value={block.labelIcon} onChange={(v) => set({ labelIcon: v })} />
                <Text value={block.label} onChange={(v) => set({ label: v })} />
              </div>
            </Row>
            <Row label="Statement"><Text area value={block.statement} onChange={(v) => set({ statement: v })} /></Row>
            <Row label="Subtext"><Text value={block.subtext} onChange={(v) => set({ subtext: v })} /></Row>
            <Row label="Alignment">
              <Segmented value={block.align ?? "start"} options={[{ value: "start", label: "Start" }, { value: "center", label: "Center" }]} onChange={(v) => set({ align: v as "start" | "center" })} />
            </Row>
            <Row label="Art">
              <ImageField id={block.image} fit={block.imageFit} focus={block.focus} side={block.imageSide ?? "right"} onChange={(p) => set({ image: "id" in p ? p.id : block.image, imageFit: p.fit ?? block.imageFit, focus: p.focus ?? block.focus, imageSide: p.side ?? block.imageSide })} />
            </Row>
          </>
        );
      case "progress":
        return (
          <>
            <Row label="Icon"><IconField value={block.icon} onChange={(v) => set({ icon: v })} /></Row>
            <Row label="Title"><Text value={block.title} onChange={(v) => set({ title: v })} /></Row>
            <Row label="Caption"><Text value={block.caption} onChange={(v) => set({ caption: v })} placeholder="1h 24m / 2h" /></Row>
            <div className="pbi-two">
              <Row label="Current"><input className="field" type="number" value={block.value} onChange={(e) => set({ value: Number(e.target.value) || 0 })} /></Row>
              <Row label="Max"><input className="field" type="number" min={1} value={block.max} onChange={(e) => set({ max: Math.max(1, Number(e.target.value) || 1) })} /></Row>
            </div>
            <Row label="Value">
              <Segmented value={block.display ?? "ratio"} options={[{ value: "ratio", label: "67/100" }, { value: "percent", label: "67%" }, { value: "none", label: "Hidden" }]} onChange={(v) => set({ display: v as "ratio" | "percent" | "none" })} />
            </Row>
          </>
        );
      case "grid":
        return (
          <>
            <Row label="Title"><Text value={block.title} onChange={(v) => set({ title: v || undefined })} placeholder="Optional" /></Row>
            <Row label="Columns">
              <Segmented value={String(block.columns)} options={[{ value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }]} onChange={(v) => set({ columns: Number(v) as 1 | 2 | 3 | 4 })} />
            </Row>
            <Row label="Items"><ItemsField items={block.items} onChange={(items) => set({ items })} withUrl /></Row>
          </>
        );
      case "list":
        return (
          <>
            <Row label="Title"><Text value={block.title} onChange={(v) => set({ title: v || undefined })} /></Row>
            <Row label="Rows"><ItemsField items={block.items} onChange={(items) => set({ items })} min={1} max={6} withUrl /></Row>
          </>
        );
      case "media":
        return (
          <>
            <Row label="Media">
              <ImageField id={block.media} fit={block.fit} focus={block.focus} video={block.isVideo} onChange={(p) => set({ media: "id" in p ? p.id : block.media, isVideo: p.isVideo ?? block.isVideo, fit: p.fit ?? block.fit, focus: p.focus ?? block.focus })} />
            </Row>
            <Row label="Caption"><Text value={block.caption} onChange={(v) => set({ caption: v || undefined })} placeholder="Optional" /></Row>
          </>
        );
      case "frame":
        return (
          <>
            <Row label="Photos">
              <div className="pbi-photos">
                {block.photos.map((p, i) => (
                  <div key={p + i} className="pbi-photo">
                    <img src={fileUrl(p)} alt="" />
                    <div className="pbi-photo-actions">
                      <button disabled={i === 0} onClick={() => set({ photos: move(block.photos, i, i - 1) })} aria-label="Earlier">
                        <Icon name="back" size={12} />
                      </button>
                      <button onClick={() => set({ photos: block.photos.filter((_, j) => j !== i) })} aria-label="Remove">
                        <Icon name="close" size={12} />
                      </button>
                    </div>
                  </div>
                ))}
                {block.photos.length < 20 && (
                  <button
                    className="pbi-photo-add"
                    onClick={async () => {
                      const picked = await openDialog({ multiple: true, title: "Add photos", filters: [{ name: "Images", extensions: ["gif", "png", "jpg", "jpeg", "webp", "avif"] }] });
                      if (!picked) return;
                      const paths = Array.isArray(picked) ? picked : [picked];
                      const ids: string[] = [];
                      for (const path of paths) {
                        try {
                          ids.push((await api.importFile(null, path)).id);
                        } catch (e) {
                          toast(e);
                        }
                      }
                      set({ photos: [...block.photos, ...ids].slice(0, 20) });
                    }}
                  >
                    <Icon name="add" size={16} />
                  </button>
                )}
              </div>
            </Row>
            <Row label="Shape">
              <Select value={block.shape} options={FRAME_SHAPES.map((s) => ({ value: s.id, label: s.label }))} onChange={(v) => set({ shape: v })} />
            </Row>
            <Row label="Fit">
              <Segmented value={block.fit} options={[{ value: "fill", label: "Fill" }, { value: "whole", label: "Whole picture" }]} onChange={(v) => set({ fit: v as "fill" | "whole" })} />
            </Row>
            {block.fit === "fill" && block.photos[0] && (
              <Row label="Focus">
                <ImageField id={block.photos[0]} fit="cover" focus={block.focus} onChange={(p) => p.focus && set({ focus: p.focus })} />
              </Row>
            )}
            {block.shape !== "circle" && (
              <Row label={`Corner radius ${block.radius}px`}>
                <input type="range" min={0} max={48} value={block.radius} onChange={(e) => set({ radius: Number(e.target.value) })} className="crop-zoom" />
              </Row>
            )}
            <Row label="Shadow">
              <Segmented value={block.shadow ? "on" : "off"} options={[{ value: "on", label: "Floating" }, { value: "off", label: "None (cut-outs)" }]} onChange={(v) => set({ shadow: v === "on" })} />
            </Row>
            <Row label="Text over the picture">
              <div className="pbi-inline">
                <Text value={block.text} onChange={(v) => set({ text: v || undefined })} placeholder="Optional" />
                <Segmented value={block.textPos ?? "bottom"} options={[{ value: "top", label: "Top" }, { value: "bottom", label: "Bottom" }]} onChange={(v) => set({ textPos: v as "top" | "bottom" })} />
              </div>
            </Row>
            {block.photos.length > 1 && (
              <Row label={`Next photo every ${block.interval ?? 8}s`}>
                <input type="range" min={3} max={60} value={block.interval ?? 8} onChange={(e) => set({ interval: Number(e.target.value) })} className="crop-zoom" />
              </Row>
            )}
          </>
        );
      case "fields":
        return (
          <>
            <Row label="Title"><Text value={block.title} onChange={(v) => set({ title: v || undefined })} /></Row>
            <div className="pbi-items">
              {block.fields.map((f, i) => (
                <div key={i} className="pbi-kv">
                  <input className="field bidi" dir="auto" placeholder="Key" value={f.key} onChange={(e) => set({ fields: block.fields.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })} />
                  <input className="field bidi" dir="auto" placeholder="Value" value={f.value} onChange={(e) => set({ fields: block.fields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
                  <IconButton icon="close" label="Remove" onClick={() => set({ fields: block.fields.filter((_, j) => j !== i) })} />
                </div>
              ))}
              {block.fields.length < 8 && (
                <button className="chip-btn" onClick={() => set({ fields: [...block.fields, { key: "", value: "" }] })}>
                  <Icon name="add" size={13} />
                  Add field
                </button>
              )}
            </div>
          </>
        );
      case "links":
        return (
          <>
            <Row label="Title"><Text value={block.title} onChange={(v) => set({ title: v || undefined })} /></Row>
            <Row label="Buttons"><ItemsField items={block.links} onChange={(links) => set({ links })} max={6} withUrl /></Row>
          </>
        );
      case "badges":
        return (
          <>
            <Row label="Title"><Text value={block.title} onChange={(v) => set({ title: v || undefined })} /></Row>
            <Row label="Badges"><ItemsField items={block.badges} onChange={(badges) => set({ badges })} max={8} /></Row>
          </>
        );
      case "dynamic":
        return (
          <>
            <Row label="Shows">
              <Select value={dynamicSource(block.source)} options={DYNAMIC_SOURCES.map((s) => ({ value: s.id, label: s.label }))} onChange={(v) => set({ source: v })} />
            </Row>
            <Row label="Title"><Text value={block.title} onChange={(v) => set({ title: v || undefined })} placeholder="Automatic" /></Row>
            {block.source === "session" && (
              <Row label="Daily goal (minutes)">
                <input className="field" type="number" min={10} max={1440} value={block.goal ?? 120} onChange={(e) => set({ goal: Math.max(10, Number(e.target.value) || 120) })} />
              </Row>
            )}
          </>
        );
    }
  };

  return (
    <div className="pbi">
      <div className="pbi-head">
        <RefIcon value={type.icon} size={28} />
        <div className="pbi-head-title">{type.label}</div>
        <IconButton icon="close" label="Done" onClick={onClose} />
      </div>
      <div className="pbi-body scroll">
        <div className="pbi-two">
          <Row label="Size">
            <Select value={block.size} options={SIZES.map((s) => ({ value: s.id, label: s.label, hint: s.id.replace("x", " x ") }))} onChange={(v) => set({ size: v })} />
          </Row>
          <Row label="Style">
            <Select value={block.style} options={STYLES.map((s) => ({ value: s.id, label: s.label, hint: s.note }))} onChange={(v) => set({ style: v })} />
          </Row>
        </div>
        <div className="pbi-two">
          <Row label="Accent">
            <div className="pbi-inline">
              <input type="color" className="pbi-color" value={block.accent ?? "#8d99ff"} onChange={(e) => set({ accent: e.target.value })} />
              {block.accent && <button className="link-btn" onClick={() => set({ accent: undefined })}>From banner</button>}
            </div>
          </Row>
          <Row label="Opens">
            <input className="field" dir="ltr" placeholder="https:// (optional)" value={block.url ?? ""} onChange={(e) => set({ url: e.target.value || undefined })} />
          </Row>
        </div>
        {specific()}
        <div className="pbi-foot">
          <Button variant="quiet" icon={block.hidden ? "preview" : "lock"} onClick={() => set({ hidden: !block.hidden })}>
            {block.hidden ? "Show block" : "Hide block"}
          </Button>
          <Button variant="danger" icon="delete" onClick={onRemove}>
            Remove
          </Button>
        </div>
      </div>
    </div>
  );
}

export type { BlockType };
