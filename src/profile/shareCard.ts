import type { Profile } from "../lib/types";
import type { ProfileStats } from "./BlockView";
import type { BannerTone } from "./bannerColor";

function load(src: string | null): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const iw = img.naturalWidth * s;
  const ih = img.naturalHeight * s;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

const FONT = '"Instrument Sans Variable", "IBM Plex Sans Arabic", "Segoe UI", sans-serif';

/** Draws a 1200x630 profile card (banner, avatar, name, handle, light stats) to a PNG blob. */
export async function renderShareCard(p: Profile, stats: ProfileStats | null, tone: BannerTone, bannerSrc: string | null, avatarSrc: string | null): Promise<Blob> {
  const W = 1200, H = 630;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const [banner, avatar] = await Promise.all([load(bannerSrc), load(avatarSrc)]);

  ctx.fillStyle = `rgb(${tone.deep})`;
  ctx.fillRect(0, 0, W, H);
  if (banner) {
    ctx.save();
    ctx.filter = "blur(60px) saturate(1.3)";
    ctx.globalAlpha = 0.45;
    cover(ctx, banner, -80, -80, W + 160, H + 160);
    ctx.restore();
    const bh = 300;
    ctx.save();
    cover(ctx, banner, 0, 0, W, bh);
    const fade = ctx.createLinearGradient(0, bh - 120, 0, bh);
    fade.addColorStop(0, `rgba(${tone.deep}, 0)`);
    fade.addColorStop(1, `rgba(${tone.deep}, 1)`);
    ctx.fillStyle = fade;
    ctx.fillRect(0, bh - 120, W, 120);
    ctx.restore();
  }

  // Avatar with a thin glass ring.
  const ax = 80, ay = 230, ar = 76;
  ctx.save();
  ctx.beginPath();
  ctx.arc(ax + ar, ay + ar, ar + 5, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ax + ar, ay + ar, ar, 0, Math.PI * 2);
  ctx.clip();
  if (avatar) cover(ctx, avatar, ax, ay, ar * 2, ar * 2);
  else {
    ctx.fillStyle = `rgb(${tone.rgb})`;
    ctx.fillRect(ax, ay, ar * 2, ar * 2);
  }
  ctx.restore();

  ctx.direction = "inherit";
  ctx.fillStyle = "#fff";
  ctx.font = `700 54px ${FONT}`;
  ctx.fillText(p.displayName || "Worlds", 80, 450);
  ctx.fillStyle = "rgba(255,255,255,0.62)";
  ctx.font = `500 26px ${FONT}`;
  const sub = [p.handle ? `@${p.handle}` : "", p.status ?? ""].filter(Boolean).join("  ·  ");
  if (sub) ctx.fillText(sub, 80, 494);

  if (stats) {
    const items: [number, string][] = [
      [stats.pages, "Pages"],
      [stats.chats, "Chats"],
      [stats.automations, "Automations"],
      [stats.streak, "Day streak"],
    ];
    let x = 80;
    for (const [n, label] of items) {
      ctx.fillStyle = "#fff";
      ctx.font = `700 34px ${FONT}`;
      ctx.fillText(String(n), x, 568);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = `500 19px ${FONT}`;
      ctx.fillText(label, x, 596);
      x += Math.max(140, ctx.measureText(label).width + 60);
    }
  }
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.font = `600 20px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("Worlds", W - 60, H - 40);

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not draw the card"))), "image/png"));
}
