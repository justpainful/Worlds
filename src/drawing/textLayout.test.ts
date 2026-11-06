import {expect,it} from "vitest";
import {textDirection,textLines} from "./textLayout";
import {nodeMatrix,identity} from "./affine";
import {newDrawing} from "./operations";
import {newNode} from "./model";
it("uses the first strong letter for bilingual text rather than any later Arabic character",()=>{expect(textDirection("123 Hello مرحبا","auto")).toBe("ltr");expect(textDirection("123 مرحبا Hello","auto")).toBe("rtl");expect(textDirection("123","auto")).toBe("ltr");expect(textDirection("عربي","ltr")).toBe("ltr");});
it("wraps oversized words at complete graphemes while preserving source paragraphs",()=>{const text="بِسْمِالعربية👨‍👩‍👧‍👦",lines=textLines(text,3,s=>[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(s)].length);expect(lines.join('')).toBe(text);expect(lines.every(s=>[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(s)].length<=3)).toBe(true);expect(textLines("first line\nsecond",20,s=>s.length)).toEqual(["first line","second"]);});
it("text wrap keeps font coordinates while scale mode retains original geometric scaling",()=>{const s=newDrawing().scene,n=newNode('text',s.layerOrder[0],s.defaultFrameId,{x:0,y:0,w:200,h:100});n.geometrySize={w:100,h:50};n.textStyle.resizeMode='wrap';expect(nodeMatrix(identity(),n).a).toBe(1);n.textStyle.resizeMode='scale';expect(nodeMatrix(identity(),n).a).toBe(2);delete n.textStyle.resizeMode;expect(nodeMatrix(identity(),n).a).toBe(2);});
