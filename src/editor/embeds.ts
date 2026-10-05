/**
 * Turning a link into something that plays or shows inside the page.
 * Only well-known players are framed; anything else stays a link card.
 */

export interface EmbedInfo {
  provider: "youtube" | "vimeo" | "spotify" | "maps" | "pdf" | "loom" | "figma" | "soundcloud";
  label: string;
  src: string;
  /** Height in px, or an aspect ratio (width / height) when `ratio` is set. */
  height?: number;
  ratio?: number;
}

function url(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

export function embedFor(raw: string): EmbedInfo | null {
  const u = url(raw);
  if (!u) return null;
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const path = u.pathname;

  // YouTube: watch, youtu.be, shorts, live, embed. Start time kept.
  let yt: string | null = null;
  if (host === "youtu.be") yt = path.slice(1).split("/")[0];
  else if (host.endsWith("youtube.com")) {
    if (path === "/watch") yt = u.searchParams.get("v");
    else {
      const m = path.match(/^\/(?:shorts|live|embed)\/([\w-]{6,})/);
      if (m) yt = m[1];
    }
  }
  if (yt && /^[\w-]{6,}$/.test(yt)) {
    const t = u.searchParams.get("t") ?? u.searchParams.get("start");
    const start = t ? parseInt(t, 10) : 0;
    return { provider: "youtube", label: "YouTube", src: `https://www.youtube-nocookie.com/embed/${yt}?rel=0${start ? `&start=${start}` : ""}`, ratio: 16 / 9 };
  }

  if (host === "vimeo.com") {
    const m = path.match(/^\/(\d+)/);
    if (m) return { provider: "vimeo", label: "Vimeo", src: `https://player.vimeo.com/video/${m[1]}`, ratio: 16 / 9 };
  }

  if (host === "open.spotify.com") {
    const m = path.match(/^\/(?:intl-[a-z-]+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/);
    if (m) {
      const tall = m[1] !== "track" && m[1] !== "episode";
      return { provider: "spotify", label: "Spotify", src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, height: tall ? 380 : 152 };
    }
  }

  if (host === "soundcloud.com" && path.split("/").filter(Boolean).length >= 2) {
    return { provider: "soundcloud", label: "SoundCloud", src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(u.href)}&visual=true`, height: 300 };
  }

  if (host === "loom.com") {
    const m = path.match(/^\/share\/([a-f0-9]+)/);
    if (m) return { provider: "loom", label: "Loom", src: `https://www.loom.com/embed/${m[1]}`, ratio: 16 / 9 };
  }

  if (host === "figma.com" && /^\/(file|design|proto|board)\//.test(path)) {
    return { provider: "figma", label: "Figma", src: `https://embed.figma.com${path}?embed-host=worlds`, height: 480 };
  }

  // Google Maps: a place, a search, or coordinates in the URL. (Short
  // maps.app.goo.gl links cannot be resolved without leaving the app.)
  if ((host === "google.com" || host.startsWith("google.")) && path.startsWith("/maps")) {
    const at = path.match(/@(-?\d+\.\d+),(-?\d+\.\d+),(\d+(?:\.\d+)?)z/);
    const place = path.match(/\/maps\/(?:place|search)\/([^/]+)/);
    const q = u.searchParams.get("q") ?? u.searchParams.get("query") ?? (place ? decodeURIComponent(place[1].replace(/\+/g, " ")) : at ? `${at[1]},${at[2]}` : null);
    if (q) {
      const z = at ? Math.round(parseFloat(at[3])) : 14;
      return { provider: "maps", label: "Google Maps", src: `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=${z}&output=embed`, height: 380 };
    }
  }

  if (/\.pdf$/i.test(path)) return { provider: "pdf", label: "PDF", src: u.href, height: 720 };
  return null;
}

/** Sandbox per provider: enough to play, nothing more. */
export function sandboxFor(p: EmbedInfo["provider"]): string | undefined {
  if (p === "pdf") return undefined; // the browser's own PDF viewer
  return "allow-scripts allow-same-origin allow-popups allow-presentation allow-forms";
}
