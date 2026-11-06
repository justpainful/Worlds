import {useEffect,useRef,useState} from 'react';
import type {Change,DrawingScene} from './model';
import {DrawingRenderer} from './renderer';
import {effectiveLayer,isolateLayerScene,layerAncestors,layerTree} from './layers';
import {exportPreparationScene} from './exportScope';
import {IconButton} from '../ui/Button';
import './layerBrowser.css';
let queue:Promise<void>=Promise.resolve();
function LayerThumbnail({scene,layerId,frameId,label,loadingLabel}:{scene:DrawingScene;layerId:string;frameId:string;label:string;loadingLabel:string}){
 const ref=useRef<HTMLCanvasElement>(null),[visible,setVisible]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState<'loading'|'ready'|'error'>('loading');
 useEffect(()=>{const canvas=ref.current;if(!canvas)return;const observer=new IntersectionObserver(entries=>setVisible(entries.some(e=>e.isIntersecting)),{rootMargin:'80px'});observer.observe(canvas);return()=>observer.disconnect();},[]);
 useEffect(()=>{const canvas=ref.current;if(!visible||!canvas)return;const controller=new AbortController();let renderer:DrawingRenderer|undefined;setError('');setStatus('loading');
  queue=queue.catch(()=>{}).then(async()=>{if(controller.signal.aborted)return;renderer=new DrawingRenderer();const frame=scene.frames[frameId]??scene.frames[scene.defaultFrameId],sample=isolateLayerScene(scene,layerId);try{await renderer.prepare(exportPreparationScene(sample,frame.id,frame,true));if(controller.signal.aborted)return;const w=96,h=64,scale=Math.min(w/frame.w,h/frame.h)*.9;canvas.width=w;canvas.height=h;renderer.render(canvas,sample,{x:frame.x-(w/scale-frame.w)/2,y:frame.y-(h/scale-frame.h)/2,w:w/scale,h:h/scale,scale},{frameId:frame.id,background:false});if(import.meta.env.DEV){const pixels=canvas.getContext('2d')!.getImageData(0,0,w,h).data;let covered=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i])covered++;canvas.dataset.coveredPixels=String(covered);}setStatus('ready');}catch(e){if(!controller.signal.aborted){setError(e instanceof Error?e.message:String(e));setStatus('error');}}finally{renderer.dispose();renderer=undefined;}});
  return()=>{controller.abort();renderer?.dispose();};
 },[scene,layerId,frameId,visible]);
 return <span className="drawing-layer-thumb" title={error||(status==='loading'?loadingLabel:label)} aria-busy={status==='loading'} data-state={status}><canvas ref={ref} width={96} height={64} role="img" aria-label={label}/>{status==='loading'&&<span role="status" aria-label={loadingLabel}>…</span>}{error&&<span role="status" aria-label={error}>!</span>}</span>;
}
export function LayerBrowser({scene,currentId,frameId,solo,arabic,editable,onSelect,onSolo,onChange}:{scene:DrawingScene;currentId:string;frameId:string;solo:string|null;arabic:boolean;editable:boolean;onSelect:(id:string)=>void;onSolo:(id:string|null)=>void;onChange:(label:string,changes:Change[])=>void}){
 const [query,setQuery]=useState(''),[collapsed,setCollapsed]=useState<Set<string>>(()=>new Set()),t=(en:string,ar:string)=>arabic?ar:en,needle=query.trim().toLocaleLowerCase(),tree=layerTree(scene);
 const order:string[]=[],pending=[...tree.get(null)??[]];while(pending.length){const id=pending.pop()!;order.push(id);pending.push(...tree.get(id)??[]);}const content=new Map<string,string[]>();for(const id of scene.nodeOrder){const n=scene.nodes[id],values=content.get(n.layerId)??[];values.push(n.name,n.text??"");content.set(n.layerId,values);}const matches=order.filter(id=>!needle||[scene.layers[id].name,...content.get(id)??[]].join(' ').toLocaleLowerCase().includes(needle));
 const shown=needle?new Set(matches.flatMap(id=>layerAncestors(scene,id).map(l=>l.id))):null;
 return <section className="drawing-layer-browser" aria-label={t('Layer browser','متصفح الطبقات')}><label className="drawing-field"><span>{t('Find layers or content','بحث في الطبقات والمحتوى')}</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></label>
 {solo&&<p role="status">{t('Solo view. Sampling uses the current layer.','عرض معزول. يؤخذ اللون والبكسلات من الطبقة الحالية.')}<button className="drawing-layer-solo" onClick={()=>onSolo(null)}>{t('Show all','إظهار الكل')}</button></p>}
 {!matches.length&&<p role="status">{t('No matching layers','لا توجد طبقات مطابقة')}</p>}
 {order.filter(id=>shown?shown.has(id):!layerAncestors(scene,id).slice(1).some(parent=>collapsed.has(parent.id))).map(id=>{const layer=scene.layers[id],state=effectiveLayer(scene,id),children=tree.get(id)?.length;return <div className={`drawing-layer ${id===currentId?'selected':''}`} key={id} style={{paddingInlineStart:5+Math.min(8,state.depth)*10}}>
  {!!children&&<button className="drawing-layer-solo" aria-expanded={!collapsed.has(id)} aria-label={collapsed.has(id)?t(`Expand group ${layer.name}`,`فتح مجموعة ${layer.name}`):t(`Collapse group ${layer.name}`,`طي مجموعة ${layer.name}`)} onClick={()=>setCollapsed(old=>{const next=new Set(old);next.has(id)?next.delete(id):next.add(id);return next;})}>{collapsed.has(id)?'▸':'▾'}</button>}
  <button className="drawing-layer-select" aria-label={t(`Select layer ${layer.name}`,`اختيار طبقة ${layer.name}`)} onClick={()=>onSelect(id)}><LayerThumbnail scene={scene} layerId={id} frameId={frameId} label={t(`Preview ${layer.name}`,`معاينة ${layer.name}`)} loadingLabel={t(`Loading preview ${layer.name}`,`تحميل معاينة ${layer.name}`)}/><span>{layer.name}</span></button>
  <button className="drawing-layer-solo" aria-pressed={solo===id} onClick={()=>{onSelect(id);onSolo(solo===id?null:id);}}>{t('Solo','عزل')}</button>
  <IconButton icon="preview" label={t(`Visibility ${layer.name}`,`إظهار الطبقة ${layer.name}`)} disabled={!editable} active={layer.visible} onClick={()=>onChange('Layer visibility',[{type:'patch',collection:'layers',id,fields:{visible:!layer.visible}}])}/>
  <IconButton icon="lock" label={t(`Lock ${layer.name}`,`قفل ${layer.name}`)} disabled={!editable} active={layer.locked} onClick={()=>onChange('Layer lock',[{type:'patch',collection:'layers',id,fields:{locked:!layer.locked}}])}/>
 </div>;})}</section>;
}
