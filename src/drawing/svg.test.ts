import {describe,it,expect} from 'vitest';
import {svgText,looksLikeSvg,flattenedSvg,MAX_SVG_BYTES} from './svg';
import fixtures from './fixtures/image-headers.json';
const bytes=(text:string)=>new TextEncoder().encode(text);
describe('static SVG input and flattened output',()=>{
 it('rejects active XML declarations, invalid UTF-8 and oversized input before parsing',()=>{
  for(const value of ['<!DOCTYPE svg SYSTEM "https://example.test/private">','<!ENTITY x SYSTEM "file:///private">','<?xml-stylesheet href="https://example.test/a.css"?>','<svg>\u0000</svg>'])expect(()=>svgText(bytes(value))).toThrow();
  expect(()=>svgText(new Uint8Array([0xff,0xfe,0]))).toThrow();expect(()=>svgText({length:MAX_SVG_BYTES+1}as Uint8Array)).toThrow();
  expect(looksLikeSvg(bytes('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'),'')).toBe(true);expect(looksLikeSvg(bytes('<html><svg/>'),'text/html')).toBe(false);
 });
 it('wraps only bounded PNG bytes in a self-contained SVG with their actual dimensions',async()=>{
  const f=fixtures.images.find(f=>f.name==='png')!,data=Uint8Array.from(atob(f.base64),c=>c.charCodeAt(0)),blob=await flattenedSvg(new Blob([data],{type:'image/png'})),xml=await blob.text();
  expect(blob.type).toBe('image/svg+xml');expect(xml).toContain(`width="${f.width}" height="${f.height}"`);expect(xml).toContain(`href="data:image/png;base64,${f.base64}"`);expect(xml).not.toMatch(/script|foreignObject|style=|https:\/\//);await expect(flattenedSvg(new Blob([data],{type:'image/jpeg'}))).rejects.toThrow();
 });
 it('cancels output before reading source bytes',async()=>{
  const c=new AbortController();c.abort();await expect(flattenedSvg(new Blob([],{type:'image/png'}),c.signal)).rejects.toMatchObject({name:'AbortError'});
 });
});
