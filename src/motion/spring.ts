/**
 * Spring physics for the material system.
 *
 * One solver drives both JS-animated values (glass morphs, selection pills)
 * and CSS transitions: springs are compiled into CSS `linear()` easing
 * curves so declarative transitions follow the same physics.
 */

export interface SpringConfig {
  stiffness: number;
  damping: number;
  mass: number;
}

/** Compact interactive UI. */
export const SPRING_SNAPPY: SpringConfig = { stiffness: 520, damping: 38, mass: 0.9 };
/** Larger / softer material deformation. */
export const SPRING_SOFT: SpringConfig = { stiffness: 260, damping: 26, mass: 1.0 };
/** Critically damped positioning (no overshoot). */
export const SPRING_SETTLE: SpringConfig = { stiffness: 300, damping: 34.6, mass: 1.0 };

/** Closed-form position of a unit step response at time t (seconds). */
export function springAt(cfg: SpringConfig, t: number, v0 = 0): { x: number; v: number } {
  const { stiffness: k, damping: c, mass: m } = cfg;
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  // displacement from target: starts at -1 (target 1, start 0)
  const x0 = -1;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const a = x0;
    const b = (v0 + zeta * w0 * x0) / wd;
    const e = Math.exp(-zeta * w0 * t);
    const cos = Math.cos(wd * t);
    const sin = Math.sin(wd * t);
    const disp = e * (a * cos + b * sin);
    const vel = e * ((b * wd - zeta * w0 * a) * cos - (a * wd + zeta * w0 * b) * sin);
    return { x: 1 + disp, v: vel };
  }
  if (zeta === 1) {
    const a = x0;
    const b = v0 + w0 * x0;
    const e = Math.exp(-w0 * t);
    return { x: 1 + (a + b * t) * e, v: (b - w0 * (a + b * t)) * e };
  }
  const s = Math.sqrt(zeta * zeta - 1);
  const r1 = -w0 * (zeta - s);
  const r2 = -w0 * (zeta + s);
  const c2 = (v0 - r1 * x0) / (r2 - r1);
  const c1 = x0 - c2;
  return {
    x: 1 + c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t),
    v: c1 * r1 * Math.exp(r1 * t) + c2 * r2 * Math.exp(r2 * t),
  };
}

/** Time (s) until the spring stays within `eps` of rest. */
export function settleTime(cfg: SpringConfig, eps = 0.0015): number {
  let last = 0;
  for (let t = 0; t < 4; t += 1 / 240) {
    const { x, v } = springAt(cfg, t);
    if (Math.abs(1 - x) > eps || Math.abs(v) > eps * 10) last = t;
  }
  return Math.max(0.05, last);
}

/** Compile a spring into a CSS linear() easing + its natural duration. */
export function springToCss(cfg: SpringConfig, points = 48): { easing: string; durationMs: number } {
  const d = settleTime(cfg);
  const stops: string[] = [];
  for (let i = 0; i <= points; i++) {
    const t = (i / points) * d;
    const x = i === points ? 1 : springAt(cfg, t).x;
    stops.push(x.toFixed(4));
  }
  return { easing: `linear(${stops.join(", ")})`, durationMs: Math.round(d * 1000) };
}

/** Publish spring easings as CSS custom properties. */
export function installSpringTokens(root: HTMLElement = document.documentElement) {
  const snappy = springToCss(SPRING_SNAPPY);
  const soft = springToCss(SPRING_SOFT);
  const settle = springToCss(SPRING_SETTLE);
  root.style.setProperty("--spring-snappy", snappy.easing);
  root.style.setProperty("--spring-snappy-d", `${snappy.durationMs}ms`);
  root.style.setProperty("--spring-soft", soft.easing);
  root.style.setProperty("--spring-soft-d", `${soft.durationMs}ms`);
  root.style.setProperty("--spring-settle", settle.easing);
  root.style.setProperty("--spring-settle-d", `${settle.durationMs}ms`);
}

/**
 * Interruptible JS spring for a single scalar. Retargeting keeps the current
 * position and velocity, so motion never jumps when input changes mid-flight.
 */
export class Spring {
  value: number;
  velocity = 0;
  target: number;
  private raf = 0;
  private last = 0;

  constructor(
    initial: number,
    private cfg: SpringConfig,
    private onUpdate: (v: number) => void,
    private reduced = () => false,
  ) {
    this.value = initial;
    this.target = initial;
  }

  set(target: number, opts: { immediate?: boolean; velocity?: number } = {}) {
    this.target = target;
    if (opts.velocity !== undefined) this.velocity = opts.velocity;
    if (opts.immediate || this.reduced()) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.value = target;
      this.velocity = 0;
      this.onUpdate(target);
      return;
    }
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.step);
    }
  }

  private step = (now: number) => {
    // Semi-implicit Euler with sub-steps for stability at high stiffness.
    let dt = Math.min(0.064, (now - this.last) / 1000);
    this.last = now;
    const { stiffness: k, damping: c, mass: m } = this.cfg;
    const sub = 4;
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      const f = -k * (this.value - this.target) - c * this.velocity;
      this.velocity += (f / m) * h;
      this.value += this.velocity * h;
    }
    this.onUpdate(this.value);
    if (Math.abs(this.value - this.target) < 0.0005 && Math.abs(this.velocity) < 0.005) {
      this.value = this.target;
      this.velocity = 0;
      this.onUpdate(this.value);
      this.raf = 0;
      return;
    }
    this.raf = requestAnimationFrame(this.step);
  };

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}

export function prefersReducedMotion(): boolean {
  return (
    document.documentElement.dataset.motion === "reduced" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
