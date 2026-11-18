/**
 * Publishing the profile to profile.<domain>/@username.
 *
 * The public copy is made from the profile on this device: name, bio, status,
 * location, accent, links and blocks. Pictures (avatar, banner, block art,
 * uploaded and product icons) are scaled down and uploaded first, and the
 * copy names them "file:<key>". Live blocks (streaks, activity, the bridge)
 * and hidden ones stay in the app.
 */
import { accountApi, type PublicProfileState } from "../account/api";
import { PRODUCT_ICONS } from "../assets/product-icons";
import { fileUrl } from "../lib/api";
import type { Profile } from "../lib/types";
import { sanitize, type ProfileBlock } from "./blocks";

/** Longest side, in pixels, of each kind of picture once published. */
// "full" is for pictures shown at their own size (fit "original"): scaling them would change what shows.
const SIDE = { avatar: 640, banner: 2000, art: 1400, full: 4096, icon: 160 } as const;
type Kind = keyof typeof SIDE;

const RAW_LIMIT = 9 * 1024 * 1024;

export interface PublishProgress {
  done: number;
  total: number;
}

function base64(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** A still picture scaled to fit `side`, as WebP (PNG where WebP is not available). */
async function scaled(blob: Blob, side: number): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const k = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * k));
  const h = Math.max(1, Math.round(bitmap.height * k));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.9));
  return out && out.type === "image/webp" ? out : await new Promise<Blob>((r, j) => canvas.toBlob((b) => (b ? r(b) : j(new Error("encode"))), "image/png"));
}

/** Uploads one picture once per publish; null when it cannot be read or is too large. */
class Uploader {
  private done = new Map<string, Promise<string | null>>();
  constructor(private onProgress: () => void) {}

  get(src: string, kind: Kind): Promise<string | null> {
    const key = `${kind}:${src}`;
    let p = this.done.get(key);
    if (!p) {
      p = this.upload(src, kind).finally(this.onProgress);
      this.done.set(key, p);
    }
    return p;
  }

  get count() {
    return this.done.size;
  }

  private async upload(src: string, kind: Kind): Promise<string | null> {
    try {
      const res = await fetch(src);
      if (!res.ok) return null;
      let blob = await res.blob();
      const type = blob.type || (/\.svg(\?|$)/i.test(src) ? "image/svg+xml" : "");
      // Animated GIFs and videos are kept as they are; everything else is scaled.
      const keep = type === "image/gif" || type.startsWith("video/");
      if (!keep) blob = await scaled(blob, SIDE[kind]);
      if (blob.size > RAW_LIMIT) return null;
      const r = await accountApi.uploadProfileFile(blob.type || type, base64(await blob.arrayBuffer()));
      return r.file;
    } catch {
      return null;
    }
  }
}

/** The URL this app reads an icon reference from, or null for emoji. */
function iconSource(ref: string | undefined): string | null {
  if (!ref) return null;
  if (ref.startsWith("img:")) return fileUrl(ref.slice(4));
  if (ref.startsWith("pi:")) return PRODUCT_ICONS[ref.slice(3) as keyof typeof PRODUCT_ICONS]?.full || null;
  return null;
}

async function icon(up: Uploader, ref: string | undefined): Promise<string | undefined> {
  const src = iconSource(ref);
  if (!src) return ref && !ref.startsWith("img:") && !ref.startsWith("pi:") ? ref : undefined;
  return (await up.get(src, "icon")) ?? undefined;
}

async function art(up: Uploader, id: string | undefined, fit?: string): Promise<string | undefined> {
  return id ? ((await up.get(fileUrl(id), fit === "original" ? "full" : "art")) ?? undefined) : undefined;
}

type Item = { icon?: string; title: string; subtitle?: string; url?: string };
const withIcons = (up: Uploader, list: Item[] | undefined) => Promise.all((list ?? []).map(async (it) => ({ ...it, icon: await icon(up, it.icon) })));

/** The block as visitors see it, with its pictures published. */
async function publicBlock(up: Uploader, b: ProfileBlock): Promise<Record<string, unknown> | null> {
  switch (b.type) {
    case "dynamic":
      return null;
    case "info":
      return { ...b, labelIcon: await icon(up, b.labelIcon), image: await art(up, b.image, b.imageFit) };
    case "quote":
      return { ...b, labelIcon: await icon(up, b.labelIcon), image: await art(up, b.image, b.imageFit) };
    case "progress":
      return { ...b, icon: await icon(up, b.icon) };
    case "media":
      return { ...b, media: await art(up, b.media, b.fit) };
    case "frame":
      return { ...b, photos: (await Promise.all((b.photos ?? []).slice(0, 8).map((p) => art(up, p)))).filter(Boolean) };
    case "grid":
    case "list":
      return { ...b, items: await withIcons(up, b.items) };
    case "links":
      return { ...b, links: await withIcons(up, b.links) };
    case "badges":
      return { ...b, badges: await withIcons(up, b.badges) };
    default:
      return { ...(b as object) };
  }
}

/** Publish (or update) the public copy of this profile. */
export async function publishProfile(profile: Profile, opts: { visible?: boolean; onProgress?: (p: PublishProgress) => void } = {}): Promise<PublicProfileState> {
  let finished = 0;
  const up = new Uploader(() => {
    finished += 1;
    opts.onProgress?.({ done: finished, total: up.count });
  });
  const blocks = sanitize(profile.blocks).filter((b) => !b.hidden);
  const [avatar, banner, published] = await Promise.all([
    profile.avatar ? up.get(fileUrl(profile.avatar), "avatar") : Promise.resolve(null),
    profile.banner ? up.get(fileUrl(profile.banner), "banner") : Promise.resolve(null),
    Promise.all(blocks.map((b) => publicBlock(up, b))),
  ]);
  return accountApi.publishProfile({
    visible: opts.visible,
    avatar,
    banner,
    profile: {
      displayName: profile.displayName,
      bio: profile.bio,
      status: profile.status,
      location: profile.location,
      accent: profile.accent,
      theme: profile.theme,
      textDirection: profile.textDirection,
      language: profile.language,
      links: profile.links ?? [],
      blocks: published.filter(Boolean),
      bannerFocus: profile.bannerFocus,
      avatarCrop: profile.avatarCrop,
    },
  });
}
