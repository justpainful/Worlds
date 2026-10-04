import type { JSONContent } from "@tiptap/core";

const key = (n: JSONContent) => (n.attrs?.bid as string | undefined) ?? "";

/**
 * Three-way block merge for when another writer (Claude via MCP, or an
 * automation) changed the page while it is open.
 *
 *   baseline: blocks as last loaded/saved by this editor
 *   local:    blocks currently in the editor
 *   server:   blocks now stored
 *
 * Blocks the user did not touch take the server version; blocks the user
 * changed keep the local version; blocks the user added stay after their
 * local predecessor; blocks deleted on either side stay deleted unless the
 * other side changed them.
 */
export function mergeBlocks(baseline: Map<string, string>, local: JSONContent[], server: JSONContent[]): { merged: JSONContent[]; dirty: boolean } {
  const localById = new Map(local.map((n) => [key(n), n]));
  const serverIds = new Set(server.map(key));
  const changedLocally = (n: JSONContent) => baseline.get(key(n)) !== JSON.stringify(n);

  const merged: JSONContent[] = [];
  for (const s of server) {
    const id = key(s);
    const l = localById.get(id);
    if (!l) {
      // Deleted locally: keep deleted unless it is new on the server.
      if (baseline.has(id)) {
        const serverChanged = baseline.get(id) !== JSON.stringify(s);
        if (serverChanged) merged.push(s);
      } else merged.push(s);
      continue;
    }
    merged.push(changedLocally(l) ? l : s);
  }
  // Local additions (not on server, not in baseline): insert after predecessor.
  local.forEach((l, i) => {
    const id = key(l);
    if (serverIds.has(id) || baseline.has(id)) return;
    let at = merged.length;
    for (let j = i - 1; j >= 0; j--) {
      const pid = key(local[j]);
      const idx = merged.findIndex((m) => key(m) === pid);
      if (idx >= 0) {
        at = idx + 1;
        break;
      }
      if (j === 0) at = 0;
    }
    if (i === 0) at = 0;
    merged.splice(at, 0, l);
  });
  const serverStr = JSON.stringify(server);
  return { merged, dirty: JSON.stringify(merged) !== serverStr };
}
