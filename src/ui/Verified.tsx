/**
 * The verified seal: a scalloped rosette with a check, lit from the top so it
 * sits with the product icons rather than looking like a flat glyph.
 */
export function Verified({ size = 22, title = "Verified owner of this Worlds" }: { size?: number; title?: string }) {
  // Twelve soft lobes around the centre.
  const lobes = 12;
  const R = 11.2;
  const r = 9.4;
  let d = "";
  for (let i = 0; i <= lobes * 2; i++) {
    const a = (Math.PI * i) / lobes - Math.PI / 2;
    const rad = i % 2 === 0 ? R : r;
    const x = 12 + Math.cos(a) * rad;
    const y = 12 + Math.sin(a) * rad;
    if (i === 0) d += `M${x.toFixed(2)} ${y.toFixed(2)}`;
    else {
      const pa = (Math.PI * (i - 0.5)) / lobes - Math.PI / 2;
      const prad = (R + r) / 2 + (i % 2 === 0 ? 0.9 : -0.9);
      d += ` Q${(12 + Math.cos(pa) * prad).toFixed(2)} ${(12 + Math.sin(pa) * prad).toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)}`;
    }
  }
  return (
    <span className="verified" role="img" aria-label={title} data-tip={title}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <defs>
          <linearGradient id="vf-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5fb2ff" />
            <stop offset="1" stopColor="#1d74f5" />
          </linearGradient>
          <linearGradient id="vf-shine" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${d}Z`} fill="url(#vf-body)" />
        <path d={`${d}Z`} fill="url(#vf-shine)" />
        <path d="M7.6 12.3l3 3 5.8-6.4" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
