#!/usr/bin/env node
/**
 * Worlds dashboard tools for Claude (docs/admin/PLAN.md, phase 8).
 *
 * An MCP server over stdio with no dependencies. It reads the control
 * dashboard with a key an owner made on admin.enterworlds.space (Team page),
 * and can only PROPOSE changes: each proposal waits in the dashboard until a
 * person approves it there, with their own rights and second check.
 *
 *   claude mcp add worlds-admin -e WORLDS_ADMIN_KEY=wak_... -- node tools/worlds-admin-mcp/server.mjs
 *
 * WORLDS_IDENTITY_URL changes the service (default https://login.enterworlds.space).
 */
import { createInterface } from "node:readline";

const BASE = (process.env.WORLDS_IDENTITY_URL || "https://login.enterworlds.space").replace(/\/+$/, "");
const KEY = process.env.WORLDS_ADMIN_KEY || "";

async function api(method, path, body) {
  if (!KEY) throw new Error("Set WORLDS_ADMIN_KEY to a key from the dashboard's Team page.");
  const res = await fetch(BASE + path, {
    method,
    headers: { "x-worlds-admin-key": KEY, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { text };
  }
  if (!res.ok) throw new Error(`${res.status} ${json.error ?? ""} ${json.message ?? text}`.trim());
  return json;
}

const q = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

const propose = (action, summary, payload) => api("POST", "/admin/proposals", { action, summary, payload });

/** Each tool: a description, its input schema, and what it does. Reads are direct; changes are proposals. */
const TOOLS = {
  worlds_overview: {
    description: "Numbers at a glance: accounts, sign-ups, activity, platforms, public content and workspaces.",
    input: {},
    run: () => api("GET", "/admin/stats"),
  },
  worlds_insights: {
    description: "Detailed numbers: daily activity, retention cohorts, sign-up funnel, versions, countries, email delivery, support response, usage reports.",
    input: {},
    run: () => api("GET", "/admin/insights"),
  },
  worlds_find_accounts: {
    description: "Search accounts by name, username or email. status: all, active, suspended, banned, deleting, team.",
    input: { q: { type: "string" }, status: { type: "string" }, limit: { type: "number" } },
    run: (a) => api("GET", `/admin/users${q({ q: a.q, status: a.status, limit: a.limit ?? 20 })}`),
  },
  worlds_account: {
    description: "Everything about one account: devices, passkeys, workspaces, public profile, published pages, notes, recent activity.",
    input: { id: { type: "string", required: true } },
    run: (a) => api("GET", `/admin/users/${encodeURIComponent(a.id)}`),
  },
  worlds_support_requests: {
    description: "Support requests. status: active (open and in progress), waiting, solved, closed, all. kind: problem, account, recovery, deletion, report, security, suggestion, other.",
    input: { status: { type: "string" }, kind: { type: "string" }, q: { type: "string" } },
    run: (a) => api("GET", `/admin/support${q({ status: a.status ?? "active", kind: a.kind, q: a.q })}`),
  },
  worlds_support_request: {
    description: "One support request with its whole conversation and internal notes, by number (W-1001 or 1001).",
    input: { number: { type: "string", required: true } },
    run: (a) => api("GET", `/admin/support/${String(a.number).replace(/^w-?/i, "")}`),
  },
  worlds_security_log: {
    description: "The security log, newest first. user: an account id. action: a prefix such as auth., admin., account.",
    input: { user: { type: "string" }, action: { type: "string" }, limit: { type: "number" } },
    run: (a) => api("GET", `/admin/audit${q({ user: a.user, action: a.action, limit: a.limit ?? 50 })}`),
  },
  worlds_public_content: {
    description: "Public profiles (kind=profiles) or published pages and share links (kind=pages), with report counts.",
    input: { kind: { type: "string", required: true }, q: { type: "string" } },
    run: (a) => api("GET", `/admin/content/${a.kind === "pages" ? "pages" : "profiles"}${q({ q: a.q })}`),
  },
  worlds_suspicious_accounts: {
    description: "Recent sign-ups with a sign worth a look: throwaway email, a name like Worlds or support, quick publishing, a sign-up burst, reports.",
    input: {},
    run: () => api("GET", "/admin/suspicious"),
  },
  worlds_suggestions: {
    description: "Suggestions with their votes and status (new, planned, working, shipped, declined, duplicate).",
    input: { status: { type: "string" } },
    run: (a) => api("GET", `/admin/suggestions${q({ status: a.status })}`),
  },
  worlds_proposals: {
    description: "Changes already proposed and whether a person approved them. status: pending, approved, rejected, all.",
    input: { status: { type: "string" } },
    run: (a) => api("GET", `/admin/proposals${q({ status: a.status ?? "pending" })}`),
  },

  propose_reply: {
    description: "Propose a reply to a support request. It goes out by email from support@ and in the app only after a person approves it. status after replying: waiting (default), working or solved.",
    input: { number: { type: "number", required: true }, body: { type: "string", required: true }, status: { type: "string" }, summary: { type: "string", required: true } },
    run: (a) => propose("reply", a.summary, { number: a.number, body: a.body, status: a.status }),
  },
  propose_ticket_status: {
    description: "Propose a status or priority for a support request (open, waiting, working, solved, closed; low, normal, high, urgent).",
    input: { number: { type: "number", required: true }, status: { type: "string" }, priority: { type: "string" }, summary: { type: "string", required: true } },
    run: (a) => propose("ticket", a.summary, { number: a.number, status: a.status, priority: a.priority }),
  },
  propose_note: {
    description: "Propose a private team note on an account.",
    input: { userId: { type: "string", required: true }, body: { type: "string", required: true }, summary: { type: "string", required: true } },
    run: (a) => propose("note", a.summary, { userId: a.userId, body: a.body }),
  },
  propose_suspend: {
    description: "Propose suspending an account for some days (1 to 365), or banning it (ban: true). Always with a reason the person is told.",
    input: { userId: { type: "string", required: true }, days: { type: "number" }, ban: { type: "boolean" }, reason: { type: "string", required: true }, summary: { type: "string", required: true } },
    run: (a) => propose("suspend", a.summary, { userId: a.userId, days: a.days, ban: a.ban === true, reason: a.reason }),
  },
  propose_lift_suspension: {
    description: "Propose lifting a suspension or ban.",
    input: { userId: { type: "string", required: true }, reason: { type: "string", required: true }, summary: { type: "string", required: true } },
    run: (a) => propose("unsuspend", a.summary, { userId: a.userId, reason: a.reason }),
  },
  propose_hide_content: {
    description: "Propose hiding a public profile (username) or a published page or share link (pageId), with the reason its owner is told.",
    input: { username: { type: "string" }, pageId: { type: "string" }, reason: { type: "string", required: true }, summary: { type: "string", required: true } },
    run: (a) => propose("hide", a.summary, { username: a.username, pageId: a.pageId, reason: a.reason }),
  },
  propose_show_content: {
    description: "Propose showing hidden content again (username or pageId).",
    input: { username: { type: "string" }, pageId: { type: "string" }, summary: { type: "string", required: true } },
    run: (a) => propose("show", a.summary, { username: a.username, pageId: a.pageId }),
  },
  propose_suggestion: {
    description: "Propose moving a suggestion: status (planned, working, shipped, declined), public (on the board), shippedIn (a version).",
    input: { id: { type: "string", required: true }, status: { type: "string" }, public: { type: "boolean" }, shippedIn: { type: "string" }, summary: { type: "string", required: true } },
    run: (a) => propose("suggestion", a.summary, { id: a.id, status: a.status, public: a.public, shippedIn: a.shippedIn }),
  },
  propose_message: {
    description: "Propose a message from the Worlds team to one person, in their app (and by email from support@ with email: true).",
    input: { userId: { type: "string", required: true }, subject: { type: "string", required: true }, body: { type: "string", required: true }, email: { type: "boolean" }, summary: { type: "string", required: true } },
    run: (a) => propose("message", a.summary, { userId: a.userId, subject: a.subject, body: a.body, email: a.email === true }),
  },
};

function schema(input) {
  const properties = {};
  const required = [];
  for (const [k, v] of Object.entries(input)) {
    properties[k] = { type: v.type };
    if (v.required) required.push(k);
  }
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function fail(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return reply(id, {
      protocolVersion: params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "worlds-admin", version: "1.0.0" },
      instructions:
        "Tools for the Worlds control dashboard. worlds_* tools read. propose_* tools never change anything by themselves: they create a proposal that a person on the Worlds team approves in the dashboard (admin.enterworlds.space, Claude page). Write every summary so the person can decide from it alone. Never put passwords, codes or keys in a proposal.",
    });
  }
  if (method === "notifications/initialized" || method?.startsWith("notifications/")) return;
  if (method === "ping") return reply(id, {});
  if (method === "tools/list") {
    return reply(id, { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: schema(t.input) })) });
  }
  if (method === "tools/call") {
    const tool = TOOLS[params?.name];
    if (!tool) return fail(id, -32602, `Unknown tool ${params?.name}`);
    const args = params.arguments ?? {};
    for (const [k, v] of Object.entries(tool.input)) if (v.required && (args[k] === undefined || args[k] === "")) return reply(id, { isError: true, content: [{ type: "text", text: `Missing ${k}.` }] });
    try {
      const out = await tool.run(args);
      return reply(id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
    } catch (e) {
      return reply(id, { isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] });
    }
  }
  if (id !== undefined) fail(id, -32601, `Method not found: ${method}`);
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return fail(null, -32700, "Parse error");
  }
  handle(msg).catch((e) => fail(msg.id ?? null, -32603, String(e?.message ?? e)));
});
