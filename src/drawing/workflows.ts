import {effectiveLayer,layerDescendants,layerDisplayOrder,layerTree} from "./layers";
import { id,newLayer, type Change, type DrawingNode, type DrawingScene, type Frame, type Mask,type Asset, type Point } from "./model";
import {removeNodes} from './operations';
import { bounds, localToWorld } from "./geometry";

/** Move every world-space component together. Linked masks use node-local coordinates. */
export function translateWorldMask(mask: Mask, offset: Point): Mask {
  const copy = structuredClone(mask);
  if (!copy.linked) {
    copy.x += offset.x; copy.y += offset.y;
    for (const stroke of copy.strokes) stroke.samples = stroke.samples.map(sample => ({ ...sample, x: sample.x + offset.x, y: sample.y + offset.y }));
  }
  return copy;
}

function translatedNode(node: DrawingNode, offset: Point): DrawingNode {
  const next = { ...structuredClone(node), x: node.x + offset.x, y: node.y + offset.y };
  for (const key of ["anchor", "endAnchor"] as const) {
    const anchor = next[key];
    if (anchor && !anchor.nodeId) next[key] = { ...anchor, fallback: { x: anchor.fallback.x + offset.x, y: anchor.fallback.y + offset.y } };
  }
  return next;
}
export function duplicateElements(scene: DrawingScene, nodeIds: string[], offset: Point = { x: 20, y: 20 }, frameId?: string): { changes: Change[]; nodes: DrawingNode[] } {
  const remap = new Map(nodeIds.map((old) => [old, id()])), groups = new Map<string, string>(), masks = new Map<string, Mask>(),assets=new Map<string,Asset>();
  const copyAsset=(key:string)=>{if(!assets.has(key)){const original=scene.assets[key];if(!original)throw Error("Missing copied original");assets.set(key,{...structuredClone(original),id:id()});}return assets.get(key)!.id;};
  const nodes = nodeIds.filter((key) => scene.nodes[key]).map((key) => {
    const node = translatedNode(scene.nodes[key], offset); node.id = remap.get(key)!;
    delete node.libraryItemId; delete node.libraryVersion; delete node.libraryInstanceId; delete node.librarySourceNodeId;
    if (frameId) node.frameId = frameId;
    if(node.assetId)node.assetId=copyAsset(node.assetId);if(node.brush?.tipAssetId)node.brush.tipAssetId=copyAsset(node.brush.tipAssetId);
    if (node.groupId) { if (!groups.has(node.groupId)) groups.set(node.groupId, id()); node.groupId = groups.get(node.groupId)!; }
    if (node.annotationGroup) { const key=`annotation:${node.annotationGroup}`;if (!groups.has(key)) groups.set(key,id());node.annotationGroup=groups.get(key)!; }
    for (const anchorKey of ["anchor", "endAnchor"] as const) {
      const anchor = node[anchorKey];
      if (anchor?.nodeId && remap.has(anchor.nodeId)) node[anchorKey] = { ...anchor, nodeId: remap.get(anchor.nodeId)!, fallback: { x: anchor.fallback.x + offset.x, y: anchor.fallback.y + offset.y } };
    }
    const copyMask=(key:string)=>{if(!masks.has(key)){const original=scene.masks[key];if(original){const clone={...translateWorldMask(original,offset),id:id()};if(clone.assetId)clone.assetId=copyAsset(clone.assetId);for(const stroke of clone.strokes)if(stroke.brush.tipAssetId)stroke.brush.tipAssetId=copyAsset(stroke.brush.tipAssetId);masks.set(key,clone);}}return masks.get(key)?.id;};
    if(node.maskId)node.maskId=copyMask(node.maskId);node.effects=node.effects.map(e=>e.maskId?{...e,maskId:copyMask(e.maskId)}:e);
    return node;
  });
  return { nodes, changes: [...[...assets.values()].map((a):Change=>({type:"put",collection:"assets",id:a.id,value:a})),...[...masks.values()].map((m): Change => ({ type: "put", collection: "masks", id: m.id, value: m })), ...nodes.map((n): Change => ({ type: "put", collection: "nodes", id: n.id, value: n })), { type: "order", list: "nodeOrder", ids: [...scene.nodeOrder, ...nodes.map((n) => n.id)] }] };
}
export function duplicateLayerTree(scene:DrawingScene,layerId:string,suffix='copy'):{changes:Change[];layerId:string}{
 if(!scene.layers[layerId])throw Error('layer-missing');const chosen=layerDescendants(scene,layerId),order=layerDisplayOrder(scene),source=order.filter(id=>chosen.has(id)),remap=new Map(source.map(key=>[key,id()])),copies=source.map(key=>{const layer={...structuredClone(scene.layers[key]),id:remap.get(key)!,parentId:key===layerId?scene.layers[key].parentId:remap.get(scene.layers[key].parentId!)!};if(key===layerId)layer.name+=` (${suffix})`;delete layer.libraryInstanceId;delete layer.librarySourceLayerId;return layer;});
 const copied=duplicateElements(scene,scene.nodeOrder.filter(key=>chosen.has(scene.nodes[key].layerId)),{x:0,y:0}),changes=copied.changes.filter(c=>c.type!=='order').map((c):Change=>c.type==='put'&&c.collection==='nodes'?{...c,value:{...c.value as DrawingNode,layerId:remap.get((c.value as DrawingNode).layerId)!}}:c),end=Math.max(...source.map(id=>order.indexOf(id)))+1;
 return{layerId:remap.get(layerId)!,changes:[...copies.map(layer=>({type:'put',collection:'layers',id:layer.id,value:layer}as Change)),{type:'order',list:'layerOrder',ids:[...order.slice(0,end),...copies.map(l=>l.id),...order.slice(end)]},...changes,{type:'order',list:'nodeOrder',ids:[...scene.nodeOrder,...copied.nodes.map(n=>n.id)]}]};
}
export function reorderLayerTree(scene:DrawingScene,layerId:string,direction:number):Change[]{
 const layer=scene.layers[layerId];if(!layer)throw Error('layer-missing');if(effectiveLayer(scene,layerId).locked)throw Error('layer-locked');const tree=layerTree(scene),siblings=[...tree.get(layer.parentId)??[]],at=siblings.indexOf(layerId),next=at+(direction<0?-1:1);if(at<0||next<0||next>=siblings.length)return[];[siblings[at],siblings[next]]=[siblings[next],siblings[at]];tree.set(layer.parentId,siblings);const order:string[]=[],pending=[...tree.get(null)??[]].reverse();while(pending.length){const id=pending.pop()!;order.push(id);pending.push(...[...tree.get(id)??[]].reverse());}return[{type:'order',list:'layerOrder',ids:order}];
}
export function deleteLayerTree(scene:DrawingScene,layerId:string):{changes:Change[];nextId:string}{
 if(!scene.layers[layerId])throw Error('layer-missing');const chosen=layerDescendants(scene,layerId),nodes=scene.nodeOrder.filter(id=>chosen.has(scene.nodes[id].layerId));if([...chosen].some(id=>effectiveLayer(scene,id).locked)||nodes.some(id=>scene.nodes[id].locked))throw Error('layer-locked');const changes=removeNodes(scene,nodes);for(const c of changes)if(c.type==='patch'&&c.collection==='nodes'&&(scene.nodes[c.id].locked||effectiveLayer(scene,scene.nodes[c.id].layerId).locked))throw Error('layer-locked');const order=scene.layerOrder.filter(id=>!chosen.has(id));if(!order.length){const blank=newLayer();changes.push({type:'put',collection:'layers',id:blank.id,value:blank});order.push(blank.id);}changes.push(...[...chosen].reverse().map(id=>({type:'remove',collection:'layers',id}as Change)),{type:'order',list:'layerOrder',ids:order});return{changes,nextId:order.at(-1)!};
}
export function duplicateFrame(scene: DrawingScene, frameId: string): { frame: Frame; changes: Change[] } {
  const original = scene.frames[frameId]; if (!original) throw new Error("Frame not found");
  const frame = { ...structuredClone(original), id: id(), name: `${original.name} (copy)`, x: original.x + original.w + 100 };
  if(frame.guides)frame.guides=frame.guides.map(g=>({...g,id:id()}));
  delete frame.libraryItemId; delete frame.libraryVersion; delete frame.libraryInstanceId; delete frame.librarySourceFrameId;
  const duplicated = duplicateElements(scene, scene.nodeOrder.filter((key) => scene.nodes[key].frameId === frameId), { x: frame.x - original.x, y: frame.y - original.y }, frame.id);
  return { frame, changes: [{ type: "put", collection: "frames", id: frame.id, value: frame }, { type: "order", list: "frameOrder", ids: [...scene.frameOrder, frame.id] }, ...duplicated.changes] };
}
export function moveFrame(scene: DrawingScene, frameId: string, position: Point): Change[] {
  const frame = scene.frames[frameId]; if (!frame) throw new Error("Frame not found");
  const offset = { x: position.x - frame.x, y: position.y - frame.y }, changes: Change[] = [{ type: "patch", collection: "frames", id: frameId, fields: { ...position } }];
  const members=Object.values(scene.nodes).filter(n=>n.frameId===frameId),memberIds=new Set(members.map(n=>n.id));
  for (const original of members) {
    const node = translatedNode(original, offset);
    for(const key of ['anchor','endAnchor'] as const){const anchor=node[key];if(anchor?.nodeId&&(memberIds.has(anchor.nodeId)||!scene.nodes[anchor.nodeId]))node[key]={...anchor,fallback:{x:anchor.fallback.x+offset.x,y:anchor.fallback.y+offset.y}};}
    // An unlinked mask is fixed in world coordinates even when its frame moves.
    // Linked masks remain in node-local coordinates and follow the node naturally.
    const { id: _id, ...fields } = node;
    changes.push({ type: "patch", collection: "nodes", id: original.id, fields });
  }
  // A live presentation step captures a world-space camera for this frame.
  // Keep that camera on the moved content; pinned steps belong to an older snapshot.
  for(const step of Object.values(scene.steps))if(step.frameId===frameId&&!step.pinnedVersionId)changes.push({type:'patch',collection:'steps',id:step.id,fields:{camera:{...step.camera,x:step.camera.x+offset.x,y:step.camera.y+offset.y}}});
  return changes;
}
export function alignElements(scene: DrawingScene, nodeIds: string[], alignment: "left" | "center" | "right" | "top" | "middle" | "bottom" | "horizontal" | "vertical"): Change[] {
  const nodes = nodeIds.map((id) => scene.nodes[id]).filter((n) => n && !n.locked && !effectiveLayer(scene,n.layerId).locked && !effectiveLayer(scene,n.layerId).positionLocked);
  if (nodes.length < 2) return [];
  const boxes = nodes.map((n) => bounds([{ x: 0, y: 0 }, { x: n.w, y: 0 }, { x: n.w, y: n.h }, { x: 0, y: n.h }].map((p) => localToWorld(n, p))));
  const all = bounds(boxes.flatMap((b) => [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }]));
  const ordered = nodes.map((n, i) => ({ n, b: boxes[i] })).sort((a, b) => alignment === "horizontal" ? a.b.x - b.b.x : a.b.y - b.b.y);
  return nodes.map((n, i) => {
    const b = boxes[i], fields: Record<string, number> = {};
    switch (alignment) {
      case "left": fields.x = n.x + all.x - b.x; break;
      case "center": fields.x = n.x + all.x + all.w / 2 - b.x - b.w / 2; break;
      case "right": fields.x = n.x + all.x + all.w - b.x - b.w; break;
      case "top": fields.y = n.y + all.y - b.y; break;
      case "middle": fields.y = n.y + all.y + all.h / 2 - b.y - b.h / 2; break;
      case "bottom": fields.y = n.y + all.y + all.h - b.y - b.h; break;
      case "horizontal": fields.x = n.x + all.x + ordered.findIndex((p) => p.n.id === n.id) * (all.w - ordered.at(-1)!.b.w) / (nodes.length - 1) - b.x; break;
      case "vertical": fields.y = n.y + all.y + ordered.findIndex((p) => p.n.id === n.id) * (all.h - ordered.at(-1)!.b.h) / (nodes.length - 1) - b.y; break;
    }
    return { type: "patch", collection: "nodes", id: n.id, fields };
  });
}
