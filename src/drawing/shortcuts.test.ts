import {afterEach,describe,it,expect,vi} from 'vitest';
import {canonicalShortcut,defaultDrawingShortcuts,drawingShortcutAction,normalizeShortcut,readDrawingShortcuts,saveDrawingShortcuts,shortcutFromKey,shortcutIssues,type DrawingShortcutKey} from './shortcuts';
const event=(key:string,more:Partial<DrawingShortcutKey>={}):DrawingShortcutKey=>({key,code:'',ctrlKey:false,metaKey:false,shiftKey:false,altKey:false,...more});
afterEach(()=>vi.unstubAllGlobals());
describe('drawing shortcut preferences and routing',()=>{
 it('stores owner-scoped mappings, disabled commands and restores defaults without accepting corrupt collisions',()=>{
  const data=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)});
  const a=defaultDrawingShortcuts();a.brush='F8';a.eraser=null;expect(saveDrawingShortcuts('a',a)).toBe(true);expect(readDrawingShortcuts('a')).toEqual(a);expect(readDrawingShortcuts('b')).toEqual(defaultDrawingShortcuts());
  a.fill='F8';expect(saveDrawingShortcuts('a',a)).toBe(false);expect(readDrawingShortcuts('a').fill).toBe('g');data.set('worlds.drawing.shortcuts.a',JSON.stringify(a));expect(readDrawingShortcuts('a')).toEqual(defaultDrawingShortcuts());
 });
 it('reports duplicates and reserved shell combinations and rejects malformed modifier data',()=>{
  const m=defaultDrawingShortcuts();expect(shortcutIssues(m)).toEqual([]);m.brush='Mod+w';m.laser='v';expect(shortcutIssues(m)).toEqual(expect.arrayContaining([expect.objectContaining({action:'brush',kind:'reserved'}),expect.objectContaining({action:'laser',kind:'duplicate',other:'move'})]));
  expect(normalizeShortcut('Shift+Mod+Z')).toBe('Mod+Shift+z');expect(normalizeShortcut('Mod+Mod+b')).toBeNull();expect(normalizeShortcut('Escape')).toBeNull();expect(normalizeShortcut('F12')).toBeNull();
 });
 it('routes customized physical Latin keys on Arabic layouts, respects modifiers and leaves disabled defaults inactive',()=>{
  const m=defaultDrawingShortcuts();m.brush='F8';m.fill='Mod+Shift+g';m.eraser=null;
  expect(drawingShortcutAction(event('b'),m,{activePane:true})).toBeNull();expect(drawingShortcutAction(event('F8'),m,{activePane:true})).toBe('brush');expect(drawingShortcutAction(event('e'),m,{activePane:true})).toBeNull();
  expect(drawingShortcutAction(event('ل',{code:'KeyG',ctrlKey:true,shiftKey:true}),m,{activePane:true})).toBe('fill');expect(drawingShortcutAction(event('G',{code:'KeyG',ctrlKey:true}),m,{activePane:true})).toBeNull();
  expect(shortcutFromKey(event('ظ',{code:'BracketRight'}))).toBe(']');expect(canonicalShortcut('redo')).toMatchObject({key:'z',ctrlKey:true,shiftKey:true});
 });
 it('protects inactive panes, native composition, AltGr, input focus, modal content and already handled keys',()=>{
  const m=defaultDrawingShortcuts();for(const more of [{isComposing:true},{defaultPrevented:true},{getModifierState:()=>true},{target:{closest:()=>({})} as unknown as EventTarget}])expect(drawingShortcutAction(event('b',more),m,{activePane:true})).toBeNull();
  expect(drawingShortcutAction(event('b'),m,{activePane:false})).toBeNull();expect(drawingShortcutAction(event('b'),m,{activePane:true,modalOpen:true})).toBeNull();expect(drawingShortcutAction(event(' ',{code:'Space'}),m,{activePane:true})).toBeNull();
 });
 it('keeps Backspace and Mod+Y aliases only while their command retains its default',()=>{
  const m=defaultDrawingShortcuts();expect(drawingShortcutAction(event('Backspace'),m,{activePane:true})).toBe('delete');expect(drawingShortcutAction(event('y',{ctrlKey:true}),m,{activePane:true})).toBe('redo');m.redo='F8';m.delete=null;expect(drawingShortcutAction(event('Backspace'),m,{activePane:true})).toBeNull();expect(drawingShortcutAction(event('y',{ctrlKey:true}),m,{activePane:true})).toBeNull();
 });
 it('reports a failed storage write so the dialog cannot claim to have saved',()=>{vi.stubGlobal('localStorage',{setItem:()=>{throw Error('full');}});expect(saveDrawingShortcuts('a',defaultDrawingShortcuts())).toBe(false);});
});
