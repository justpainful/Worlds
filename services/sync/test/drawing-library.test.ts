import {SELF,env,evictDurableObject} from 'cloudflare:test';
import {describe,it,expect} from 'vitest';
import {BASE,grant,mintToken,uid} from './client';
import {newDrawing} from '../../../src/drawing/operations';
import type {DrawingWireVersion,DrawingWireState} from '../../../src/drawing/wire';
describe('immutable shared library directory',()=>{
 it('binds descriptors to actual document, preserves history and refuses poisoning before persistence',async()=>{
  const ws=uid('ws'),page=uid('library'),alice=uid('alice'),bob=uid('bob');await grant(alice,ws,page,'edit');await grant(bob,ws,page,'edit');
  const call=async(user:string,path:string,method='GET',body?:unknown)=>SELF.fetch(`${BASE}/v1/workspaces/${ws}/docs/${page}/drawing/${path}`,{method,headers:{authorization:`Bearer ${await mintToken(user)}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),initial=newDrawing();
  const version=(number:number,color:string):DrawingWireVersion=>{const scene=structuredClone(initial.scene);scene.libraryPublication={schema:1,itemId:page,version:number,name:`Shared palette${number}`,kind:'palette',tags:['ألوان'],sourceId:'source',payload:{colors:[color]},createdAt:number};return{scene,revision:number,author:'forged-author',label:`Publication${number}`,createdAt:number};};
  const one=crypto.randomUUID(),two=crypto.randomUUID(),v1=version(1,'#ff0000'),v2=version(2,'#0000ff80');
  const initialized=await call(alice,'state','PUT',{document:initial,localActor:'local',attachments:{},versions:{[one]:v1}});expect(initialized.status).toBe(200);const state=(await initialized.json<{state:DrawingWireState}>()).state;expect(state.versions[one].author).toBe(alice);
  const post=(versions:Record<string,DrawingWireVersion>)=>call(bob,'operations','POST',{generation:state.generation,attachments:{},versions});
  const wrongItem=version(2,'#ffffff');wrongItem.scene.libraryPublication!.itemId='another-page';expect((await post({[two]:wrongItem})).status).toBe(400);
  const wrongRevision=version(2,'#ffffff');wrongRevision.revision=3;expect((await post({[two]:wrongRevision})).status).toBe(400);
  const gap=version(3,'#ffffff');expect((await post({[two]:gap})).status).toBe(400);
  let current=(await(await call(alice,'state')).json<{state:DrawingWireState}>()).state;expect(current.dependencyRevision).toBe(state.dependencyRevision);expect(Object.keys(current.versions)).toEqual([one]);
  expect((await post({[two]:v2})).status).toBe(200);current=(await(await call(alice,'state')).json<{state:DrawingWireState}>()).state;expect(current.versions[two].author).toBe(bob);expect(current.versions[one].scene.libraryPublication!.payload.colors).toEqual(['#ff0000']);
  expect((await post({[crypto.randomUUID()]:version(2,'#00ff00')})).status).toBe(400);expect((await post({[crypto.randomUUID()]:v2})).status).toBe(400);const after=(await(await call(alice,'state')).json<{state:DrawingWireState}>()).state;expect(after.dependencyRevision).toBe(current.dependencyRevision);expect(after.versions).toEqual(current.versions);
  await evictDurableObject(env.DOCS.getByName(`${ws}/${page}`));const reopened=(await(await call(alice,'state')).json<{state:DrawingWireState}>()).state;expect(reopened.versions).toEqual(current.versions);
 });
});
