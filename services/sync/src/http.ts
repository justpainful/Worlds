export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}

export function problem(status: number, message: string): Response {
  return json({ error: message }, status);
}

export function cors(request: Request, allowed: string | undefined, res: Response): Response {
  const origin = request.headers.get("origin");
  if (!origin) return res;
  const list = (allowed ?? "*").split(",").map((s) => s.trim());
  if (!list.includes("*") && !list.includes(origin)) return res;
  // WebSocket upgrade responses cannot be re-wrapped.
  if (res.status === 101) return res;
  const out = new Response(res.body, res);
  out.headers.set("access-control-allow-origin", list.includes("*") ? "*" : origin);
  out.headers.set("access-control-allow-headers", "authorization, content-type, range");
  out.headers.set("access-control-allow-methods", "GET, HEAD, POST, PUT, OPTIONS");
  out.headers.set("access-control-expose-headers", "content-range, content-length, etag");
  out.headers.set("access-control-max-age", "600");
  if (!list.includes("*")) out.headers.set("vary", "origin");
  return out;
}
