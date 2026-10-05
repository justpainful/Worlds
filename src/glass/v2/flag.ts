/**
 * Development flag for Liquid Glass V2 in the real app (phase 2 validation).
 * Off by default, so the app looks exactly as before unless it is turned on.
 *
 *   ?glassv2=1 / ?glassv2=0          turn it on or off (remembered on this device)
 *   Ctrl+Alt+Shift+G                  toggle and reload (works in the installed window)
 *   localStorage "worlds.glassV2"     "1" when on
 *
 * Only surfaces that opt in with `v2` (small toolbar controls of the validated
 * material) switch; everything else stays on the current engine.
 */
const KEY = "worlds.glassV2";

function read(): boolean {
  try {
    const q = new URLSearchParams(location.search).get("glassv2");
    if (q === "1" || q === "0") localStorage.setItem(KEY, q);
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Read once at startup: surfaces never switch engines while mounted. */
export const GLASS_V2 = read();

if (GLASS_V2) {
  document.documentElement.dataset.glassV2 = "on";
  void import("./audit");
}

addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.altKey && e.shiftKey && e.code === "KeyG") {
    e.preventDefault();
    try {
      localStorage.setItem(KEY, GLASS_V2 ? "0" : "1");
    } catch {
      return;
    }
    location.reload();
  }
});
