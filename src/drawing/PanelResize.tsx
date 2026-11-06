import {useRef} from 'react';
export function PanelResize({width,onChange,arabic}:{width:number;onChange:(value:number)=>void;arabic:boolean}){
 const gesture=useRef<{x:number;width:number;pointer:number}|null>(null),clamp=(v:number)=>Math.max(240,Math.min(420,v));
 return <div className="drawing-panel-resize" role="separator" aria-orientation="vertical" aria-label={arabic?'عرض لوحة الخصائص':'Inspector width'} aria-valuemin={240} aria-valuemax={420} aria-valuenow={Math.round(width)} tabIndex={0}
 onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();gesture.current={x:e.clientX,width,pointer:e.pointerId};e.currentTarget.setPointerCapture(e.pointerId);}}
 onPointerMove={e=>{const g=gesture.current;if(g&&g.pointer===e.pointerId)onChange(clamp(g.width+(e.clientX-g.x)*(arabic?1:-1)));}}
 onPointerUp={e=>{if(gesture.current?.pointer===e.pointerId){gesture.current=null;e.currentTarget.releasePointerCapture(e.pointerId);}}}
 onLostPointerCapture={()=>{gesture.current=null;}} onPointerCancel={()=>{gesture.current=null;}}
 onKeyDown={e=>{if(e.key==='Escape'&&gesture.current){onChange(gesture.current.width);gesture.current=null;e.preventDefault();return;}const step=e.shiftKey?40:10,next=e.key==='Home'?240:e.key==='End'?420:e.key==='ArrowRight'?width+(arabic?step:-step):e.key==='ArrowLeft'?width+(arabic?-step:step):null;if(next!==null){e.preventDefault();e.stopPropagation();onChange(clamp(next));}}}/>;
}
