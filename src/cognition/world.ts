/**
 * The world: your workspace drawn as islands. Pure layout, no DOM.
 *
 * Every shape comes from your data by fixed rules, never by guessing:
 *  - each top-level page is an island; the pages under it are houses on it
 *  - a house grows with how much the page holds, and gets a tower when its
 *    memory cards are well remembered
 *  - links between pages on different islands are bridges; sparks glow
 *  - open questions hang as fog over their island
 *  - pages left alone for a month are overgrown
 *  - Aha! moments are stars in the sky
 */

export interface WorldPage {
  id: string;
  title: string;
  parentId: string | null;
  kind: string;
  size: number;
  /** Last opened or edited. */
  touched: number;
}

export interface WorldInput {
  pages: WorldPage[];
  links: [string, string][];
  sparks: [string, string][];
  /** Open questions per page. */
  questions: Record<string, number>;
  /** Share of remembered cards per page (0 to 1), for pages that have cards. */
  mastery: Record<string, number>;
  stars: number;
  now: number;
}

export interface House {
  id: string;
  title: string;
  x: number;
  y: number;
  /** Footprint width in world units. */
  w: number;
  h: number;
  roof: number;
  tower: boolean;
  overgrown: boolean;
  kind: string;
}

export interface Island {
  id: string;
  title: string;
  x: number;
  y: number;
  r: number;
  /** Closed blob outline in world units. */
  path: string;
  houses: House[];
  fog: number;
  hue: number;
}

export interface Bridge {
  from: string;
  to: string;
  path: string;
  spark: boolean;
  weight: number;
}

export interface Star {
  x: number;
  y: number;
  s: number;
}

export interface World {
  islands: Island[];
  bridges: Bridge[];
  stars: Star[];
  width: number;
  height: number;
}

const MONTH = 30 * 86_400_000;

