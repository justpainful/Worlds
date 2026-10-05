// In-test fake of the identity service. It speaks the same Service Binding
// RPC contract as the real one (docs/contracts/identity.md): the named
// entrypoint IdentityRPC with checkAccess({ userId, workspaceId, docId }).
// Tests change grants through the default fetch handler.
import { WorkerEntrypoint } from "cloudflare:workers";

const grants = new Map();
let failing = false;
let calls = 0;

export class IdentityRPC extends WorkerEntrypoint {
  async checkAccess({ userId, workspaceId, docId }) {
    calls++;
    if (failing) throw new Error("identity unavailable");
    const level = grants.get(`${userId}|${workspaceId}|${docId}`) ?? grants.get(`${userId}|${workspaceId}|*`) ?? "none";
    return { level };
  }

  async listDocs() {
    return [];
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/grant") {
      const { userId, workspaceId, docId, level } = await request.json();
      grants.set(`${userId}|${workspaceId}|${docId ?? "*"}`, level);
      return Response.json({ ok: true });
    }
    if (url.pathname === "/fail") {
      failing = (await request.json()).on;
      return Response.json({ ok: true });
    }
    if (url.pathname === "/calls") return Response.json({ calls });
    return new Response("not found", { status: 404 });
  },
};
