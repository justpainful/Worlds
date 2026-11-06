import {useState} from 'react';
import {Modal} from '../ui/Modal';
import {Button} from '../ui/Button';
import {DRAWING_SHORTCUTS,defaultDrawingShortcuts,readDrawingShortcuts,saveDrawingShortcuts,shortcutFromKey,shortcutIssues,type DrawingShortcutMap} from './shortcuts';
import './shortcuts.css';
/** Uses the locked drawing design: neutral utility rows, inherited type and one save action. */
export function DrawingShortcutsDialog({owner,arabic,onClose,onApply}:{owner:string;arabic:boolean;onClose:()=>void;onApply:(map:DrawingShortcutMap)=>void}){
 const t=(en:string,ar:string)=>arabic?ar:en,[draft,setDraft]=useState(()=>readDrawingShortcuts(owner)),[storageError,setStorageError]=useState(false),issues=shortcutIssues(draft);
 const label=(id:string)=>{const row=DRAWING_SHORTCUTS.find(([key])=>key===id)!;return row[arabic?3:2];};
 return <Modal title={t('Drawing shortcuts','اختصارات الرسم')} width={640} onClose={onClose} footer={<><Button onClick={()=>{setDraft(defaultDrawingShortcuts());setStorageError(false);}}>{t('Restore defaults','استعادة الافتراضي')}</Button><Button onClick={onClose}>{t('Cancel','إلغاء')}</Button><Button variant="tinted" disabled={issues.length>0} onClick={()=>{if(!saveDrawingShortcuts(owner,draft)){setStorageError(true);return;}onApply(draft);onClose();}}>{t('Save shortcuts','حفظ الاختصارات')}</Button></>}>
  <div className="drawing-shortcuts" dir={arabic?'rtl':'ltr'}>
   <p>{t('Focus a shortcut field and press the new keys. Delete its binding with Disable. Changes apply only to your drawing editor.','حدد خانة الاختصار واضغط المفاتيح الجديدة. استخدم تعطيل لإلغاء اختصار. تنطبق التغييرات على محرر الرسم في حسابك فقط.')}</p>
   <div className="drawing-shortcut-fixed">{t('Hold Space to pan. Escape cancels a gesture. These keys stay available.','اضغط المسافة للتحريك. Escape يلغي الإجراء الجاري. يبقى هذان المفتاحان متاحين.')}</div>
   {DRAWING_SHORTCUTS.map(([action])=>{const issue=issues.find(v=>v.action===action);return <div className="drawing-shortcut-row" key={action}>
    <label><span>{label(action)}</span><input dir="ltr" readOnly value={draft[action]??t('Disabled','معطل')} aria-label={label(action)} aria-invalid={!!issue} onKeyDown={e=>{e.stopPropagation();if(e.key==='Tab'||e.key==='Escape')return;e.preventDefault();if(['Control','Meta','Alt','Shift'].includes(e.key))return;const value=shortcutFromKey(e.nativeEvent)??(e.code==='Space'?'Space':e.key);setDraft(old=>({...old,[action]:value}));setStorageError(false);}}/></label>
    <Button size="compact" disabled={draft[action]===null} onClick={()=>setDraft(old=>({...old,[action]:null}))}>{t('Disable','تعطيل')}</Button>
    {issue&&<p role="alert">{issue.kind==='duplicate'?t(`Already used by ${label(issue.other!)}`,`مستخدم في ${label(issue.other!)}`):issue.kind==='reserved'?t('Reserved by the system or Worlds','محجوز للنظام أو وورلدز'):t('Unsupported key combination','مجموعة مفاتيح غير مدعومة')}</p>}
   </div>;})}
   {storageError&&<p role="alert">{t('The shortcuts could not be saved on this device. Try again.','تعذر حفظ الاختصارات على هذا الجهاز. حاول مجددًا.')}</p>}
  </div>
 </Modal>;
}
