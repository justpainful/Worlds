import { env, evictDurableObject, SELF } from "cloudflare:test";
import { describe,expect,it } from "vitest";
import { BASE,grant,mintToken,uid } from "./client";
import { newDrawing } from "../../../src/drawing/operations";
import { DEFAULT_EXPORT_RULES } from "../../../src/drawing/exportPolicy";
async function fixture(){
  const ws=uid("ws"),doc=uid("drawing"),full=uid("owner"),edit=uid("editor"),view=uid("viewer");for(const[user,level]of [[full,"full"],[edit,"edit"],[view,"view"]]as const)await grant(user,ws,doc,level);
  const call=async(user:string,path:string,method="GET",body?:unknown)=>SELF.fetch(`${BASE}/v1/workspaces/${ws}/docs/${doc}/drawing/${path}`,{method,headers:{authorization:`Bearer ${await mintToken(user)}`,"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  return {ws,doc,full,edit,view,call};
}
describe("independent drawing export policy",()=>{
  it("preserves defaults, restricts each export class, requires current Full access and survives room eviction",async()=>{
    const f=await fixture(),{full,edit,view,call}=f;
    expect((await call(edit,"state","PUT",{document:newDrawing(),localActor:edit,attachments:{},versions:{}})).status).toBe(200);
    for(const kind of ["images","projects","comments"])expect((await call(view,"export-authorize","POST",{kind,sources:[]})).status).toBe(200);
    expect((await call(view,"export-authorize","POST",{kind:"images",sources:[],generation:"old-generation"})).status).toBe(409);
    const update={requestId:crypto.randomUUID(),expectedRevision:0,rules:{images:"edit",projects:"full",comments:"comment"}};
    expect((await call(edit,"export-policy","PUT",update)).status).toBe(403);expect((await call(full,"export-policy","PUT",update)).status).toBe(200);
    expect((await call(view,"export-authorize","POST",{kind:"images",sources:[]})).status).toBe(403);expect((await call(edit,"export-authorize","POST",{kind:"images",sources:[]})).status).toBe(200);expect((await call(edit,"export-authorize","POST",{kind:"projects",sources:[]})).status).toBe(403);
    expect((await call(full,"export-policy","PUT",update)).status).toBe(200);expect((await call(full,"export-policy","PUT",{...update,requestId:crypto.randomUUID()})).status).toBe(409);expect((await call(full,"export-policy","PUT",{...update,rules:DEFAULT_EXPORT_RULES})).status).toBe(409);
    await evictDurableObject(env.DOCS.getByName(`${f.ws}/${f.doc}`));
    const saved=await(await call(view,"export-policy")).json<{policy:{revision:number;rules:unknown}}>();expect(saved.policy).toEqual({revision:1,rules:update.rules});
    const artwork=await(await call(full,"state")).json<{state:{revision:number;document:{scene:Record<string,unknown>}}}>();expect(artwork.state.revision).toBe(0);expect(artwork.state.document.scene).not.toHaveProperty("exportPolicy");
    await grant(full,f.ws,f.doc,"edit");expect((await call(full,"export-policy","PUT",update)).status).toBe(403);
  });
  it("freshly checks linked sources and live revocation and refuses malformed or wrong-account requests",async()=>{
    const {ws,doc,full,view,call}=await fixture(),source=uid("private-source");await grant(view,ws,source,"view");
    const body={kind:"images",sources:[{workspaceId:ws,docId:source}]};expect((await call(view,"export-authorize","POST",body)).status).toBe(200);
    await grant(view,ws,source,"none");const denied=await call(view,"export-authorize","POST",body);expect(denied.status).toBe(403);expect(await denied.text()).not.toContain(source);
    expect((await call(full,"export-policy","PUT",null)).status).toBe(400);expect((await call(full,"export-policy","PUT",{requestId:"bad",expectedRevision:0,rules:{...DEFAULT_EXPORT_RULES,images:"nobody"}})).status).toBe(400);
    await grant(view,ws,doc,"none");expect((await call(view,"export-authorize","POST",{kind:"images",sources:[]})).status).toBe(403);
  });
  it("retains a personal initial policy until a Full member publishes it, and never overwrites a configured shared policy",async()=>{
    const {full,edit,call}=await fixture(),rules={...DEFAULT_EXPORT_RULES,projects:"full"};
    expect((await call(edit,"export-authorize","POST",{kind:"projects",sources:[],initialRules:rules})).status).toBe(403);
    expect((await call(full,"export-authorize","POST",{kind:"projects",sources:[],initialRules:rules})).status).toBe(200);
    expect((await call(edit,"state","PUT",{document:newDrawing(),localActor:edit,attachments:{},versions:{},exportPolicy:DEFAULT_EXPORT_RULES})).status).toBe(200);
    const saved=await(await call(edit,"export-policy")).json<{policy:{rules:unknown}}>();expect(saved.policy.rules).toEqual(rules);
    expect((await call(edit,"export-authorize","POST",{kind:"projects",sources:[],initialRules:DEFAULT_EXPORT_RULES})).status).toBe(403);
  });
});
