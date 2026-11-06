import {describe,it,expect} from 'vitest';
import {newScene,newLayer,newNode} from './model';
import {layerAncestors,effectiveLayer,layerDescendants,layerDisplayOrder} from './layers';
import {pixelGuard,checkPixelGuard} from './pixelGuard';
import {drawingLeaseCovers,drawingLeaseTargets} from './canonical';
import {edit,newDrawing} from './operations';
import {objectTransformChanges,translateObjects} from './objectTransforms';
describe('nested layers',()=>{
 it('orders children within their parent and inherits visibility and locks',()=>{
  const s=newScene(),parent=s.layers[s.layerOrder[0]],child=newLayer('Child'),grand=newLayer('Grandchild');child.parentId=parent.id;grand.parentId=child.id;s.layers[child.id]=child;s.layers[grand.id]=grand;s.layerOrder=[grand.id,parent.id,child.id];
  expect(layerDisplayOrder(s)).toEqual([parent.id,child.id,grand.id]);expect(layerAncestors(s,grand.id).map(l=>l.id)).toEqual([grand.id,child.id,parent.id]);expect(layerDescendants(s,parent.id)).toEqual(new Set(s.layerOrder));
  parent.visible=false;parent.locked=true;parent.positionLocked=true;parent.alphaLocked=true;expect(effectiveLayer(s,grand.id)).toMatchObject({visible:false,locked:true,positionLocked:true,alphaLocked:true,depth:2});expect(drawingLeaseCovers(s,`layer:${parent.id}`,`layer:${grand.id}`)).toBe(true);
 });
 it('receipts include and fence ancestors, and reject changed or missing ancestor metadata',()=>{
  const d=newDrawing(),s=d.scene,parent=s.layers[s.layerOrder[0]],child=newLayer('Child');child.parentId=parent.id;s.layers[child.id]=child;s.layerOrder.push(child.id);
  const guard=pixelGuard(s,s.defaultFrameId,child.id,'current'),op=edit('a',0,'Guarded child',[]);op.pixelGuard=guard;expect(guard.expected.ancestors).toEqual([parent]);expect(drawingLeaseTargets(d,op)).toEqual([`layer:${child.id}`,`layer:${parent.id}`].sort());checkPixelGuard(s,guard);
  parent.opacity=.5;expect(()=>checkPixelGuard(s,guard)).toThrow('sampled pixel source changed');parent.opacity=1;delete guard.expected.ancestors;expect(()=>checkPixelGuard(s,guard)).toThrow('sampled pixel source changed');
 });
 it('prevents transforming a child when an ancestor gains a position lock',()=>{
  const s=newScene(),parent=s.layers[s.layerOrder[0]],child=newLayer('Child');child.parentId=parent.id;s.layers[child.id]=child;s.layerOrder.push(child.id);const n=newNode('shape',child.id,s.defaultFrameId);n.shape='rect';s.nodes[n.id]=n;s.nodeOrder.push(n.id);const after=translateObjects(s,[n],{x:20,y:0});parent.positionLocked=true;expect(()=>objectTransformChanges(s,[n],after)).toThrow('locked');expect(s.nodes[n.id]).toEqual(n);
 });
});
