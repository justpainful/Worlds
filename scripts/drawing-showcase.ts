// Isolated, explicit browser mock. No personal files or owner database access.
import '../src/dev/mockTauri';
import {api} from '../src/lib/api';
import {useStore} from '../src/state/store';
import {newLayer,newNode,DEFAULT_BRUSH} from '../src/drawing/model';
import {edit,sceneChanges} from '../src/drawing/operations';

if(!location.search.includes('mock'))throw new Error('This review fixture requires ?mock');
const profile=await api.updateProfile({language:'ar'});
const page=await api.createPage({kind:'drawing',title:'مختبر الرسم · Worlds',icon:'pi:paintbrush'});
const sourceDocument=await api.drawingLoad(page.id),scene=structuredClone(sourceDocument.scene),frame=scene.frames[scene.defaultFrameId];
Object.assign(frame,{name:'لوحة الأفكار',w:1100,h:740,background:'#faf8f2'});
const base=scene.layers[scene.layerOrder[0]];base.name='الأشكال والتخطيط';
const inks=newLayer('الفرش والألوان'),notes=newLayer('الشرح والملاحظات');
for(const l of[inks,notes]){scene.layers[l.id]=l;scene.layerOrder.push(l.id);}
const add=(n:ReturnType<typeof newNode>)=>{scene.nodes[n.id]=n;scene.nodeOrder.push(n.id);return n;};
const title=add(newNode('text',notes.id,frame.id,{x:62,y:42,w:970,h:90}));title.name='عنوان اللوحة';title.text='مساحة لكل فكرة';Object.assign(title.textStyle,{size:48,weight:600,color:'#243b36',direction:'rtl',align:'end'});
const caption=add(newNode('text',notes.id,frame.id,{x:65,y:118,w:970,h:60}));caption.text='ارسم، جرّب، وشارك خطواتك';Object.assign(caption.textStyle,{size:23,color:'#69736b',direction:'rtl',align:'end'});
const ellipse=add(newNode('shape',base.id,frame.id,{x:70,y:220,w:250,h:220}));ellipse.name='دائرة لونية';ellipse.shape='ellipse';ellipse.paint.fill='#e6a555';ellipse.paint.strokeWidth=0;
const triangle=add(newNode('shape',base.id,frame.id,{x:390,y:220,w:250,h:220}));triangle.name='مثلث مضبوط';triangle.shape='right-triangle';triangle.paint.fill='#6f9e87';triangle.paint.stroke='#315d49';triangle.paint.strokeWidth=3;
const rect=add(newNode('shape',base.id,frame.id,{x:715,y:220,w:280,h:220}));rect.name='مساحة متدرجة';rect.shape='roundrect';rect.paint.radius=24;rect.paint.fill='#cc6953';rect.paint.strokeWidth=0;
for(const [i,kind]of ['ink','oil','crayon','watercolor','highlighter'].entries()){const n=add(newNode('stroke',inks.id,frame.id,{x:85,y:500+i*31,w:430,h:40}));n.name=`عينة ${kind}`;n.brush={...DEFAULT_BRUSH,kind:kind as typeof DEFAULT_BRUSH.kind,color:['#315d49','#ce6f53','#e4ad45','#7b8fbc','#f1d15b'][i],size:i===4?24:12,opacity:i===4?.45:1};n.samples=Array.from({length:48},(_,j)=>({x:j*8,y:16+Math.sin(j/7)*10,pressure:.65,tiltX:0,tiltY:0,time:j*5}));n.seed=12+i;}
const label=add(newNode('text',notes.id,frame.id,{x:650,y:520,w:350,h:130}));label.name='شرح الأدوات';label.text='فرش متعددة\nطبقات قابلة للتحرير\nتجارب وخطوات محفوظة';Object.assign(label.textStyle,{size:25,color:'#315d49',direction:'rtl',align:'end',leading:1.6});
if(new URLSearchParams(location.search).has('image')){
 const canvas=document.createElement('canvas');canvas.width=480;canvas.height=360;const ctx=canvas.getContext('2d')!,g=ctx.createLinearGradient(0,0,480,360);g.addColorStop(0,'#436d7b');g.addColorStop(.5,'#a4ba86');g.addColorStop(1,'#f1cd84');ctx.fillStyle=g;ctx.fillRect(0,0,480,360);ctx.fillStyle='#ffffff88';for(let i=0;i<8;i++)ctx.fillRect(36+i*52,45,18,270);const png=await new Promise<Blob>(resolve=>canvas.toBlob(blob=>resolve(blob!),'image/png')),bytes=new Uint8Array(await png.arrayBuffer()),owned=await api.importBytes(page.id,'color-study.png',bytes),assetId=crypto.randomUUID(),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');scene.assets[assetId]={id:assetId,attachmentId:owned.id,name:'دراسة الألوان',mime:'image/png',width:480,height:360,size:bytes.length,sha256};const image=add(newNode('image',inks.id,frame.id,{x:330,y:160,w:440,h:420}));image.name='الصورة الأصلية';image.assetId=assetId;
}
const stepId=crypto.randomUUID();scene.steps[stepId]={id:stepId,title:'الفكرة الأولى',body:'جولة في الأشكال والفرش والألوان',frameId:frame.id,camera:{x:0,y:0,w:1100,h:740},hiddenNodeIds:[],transition:'fade',duration:4};scene.stepOrder.push(stepId);
await api.drawingApply(page.id,edit(profile.id,sourceDocument.revision,'Review fixture',sceneChanges(sourceDocument.scene,scene)));
await api.drawingVersionSave(page.id,'نسخة المراجعة');
const branch=await api.drawingExperimentCreate(page.id,'تجربة الألوان','بديل مستقل مع أصل المقارنة');const alternative=await api.drawingLoad(branch.id);await api.drawingApply(branch.id,edit(profile.id,alternative.revision,'Alternative paper',[{type:'patch',collection:'frames',id:frame.id,fields:{background:'#eef4f1'}}]));
await api.setSetting('account.onboarded',true);
await useStore.getState().init();useStore.getState().openPage(page.id);await api.setSetting('session',{layout:useStore.getState().layout,sidebar:useStore.getState().sidebar});
await import('../src/main');
