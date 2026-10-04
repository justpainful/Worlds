/**
 * Frame health, watched passively (no polling loop): the browser reports
 * long animation frames, and when they bunch up the glass steps down from
 * Full to Reduced until frames are smooth again. The user's own quality
 * choice is never exceeded.
 */
import { glassScene } from "../glass/scene";

const WINDOW = 3000;
const SLOW_FRAMES = 4;
const RECOVER_AFTER = 12000;

let slow: number[] = [];
let lastSlow = 0;
let recoverTimer = 0;
let enabled = true;
let started = false;
/** Milliseconds from navigation start until the workspace was ready. */
export let startupMs = 0;
export let longFrames = 0;

export function markReady() {
  if (!startupMs) startupMs = Math.round(performance.now());
}

export function setAdaptiveQuality(on: boolean) {
  enabled = on;
  if (!on) glassScene.setAutoReduced(false);
}

function onSlow(at: number) {
  longFrames++;
  lastSlow = at;
  slow = slow.filter((t) => at - t < WINDOW);
  slow.push(at);
  if (enabled && slow.length >= SLOW_FRAMES && !glassScene.autoReduced) {
    glassScene.setAutoReduced(true);
  }
  window.clearTimeout(recoverTimer);
  recoverTimer = window.setTimeout(function check() {
    if (performance.now() - lastSlow >= RECOVER_AFTER) {
      slow = [];
      glassScene.setAutoReduced(false);
    } else {
      recoverTimer = window.setTimeout(check, RECOVER_AFTER);
    }
  }, RECOVER_AFTER);
}

export function startMonitor() {
  if (started || typeof PerformanceObserver === "undefined") return;
  started = true;
  const types = PerformanceObserver.supportedEntryTypes ?? [];
  const type = types.includes("long-animation-frame") ? "long-animation-frame" : types.includes("longtask") ? "longtask" : null;
  if (!type) return;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      // A frame that blocks for 50ms+ while the user is looking is a dropped beat.
      if (e.duration >= 50 && !document.hidden) onSlow(e.startTime);
    }
  }).observe({ type, buffered: false });
}
