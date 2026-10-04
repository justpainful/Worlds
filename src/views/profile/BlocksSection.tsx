import { useEffect, useState, type DragEvent } from "react";
import { Glass } from "../../glass/Glass";
import { LAYER } from "../../glass/materials";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { RefIcon } from "../../ui/ProductIcon";
import { BlockBody, BlockFrame, type LiveData } from "../../profile/BlockView";
import { BlockInspector, BlockPicker, move } from "../../profile/BlockEditor";
import { FEATURED, MAX_BLOCKS, sizeOf, SIZES, starterBlocks, type ProfileBlock } from "../../profile/blocks";

// ---------------------------------------------------------------------------
// Blocks: view + Customize Blocks
// ---------------------------------------------------------------------------

export function BlocksSection({
  blocks,
  live,
  customizing,
  setCustomizing,
  onSave,
}: {
  blocks: ProfileBlock[];
  live: LiveData;
  customizing: boolean;
  setCustomizing: (v: boolean) => void;
  onSave: (b: ProfileBlock[]) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<ProfileBlock[]>(blocks);
  const [selected, setSelected] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  useEffect(() => {
    if (customizing) setDraft(blocks);
    else setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customizing]);

  const list = customizing ? draft : blocks.filter((b) => !b.hidden);
  const sel = draft.find((b) => b.id === selected) ?? null;

  const done = async () => {
    await onSave(draft);
    setCustomizing(false);
  };

  const onDrop = (e: DragEvent, targetId: string) => {
    e.preventDefault();
    if (!dragId || dragId === targetId) return;
    const from = draft.findIndex((b) => b.id === dragId);
    const to = draft.findIndex((b) => b.id === targetId);
    setDraft(move(draft, from, to));
    setDragId(null);
    setOverId(null);
  };

  if (!customizing && list.length === 0) {
    return (
      <section className="pf-blocks-empty">
        <div className="pf-blocks-empty-art">
          <RefIcon value="pi:design" size={44} />
          <RefIcon value="pi:star" size={44} />
          <RefIcon value="pi:activity" size={44} />
        </div>
        <div className="pf-blocks-empty-title">Make this profile yours</div>
        <p className="pf-blocks-empty-text">Blocks show what you are working on, your skills, links, media and live stats from Worlds.</p>
        <div className="pf-blocks-empty-actions">
          <Button variant="tinted" icon="grid" onClick={() => setCustomizing(true)}>
            Customize Blocks
          </Button>
          <Button variant="plain" onClick={() => onSave(starterBlocks())}>
            Start with suggestions
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="pf-blocks-wrap">
      <div className="pf-blocks-head">
        {customizing ? (
          <>
            <span className="pf-blocks-title">Customize Blocks</span>
            <span className="pf-blocks-count">
              {draft.length}/{MAX_BLOCKS}
            </span>
            <span className="grow" />
            <Button variant="quiet" onClick={() => setCustomizing(false)}>
              Cancel
            </Button>
            <Button variant="tinted" icon="check" onClick={done}>
              Done
            </Button>
          </>
        ) : (
          <>
            <span className="grow" />
            <button className="pf-customize" onClick={() => setCustomizing(true)}>
              <Icon name="grid" size={13} />
              Customize
            </button>
          </>
        )}
      </div>

      <div className="pf-blocks">
        {list.map((b, i) => {
          if (!customizing) {
            return (
              <BlockFrame key={b.id} block={b}>
                <BlockBody block={b} live={live} />
              </BlockFrame>
            );
          }
          const size = sizeOf(b.size);
          return (
            <div
              key={b.id}
              className={`pf-edit-cell ${dragId === b.id ? "is-dragging" : ""} ${overId === b.id ? "is-over" : ""} ${b.hidden ? "is-hidden" : ""}`}
              style={{ gridColumn: `span ${size.cols}`, gridRow: `span ${size.rows}` }}
              draggable
              onDragStart={(e) => {
                setDragId(b.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOverId(b.id);
              }}
              onDrop={(e) => onDrop(e, b.id)}
            >
              <BlockFrame block={{ ...b, size: "12x1" }} selected={selected === b.id} onClick={() => setSelected(b.id)} className="is-editing">
                <BlockBody block={b} live={live} />
              </BlockFrame>
              <Glass className="pf-edit-bar" contentClassName="pf-edit-row" material="control" layer={LAYER.floating} radius="var(--r-capsule)">
                {i < FEATURED && <span className="pf-featured">Featured</span>}
                <span className="pf-edit-grip" data-tip="Drag to reorder">
                  <Icon name="grip" size={14} />
                </span>
                <button
                  className="pf-edit-btn"
                  data-tip="Size"
                  onClick={() => {
                    const idx = SIZES.findIndex((s) => s.id === b.size);
                    const next = SIZES[(idx + 1) % SIZES.length].id;
                    setDraft(draft.map((x) => (x.id === b.id ? { ...x, size: next } : x)));
                  }}
                >
                  {sizeOf(b.size).label}
                </button>
                <button className="pf-edit-btn" data-tip="Edit" onClick={() => setSelected(b.id)}>
                  <Icon name="edit" size={13} />
                </button>
                <button className="pf-edit-btn is-danger" data-tip="Remove" onClick={() => setDraft(draft.filter((x) => x.id !== b.id))}>
                  <Icon name="minimize" size={13} />
                </button>
              </Glass>
            </div>
          );
        })}
        {customizing && draft.length < MAX_BLOCKS && (
          <button className="pf-add-block" onClick={() => setPicking(true)}>
            <Icon name="add" size={20} />
            <span>Add a block</span>
          </button>
        )}
      </div>

      {customizing && sel && (
        <Glass material="dense" layer={LAYER.popover} className="pf-inspector" radius="26px">
          <BlockInspector
            block={sel}
            onChange={(nb) => setDraft(draft.map((x) => (x.id === nb.id ? nb : x)))}
            onRemove={() => {
              setDraft(draft.filter((x) => x.id !== sel.id));
              setSelected(null);
            }}
            onClose={() => setSelected(null)}
          />
        </Glass>
      )}
      {picking && (
        <BlockPicker
          blocks={draft}
          onClose={() => setPicking(false)}
          onPick={(b) => {
            setDraft([...draft, b]);
            setSelected(b.id);
            setPicking(false);
          }}
        />
      )}
    </section>
  );
}
