export const DRAWING_SHORTCUTS = [
  ['move','v','Move','تحريك'],['brush','b','Brush','فرشاة'],['eraser','e','Eraser','ممحاة'],['highlighter','h','Highlighter','تظليل'],['laser','k','Laser','ليزر'],
  ['redact','r','Opaque redaction','تنقيح معتم'],['shape','u','Shape','شكل'],['text','t','Text','نص'],['eyedropper','i','Eyedropper','قطّارة'],['fill','g','Fill','تعبئة'],['selection','m','Select area','تحديد مساحة'],['lasso','l','Freehand selection','تحديد حر'],
  ['undo','Mod+z','Undo','تراجع'],['redo','Mod+Shift+z','Redo','إعادة'],['selectAll','Mod+a','Select all','تحديد الكل'],['invert','Mod+Shift+i','Invert selection','عكس التحديد'],['copy','Mod+c','Copy','نسخ'],['cut','Mod+x','Cut','قص'],['paste','Mod+v','Paste','لصق'],['save','Mod+s','Save','حفظ'],['deselect','Mod+d','Clear selection','إلغاء التحديد'],['fit','Mod+0','Fit frame','احتواء الإطار'],['actualSize','Mod+1','Actual size','الحجم الفعلي'],['smaller','[','Smaller brush','تصغير الفرشاة'],['larger',']','Larger brush','تكبير الفرشاة'],['swap','x','Swap colors','تبديل اللونين'],['delete','Delete','Delete selection','حذف التحديد'],
] as const;
export type DrawingShortcutAction = typeof DRAWING_SHORTCUTS[number][0];
export type DrawingShortcutMap = Record<DrawingShortcutAction,string|null>;
export const defaultDrawingShortcuts = ():DrawingShortcutMap => Object.fromEntries(DRAWING_SHORTCUTS.map(([id,key])=>[id,key])) as DrawingShortcutMap;
const storageKey=(owner:string)=>`worlds.drawing.shortcuts.${owner}`;
const namedKeys=new Set(['Delete','Backspace','Home','End','PageUp','PageDown','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','F2','F3','F4','F6','F7','F8','F9','F10']);
export function normalizeShortcut(value:string):string|null{
 const parts=value.trim().split('+');if(!parts.length||parts.length>4||parts.some(v=>!v))return null;
 const key=parts.pop()!,modifiers=new Set(parts);if(modifiers.size!==parts.length||parts.some(v=>!['Mod','Shift','Alt'].includes(v)))return null;
 const normalized=key.length===1?/^[a-z0-9\[\]\\;,.'\/=\-`]$/i.test(key)?key.toLowerCase():null:namedKeys.has(key)?key:null;
 return normalized?[...(modifiers.has('Mod')?['Mod']:[]),...(modifiers.has('Alt')?['Alt']:[]),...(modifiers.has('Shift')?['Shift']:[]),normalized].join('+'):null;
}
export function reservedShortcut(binding:string):boolean{
 const key=binding.split('+').at(-1)!;
 if(['Space','Escape','Tab','Enter','F1','F5','F11','F12'].includes(key))return true;
 if(binding.includes('Alt+')&&['F4','ArrowLeft','ArrowRight','Home','End'].includes(key))return true;
 if(binding.includes('Mod+')&&binding.includes('Alt+'))return true;
 return /^Mod\+(Shift\+)?[qwntrlopfhujk,]$/.test(binding)||binding==='Mod+Shift+Delete';
}
export function shortcutIssues(map:DrawingShortcutMap):{action:DrawingShortcutAction;kind:'invalid'|'reserved'|'duplicate';other?:DrawingShortcutAction}[]{
 const seen=new Map<string,DrawingShortcutAction>(),issues:ReturnType<typeof shortcutIssues>=[];
 for(const [action]of DRAWING_SHORTCUTS){const value=map[action];if(value===null)continue;const normalized=typeof value==='string'?normalizeShortcut(value):null;if(!normalized||normalized!==value){issues.push({action,kind:'invalid'});continue;}if(reservedShortcut(value)){issues.push({action,kind:'reserved'});continue;}const other=seen.get(value);if(other)issues.push({action,kind:'duplicate',other});else seen.set(value,action);}
 return issues;
}
export function readDrawingShortcuts(owner:string):DrawingShortcutMap{
 const defaults=defaultDrawingShortcuts();try{const stored=JSON.parse(localStorage.getItem(storageKey(owner))??'null');if(!stored||typeof stored!=='object'||Array.isArray(stored))return defaults;
  const map={...defaults};for(const[action]of DRAWING_SHORTCUTS)if(Object.hasOwn(stored,action))map[action]=stored[action];return shortcutIssues(map).length?defaults:map;
 }catch{return defaults;}
}
export function saveDrawingShortcuts(owner:string,map:DrawingShortcutMap):boolean{if(shortcutIssues(map).length)return false;try{localStorage.setItem(storageKey(owner),JSON.stringify(Object.fromEntries(DRAWING_SHORTCUTS.map(([id])=>[id,map[id]]))));return true;}catch{return false;}}
export type DrawingShortcutKey = Pick<KeyboardEvent,'key'|'code'|'ctrlKey'|'metaKey'|'shiftKey'|'altKey'> & Partial<Pick<KeyboardEvent,'defaultPrevented'|'isComposing'|'target'|'getModifierState'>>;
export function shortcutFromKey(event:DrawingShortcutKey):string|null{
 if(event.isComposing||event.getModifierState?.('AltGraph'))return null;
 const code=event.code,key=/^Key[A-Z]$/.test(code)?code.slice(3).toLowerCase():/^Digit[0-9]$/.test(code)?code.slice(5):code==='BracketLeft'?'[':code==='BracketRight'?']':event.key;
 return normalizeShortcut([...(event.ctrlKey||event.metaKey?['Mod']:[]),...(event.altKey?['Alt']:[]),...(event.shiftKey?['Shift']:[]),key].join('+'));
}
export function drawingShortcutAction(event:DrawingShortcutKey,map:DrawingShortcutMap,context:{activePane:boolean;modalOpen?:boolean}):DrawingShortcutAction|null{
 if(!context.activePane||context.modalOpen||event.defaultPrevented||event.isComposing)return null;
 const target=event.target as {closest?:(selector:string)=>unknown}|null;
 if(target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="dialog"],[role="listbox"]'))return null;
 const binding=shortcutFromKey(event);if(!binding)return null;
 const direct=DRAWING_SHORTCUTS.find(([id])=>map[id]===binding)?.[0];if(direct)return direct;
 // Keep familiar aliases only while that command keeps its default binding.
 if(binding==='Backspace'&&map.delete==='Delete')return 'delete';
 if(binding==='Mod+y'&&map.redo==='Mod+Shift+z')return 'redo';return null;
}
/** Adapts custom commands to the existing editor handler without dispatching synthetic events. */
export function canonicalShortcut(action:DrawingShortcutAction):{key:string;ctrlKey:boolean;metaKey:boolean;shiftKey:boolean;altKey:boolean}{
 const binding=DRAWING_SHORTCUTS.find(([id])=>id===action)![1],parts=binding.split('+');return{key:parts.at(-1)!,ctrlKey:parts.includes('Mod'),metaKey:false,shiftKey:parts.includes('Shift'),altKey:false};
}
