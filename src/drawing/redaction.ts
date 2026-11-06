import type {DrawingNode,DrawingScene,Rect} from './model';
import {layerAncestors} from './layers';
export function isRedaction(node:DrawingNode):node is DrawingNode&{redaction:true}{return(node as DrawingNode&{redaction?:boolean}).redaction===true;}
export function redactionShown(scene:DrawingScene,node:DrawingNode){const layers=layerAncestors(scene,node.layerId);return isRedaction(node)&&node.visible&&layers.length>0&&layers.every(l=>l.visible);}
export function redactionBounds(node:DrawingNode):Rect{const x=Math.floor(node.x),y=Math.floor(node.y);return{x,y,w:Math.ceil(node.x+node.w)-x,h:Math.ceil(node.y+node.h)-y};}
