// Loads the pack definitions (src/packs) and the Arabic dictionary for the site
// build, so every pack page is written from the same data the app runs on.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function loadPacks() {
  const server = await createServer({ root: ROOT, configFile: false, logLevel: "error", server: { middlewareMode: true, hmr: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const registry = await server.ssrLoadModule("/src/packs/registry.ts");
    const definition = await server.ssrLoadModule("/src/packs/definition.ts");
    const drawn = await server.ssrLoadModule("/src/ui/drawnMap.ts");
    return { packs: registry.PACK_DEFS, families: definition.FAMILIES, drawn: drawn.DRAWN_PRODUCT };
  } finally {
    await server.close();
  }
}

export function loadArabic() {
  return JSON.parse(readFileSync(join(ROOT, "src", "i18n", "ar.json"), "utf8"));
}
