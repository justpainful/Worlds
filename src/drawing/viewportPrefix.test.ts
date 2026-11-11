import { describe, it, expect } from "vitest";
import { newScene, newLayer, newNode, DEFAULT_BRUSH } from "./model";
import { viewportPrefixPlan, draftDeviceBounds, unionDeviceBounds, PREFIX_PIXEL_LIMIT } from "./viewportPrefix";
function fixture() {
  const s = newScene(),
    bottom = s.layerOrder[0],
    top = newLayer("Top");
  s.layers[top.id] = top;
  s.layerOrder.push(top.id);
  const draft = newNode("stroke", top.id, s.defaultFrameId);
  draft.brush = { ...DEFAULT_BRUSH };
  draft.samples = [{ x: 0, y: 0, pressure: 1, time: 0, tiltX: 0, tiltY: 0 }];
  return { s, bottom, top, draft };
}
const view = { x: 0, y: 0, w: 300, h: 200, scale: 1 };
describe("bounded viewport prefix plans", () => {
  it("prewarms the identical prefix key and unions transformed old/new footprints with halos", () => {
    const { s, top, draft } = fixture();
    expect(viewportPrefixPlan(s, view, 300, 200, { activeLayerId: top.id }, 0)?.key).toBe(
      viewportPrefixPlan(s, view, 300, 200, { draft }, 0)?.key,
    );
    const old = draftDeviceBounds(s, view, 300, 200, { draft })!;
    draft.x = 50;
    draft.rotation = 10;
    draft.flipX = true;
    const next = draftDeviceBounds(s, view, 300, 200, { draft })!,
      union = unionDeviceBounds(old, next);
    expect(union.x).toBeLessThanOrEqual(old.x);
    expect(union.x + union.w).toBeGreaterThanOrEqual(next.x + next.w);
    expect(unionDeviceBounds({ x: 0, y: 0, w: 0, h: 0 }, next)).toEqual(next);
    expect(draftDeviceBounds(s, view, 300, 200, { draft: { ...draft, kind: "shape" } })).toBeNull();
  });
  it("excludes the dirty root, including all ancestors and all later roots", () => {
    const { s, bottom, top, draft } = fixture();
    expect(viewportPrefixPlan(s, view, 300, 200, { draft }, 0)?.prefixCount).toBe(1);
    const child = newLayer("Child");
    child.parentId = bottom;
    s.layers[child.id] = child;
    s.layerOrder.push(child.id);
    draft.layerId = child.id;
    expect(viewportPrefixPlan(s, view, 300, 200, { draft }, 0)).toBeNull();
    draft.layerId = top.id;
    expect(viewportPrefixPlan(s, view, 300, 200, { draft }, 0)?.roots).toEqual([bottom, top.id]);
  });
  it("fingerprints mutations, remote projections, options, assets, masks and readiness", () => {
    const { s, top, draft } = fixture(),
      n = newNode("shape", s.layerOrder[0], s.defaultFrameId);
    n.shape = "rect";
    s.nodes[n.id] = n;
    s.nodeOrder.push(n.id);
    const key = viewportPrefixPlan(s, view, 300, 200, { draft }, 0)!.key;
    n.paint.fill = "#ff0000";
    expect(viewportPrefixPlan(s, view, 300, 200, { draft }, 0)!.key).not.toBe(key);
    const next = viewportPrefixPlan(s, view, 300, 200, { draft }, 0)!.key;
    expect(viewportPrefixPlan(s, view, 300, 200, { draft, annotations: false }, 0)!.key).not.toBe(next);
    expect(viewportPrefixPlan(s, view, 300, 200, { draft }, 1)!.key).not.toBe(next);
    s.layers[top.id].opacity = 0.5;
    expect(viewportPrefixPlan(s, view, 300, 200, { draft }, 0)!.key).not.toBe(next);
  });
  it("does not cache unsupported previews, live references, a first-root draft or oversized surfaces", () => {
    const { s, bottom, draft } = fixture();
    expect(viewportPrefixPlan(s, view, 300, 200, {}, 0)).toBeNull();
    expect(viewportPrefixPlan(s, view, 300, 200, { layerId: bottom, draft }, 0)).toBeNull();
    expect(viewportPrefixPlan(s, view, PREFIX_PIXEL_LIMIT, 1, { draft }, 0)).toBeNull();
    const n = newNode("reference", bottom, s.defaultFrameId);
    s.nodes[n.id] = n;
    s.nodeOrder.push(n.id);
    expect(viewportPrefixPlan(s, view, 300, 200, { draft }, 0)).toBeNull();
  });
  it("uses the earliest of multiple remote/local drafts and ignores already committed IDs", () => {
    const { s, bottom, draft } = fixture(),
      peer = { ...draft, id: "peer", layerId: bottom };
    expect(viewportPrefixPlan(s, view, 300, 200, { draft, drafts: [peer] }, 0)).toBeNull();
    s.nodes[peer.id] = peer;
    s.nodeOrder.push(peer.id);
    expect(viewportPrefixPlan(s, view, 300, 200, { draft, drafts: [peer] }, 0)?.prefixCount).toBe(1);
  });
});
