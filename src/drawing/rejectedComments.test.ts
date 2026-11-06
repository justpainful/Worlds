import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createThread, reply } from "../sync/comments";
import { newDrawing } from "./operations";
import { drawingCommentAnchor } from "./commentAnchors";
import { rejectedComments, rejectedCommentsText } from "./rejectedComments";
describe("refused comment recovery",()=>{
  it("reads full causal snapshots and exports only the current owner's visible text without modifying the source",()=>{
    const doc=new Y.Doc(),scene=newDrawing().scene,anchor=drawingCommentAnchor(scene,scene.defaultFrameId),alice={id:"alice",name:"Alice",color:"#123456"},bob={id:"bob",name:"Bob",color:"#654321"};
    const own=createThread(doc,alice,{anchor,body:"نصي المحفوظ",quote:"",mentions:[]});const other=createThread(doc,bob,{anchor,body:"Private other text",quote:"",mentions:[]});reply(doc,alice,other,"ردي",[]);
    const bytes=Y.encodeStateAsUpdate(doc),rows=rejectedComments(bytes,"alice");expect(rows.map((r)=>r.body)).toEqual(["نصي المحفوظ","ردي"]);expect(rows[0].threadId).toBe(own);
    expect(rejectedCommentsText(rows,true)).toContain("نصي المحفوظ");expect(rejectedCommentsText(rows,true)).not.toContain("Private other text");expect(Y.encodeStateAsUpdate(doc)).toEqual(bytes);expect(rejectedComments(bytes,"unknown")).toHaveLength(0);doc.destroy();
  });
});
