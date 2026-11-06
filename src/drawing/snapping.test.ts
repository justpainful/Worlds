import {expect,it} from "vitest";
import {snapMove,snapPoint} from "./snapping";
import {newDrawing} from "./operations";
import {newNode} from "./model";
it("snaps local frame grids/guides within a fixed screen tolerance and Alt bypasses it",()=>{const s=newDrawing().scene,f=s.frames[s.defaultFrameId];f.x=100;f.y=200;f.grid={visible:true,size:20,snap:true};f.guides=[{id:'g',axis:'x',at:53}];expect(snapPoint(f,{x:151,y:219},1)).toEqual({x:153,y:220});expect(snapPoint(f,{x:151,y:219},1,true)).toEqual({x:151,y:219});expect(snapPoint(f,{x:151,y:219},10)).toEqual({x:151,y:219});});
it("aligns moving object centers/edges without changing original geometry",()=>{const s=newDrawing().scene,f=s.frames[s.defaultFrameId];f.grid={visible:false,size:100,snap:true};const a=newNode('shape',s.layerOrder[0],f.id,{x:20,y:20,w:40,h:40}),b=newNode('shape',s.layerOrder[0],f.id,{x:150,y:150,w:40,h:40});a.paint.strokeWidth=b.paint.strokeWidth=0;s.nodes[a.id]=a;s.nodes[b.id]=b;s.nodeOrder=[a.id,b.id];const before=structuredClone(a);expect(snapMove(s,f,[a],{x:88,y:88},1)).toEqual({x:90,y:90});expect(a).toEqual(before);});