/** Small seeded random numbers: the same id always draws the same shape. */
export function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A wobbly closed outline around (cx, cy), smoothed with quadratic curves. */
export function blob(cx: number, cy: number, r: number, rand: () => number, points = 11, wobble = 0.22): string {
  const pts = Array.from({ length: points }, (_, i) => {
    const a = (i / points) * Math.PI * 2;
    const rr = r * (1 - wobble / 2 + rand() * wobble);
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.78];
  });
  const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let d = "";
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const n = pts[(i + 1) % pts.length];
    const m = mid(p, n);
    if (i === 0) {
      const s = mid(pts[pts.length - 1], p);
      d += `M${s[0].toFixed(1)} ${s[1].toFixed(1)}`;
    }
    d += ` Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)}`;
  }
  return d + " Z";
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function buildWorld(input: WorldInput): World {
  const live = input.pages;
  const byId = new Map(live.map((p) => [p.id, p]));
  const rootOf = (id: string): string => {
    let p = byId.get(id);
    let n = 0;
    while (p?.parentId && byId.has(p.parentId) && n++ < 40) p = byId.get(p.parentId);
    return p?.id ?? id;
  };
  const groups = new Map<string, WorldPage[]>();
  for (const p of live) {
    const r = rootOf(p.id);
    groups.set(r, [...(groups.get(r) ?? []), p]);
  }
  // Biggest islands in the middle.
  const roots = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));

  const islands: Island[] = [];
  const placed: { x: number; y: number; r: number }[] = [];
  roots.forEach(([rootId, members], i) => {
    const rand = seeded(rootId);
    const r = 70 + Math.sqrt(members.length) * 34;
    // Spiral outwards until the island clears every one before it.
    let k = i === 0 ? 0 : placed.length * 3;
    let x = 0;
    let y = 0;
    for (; k < 4000; k++) {
      const dist = k === 0 ? 0 : 60 * Math.sqrt(k);
      x = Math.cos(k * GOLDEN) * dist * 1.3;
      y = Math.sin(k * GOLDEN) * dist;
      if (placed.every((o) => Math.hypot(o.x - x, (o.y - y) * 1.25) > o.r + r + 70)) break;
    }
    placed.push({ x, y, r });

    const root = byId.get(rootId)!;
    const houses: House[] = members
      .slice()
      .sort((a, b) => (a.id === rootId ? -1 : b.id === rootId ? 1 : b.size - a.size))
      .map((p, j) => {
        const hr = seeded(p.id);
        const d = j === 0 ? 0 : (r - 34) * Math.sqrt(j / Math.max(1, members.length));
        const a = j * GOLDEN + rand() * 0.3;
        const grow = Math.min(1, Math.log10(10 + p.size) / 4);
        const m = input.mastery[p.id];
        return {
          id: p.id,
          title: p.title,
          x: x + Math.cos(a) * d,
          y: y + Math.sin(a) * d * 0.72,
          w: 16 + grow * 22 + (j === 0 ? 8 : 0),
          h: 12 + grow * 18 + (j === 0 ? 8 : 0),
          roof: 8 + hr() * 8,
          tower: m !== undefined && m >= 0.6,
          overgrown: input.now - p.touched > MONTH,
          kind: p.kind,
        };
      })
      // Draw back to front so houses overlap the right way.
      .sort((a, b) => a.y - b.y);
    const fog = members.reduce((n, p) => n + (input.questions[p.id] ?? 0), 0);
    islands.push({ id: rootId, title: root.title, x, y, r, path: blob(x, y, r, rand), houses, fog, hue: Math.floor(rand() * 360) });
  });

  const islandOf = new Map<string, Island>();
  for (const isl of islands) for (const h of isl.houses) islandOf.set(h.id, isl);
  const pairs = new Map<string, Bridge>();
  const add = ([a, b]: [string, string], spark: boolean) => {
    const ia = islandOf.get(a);
    const ib = islandOf.get(b);
    if (!ia || !ib || ia === ib) return;
    const key = [ia.id, ib.id].sort().join("|");
    const prev = pairs.get(key);
    if (prev) {
      prev.weight += 1;
      prev.spark ||= spark;
      return;
    }
    const mx = (ia.x + ib.x) / 2;
    const my = (ia.y + ib.y) / 2 - Math.hypot(ia.x - ib.x, ia.y - ib.y) * 0.12;
    pairs.set(key, { from: ia.id, to: ib.id, path: `M${ia.x.toFixed(1)} ${ia.y.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${ib.x.toFixed(1)} ${ib.y.toFixed(1)}`, spark, weight: 1 });
  };
  input.links.forEach((l) => add(l, false));
  input.sparks.forEach((l) => add(l, true));

  const minX = Math.min(0, ...islands.map((i) => i.x - i.r)) - 120;
  const maxX = Math.max(0, ...islands.map((i) => i.x + i.r)) + 120;
  const minY = Math.min(0, ...islands.map((i) => i.y - i.r)) - 200;
  const maxY = Math.max(0, ...islands.map((i) => i.y + i.r)) + 120;
  const srand = seeded(`stars${input.stars}`);
  const stars: Star[] = Array.from({ length: Math.min(80, input.stars) }, () => ({
    x: minX + srand() * (maxX - minX),
    y: minY + srand() * 150,
    s: 0.6 + srand() * 0.8,
  }));

  // Shift everything so the top-left corner is (0, 0).
  const dx = -minX;
  const dy = -minY;
  const move = (d: string) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, a, b) => `${(Number(a) + dx).toFixed(1)} ${(Number(b) + dy).toFixed(1)}`);
  return {
    islands: islands.map((i) => ({ ...i, x: i.x + dx, y: i.y + dy, path: move(i.path), houses: i.houses.map((h) => ({ ...h, x: h.x + dx, y: h.y + dy })) })),
    bridges: [...pairs.values()].map((b) => ({ ...b, path: move(b.path) })),
    stars: stars.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy })),
    width: maxX - minX,
    height: maxY - minY,
  };
}
