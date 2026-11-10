// Isolated browser-only screenshots. Every page, image and comment is synthetic.
if (!import.meta.env.DEV || !new URLSearchParams(location.search).has('mock') || !new URLSearchParams(location.search).has('demo')) throw Error('Demo requires the isolated mock');
import React from 'react';
import {createRoot} from 'react-dom/client';
import * as Y from 'yjs';
import {useStore} from '../src/state/store';
import {api} from '../src/lib/api';
import {localStore} from '../src/sync/session';
import {syncConfig} from '../src/sync/config';
import {createThread,upsertPerson,listThreads} from '../src/sync/comments';
import {drawingCommentAnchor} from '../src/drawing/commentAnchors';
import {DrawingCommentsPanel} from '../src/drawing/CommentsPanel';
import {DrawingRejectedCommentsDialog} from '../src/drawing/RejectedCommentsDialog';
import {FloatingPixelsDialog} from '../src/drawing/FloatingPixelsDialog';
import {DrawingPackageImportDialog} from '../src/drawing/PackageImportDialog';
import {ReferenceLayoutDialog} from '../src/drawing/ReferenceLayoutDialog';
import {imagePixelArtwork} from '../src/drawing/floatingPixels';
import {createDrawingPackage} from '../src/drawing/package';
import {newNode,id} from '../src/drawing/model';
import {drawingSession} from '../src/drawing/session';
await import('./drawing-showcase');
await new Promise(r=>setTimeout(r,2500));
const mode=new URLSearchParams(location.search).get('special')||'comments';
const page=Object.values(useStore.getState().pages).find(p=>p.title==='مختبر الرسم · Worlds');if(!page)throw Error('demo drawing missing');
const doc=await api.drawingLoad(page.id),scene=doc.scene,frame=scene.frames[scene.defaultFrameId],layer=scene.layers[scene.layerOrder[0]],user=syncConfig().user();
const ydoc=new Y.Doc(),other={id:'demo-member',name:'ليان',color:'#b37c4d'};
upsertPerson(ydoc,user);upsertPerson(ydoc,other);
const anchor=drawingCommentAnchor(scene,frame.id,null,{x:400,y:190,w:300,h:220});
createThread(ydoc,other,{anchor,quote:'',body:'هل نجرب درجة أفتح لهذا الشكل؟',mentions:[]});
createThread(ydoc,user,{anchor,quote:'',body:'فكرة جميلة، سأضيف نسخة ثانية للمقارنة.',mentions:[]});
const liveState={ready:true,info:{state:'synced',level:'full',unacked:0},threads:listThreads(ydoc),peers:[],following:null,error:null};
const live={comments:ydoc,canComment:true,subscribe:()=>()=>{},snapshot:()=>liveState,thread:()=>'',reply:()=>{},remove:()=>{},resolve:()=>{},persisted:async()=>{}} as any;
const host=document.createElement('div');host.id='drawing-special-demo-host';document.body.appendChild(host);
if(mode==='comments'){
 const tabs=[...document.querySelectorAll('button')];tabs.find(b=>b.textContent?.trim()==='التعليقات')?.click();await new Promise(r=>setTimeout(r,500));
 const aside=document.querySelector<HTMLElement>('.drawing-inspector');if(!aside)throw Error('inspector unavailable');
 for(const child of [...aside.children])if(!child.classList.contains('drawing-tabs'))(child as HTMLElement).style.display='none';
 host.remove();const box=document.createElement('div');aside.appendChild(box);const badge=document.createElement('p');badge.textContent='بيانات توضيحية · Demo';badge.style.color='#aeaeb2';box.appendChild(badge);const root=document.createElement('div');box.appendChild(root);
 createRoot(root).render(<DrawingCommentsPanel pageId={page.id} canReview session={live} scene={scene} frameId={frame.id} selected={[]} arabic onGo={()=>{}} onRetry={()=>{}}/>);
} else if(mode==='rejected'){
 await localStore().archiveRejection(page.id,1,'demo-archive',user.id,Y.encodeStateAsUpdate(ydoc),new Uint8Array(),'بيانات توضيحية: انتهت صلاحية التعديل قبل المزامنة');
 createRoot(host).render(<DrawingRejectedCommentsDialog pageId={page.id} session={live} scene={scene} arabic canReview onClose={()=>{}}/>);
} else if(mode==='floating'){
 const art=imagePixelArtwork(frame,520,320,'image/png','صورة تجريبية');const cv=document.createElement('canvas');cv.width=520;cv.height=320;const ctx=cv.getContext('2d')!;ctx.fillStyle='#e2bc86';ctx.fillRect(0,0,520,320);ctx.fillStyle='#456b5a';ctx.fillRect(70,60,380,200);ctx.fillStyle='#fff';ctx.font='32px sans-serif';ctx.fillText('DEMO IMAGE',145,175);const image=new Image();image.src=cv.toDataURL();await image.decode();const blob=await new Promise<Blob>(r=>cv.toBlob(b=>r(b!), 'image/png'));
 const draft={kind:'image',action:'import',convertedFromSvg:false,scene,frame,region:{x:art.node.x,y:art.node.y,w:art.node.w,h:art.node.h},fileName:'demo-image.png',blob,art,images:new Map([[art.asset.attachmentId,image]]),lease:null,dispose:()=>{},signal:new AbortController().signal} as any;
 createRoot(host).render(<FloatingPixelsDialog draft={draft} arabic canEdit busy={false} saving={false} error={null} leaseState={null} onApply={()=>{}} onCancel={()=>{}} onFrame={()=>{}}/>);
} else if(mode==='package'){
 const blob=await createDrawingPackage(scene);const file=new File([blob],'demo-project.worldsdraw',{type:'application/octet-stream'});
 createRoot(host).render(<DrawingPackageImportDialog file={file} pageId={page.id} arabic canEdit revision={()=>doc.revision} apply={async()=>[]} onClose={()=>{}}/>);
} else if(mode==='reference'){
 const source=Object.values(useStore.getState().pages).find(p=>p.title==='Demo · Launch brief');if(!source)throw Error('demo reference missing');
 const data=await api.drawingReferenceRead(source.id);const node=newNode('reference',layer.id,frame.id,{x:200,y:180,w:400,h:220});node.sourceId=source.id;node.sourceMode='live';node.name='بطاقة خطة الإطلاق';scene.nodes[node.id]=node;scene.nodeOrder.push(node.id);
 createRoot(host).render(<ReferenceLayoutDialog session={drawingSession(page.id)} scene={scene} node={node} data={data} canEdit arabic commit={()=>null} onClose={()=>{}}/>);
}
