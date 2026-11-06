import {SELF} from 'cloudflare:test';
import {describe,it,expect} from 'vitest';
import {BASE,grant,mintToken,uid} from './client';
import {newDrawing} from '../../../src/drawing/operations';
import {DrawingTransport} from '../../../src/drawing/transport';
import type {DrawingReplica} from '../../../src/drawing/replica';
import type {DrawingWireState,DrawingWireVersion} from '../../../src/drawing/wire';
describe('publication protocol negotiation',()=>{
 it('keeps outgoing publications local on legacy service and refuses unsupported or corrupt incoming checkpoints before storage',async()=>{
  const ws=uid('ws'),page=uid('library'),alice=uid('alice'),bob=uid('bob'),initial=newDrawing();await grant(alice,ws,page,'edit');await grant(bob,ws,page,'view');
  const scene=structuredClone(initial.scene);scene.libraryPublication={schema:1,itemId:page,version:1,name:'ألوان مشتركة',kind:'palette',tags:['ألوان'],sourceId:'source',payload:{colors:['#2266cc80']},createdAt:1};const version:DrawingWireVersion={scene,revision:1,label:'Publication',author:alice,createdAt:1},id=crypto.randomUUID();
  function client(user:string,versions:Record<string,DrawingWireVersion>){let legacy=true,corrupt=false,writes=0,checkpoints=0,reads=0;const replica:DrawingReplica={pageId:page,workspaceId:ws,userId:user,serverUrl:BASE,localActor:user,document:structuredClone(initial),basis:structuredClone(initial),remote:null,pending:[],versions,attachmentIds:[],level:user===alice?'edit':'view',status:'pending',error:null};
   const transport=new DrawingTransport({pageId:page,workspaceId:ws,userId:user,serverUrl:BASE,getToken:()=>mintToken(user),io:{snapshot:async()=>structuredClone(replica),status:async(status,error)=>{replica.status=status;replica.error=error??null;},readOriginal:async()=>{reads++;return null;},storeOriginal:async()=>{reads++;},checkpoint:async(state)=>{checkpoints++;replica.remote=structuredClone(state);replica.document=structuredClone(state.document!);replica.versions={...replica.versions,...state.versions};return{status:'accepted',document:replica.document};}},fetcher:async(input,init)=>{if(init?.method==='PUT'||String(input).endsWith('/operations'))writes++;const response=await SELF.fetch(input,init);if(!String(input).includes('/drawing/state'))return response;const value=await response.json<{capabilities?:{pixelSourceGuards?:number;libraryPublications?:number};state?:DrawingWireState}>();if(legacy&&value.capabilities)delete value.capabilities.libraryPublications;if(corrupt&&value.state)for(const v of Object.values(value.state.versions))if(v.scene.libraryPublication)v.scene.libraryPublication.itemId='another-page';return new Response(JSON.stringify(value),{status:response.status,headers:response.headers});}});
   return{replica,transport,modern:()=>{legacy=false;},corrupt:(value:boolean)=>{corrupt=value;},counts:()=>({writes,checkpoints,reads})};
  }
  const sender=client(alice,{[id]:version});try{await sender.transport.tick();expect(sender.counts().writes).toBe(0);expect(sender.replica.status).toBe('offline');expect(sender.replica.versions[id]).toEqual(version);sender.modern();await sender.transport.tick();expect(sender.replica.status).toBe('synced');expect(sender.counts().writes).toBeGreaterThan(0);
   const receiver=client(bob,{});try{await receiver.transport.tick();expect(receiver.replica.status).toBe('offline');expect(receiver.counts().checkpoints).toBe(0);expect(receiver.counts().reads).toBe(0);expect(receiver.replica.remote).toBeNull();receiver.modern();receiver.corrupt(true);await receiver.transport.tick();expect(receiver.replica.status).toBe('conflict');expect(receiver.counts().checkpoints).toBe(0);expect(receiver.counts().reads).toBe(0);expect(receiver.replica.versions).toEqual({});
    receiver.corrupt(false);receiver.replica.status='pending';await receiver.transport.tick();expect(receiver.replica.status).toBe('synced');expect(receiver.replica.versions[id].scene.libraryPublication).toEqual(scene.libraryPublication);
   }finally{receiver.transport.stop();}
  }finally{sender.transport.stop();}
 });
});
