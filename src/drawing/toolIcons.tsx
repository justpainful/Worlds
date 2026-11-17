import type { ReactElement } from "react";
import type { Tool } from "./Stage";

/**
 * The drawing tools as small coloured objects: a pink eraser, a yellow marker, a
 * brush with a wooden handle. The toolbars show them, and the canvas cursor carries
 * the same icon so the tool in the hand is never a plain circle.
 *
 * Every icon is drawn on a 24 by 24 grid with its working tip at the lower left
 * corner (TIP), so the cursor can put the tip exactly on the point being drawn.
 */
export const TIP = { x: 3, y: 21 };

const OUT = "#2a2420";

const SHAPES: Record<Tool, ReactElement> = {
  select: (
    <path d="M5 3l13 7.6-5.6 1.3 3.4 6.4-2.6 1.4-3.4-6.5L5 17.6z" fill="#ffffff" stroke={OUT} strokeWidth="1.4" strokeLinejoin="round" />
  ),
  brush: (
    <g strokeLinejoin="round">
      <path d="M13.2 10.8l7.4-7.4a1.6 1.6 0 0 1 2.2 2.2l-7.4 7.4z" fill="#c98a4b" stroke={OUT} strokeWidth="1.2" />
      <path d="M11.4 11.6l2.2-1.4 2.2 2.2-1.4 2.2z" fill="#b9bcc4" stroke={OUT} strokeWidth="1.2" />
      <path d="M11.4 11.6c-3 0-4.4 1.6-4.8 4.2-.3 2-1.6 3.6-3.6 5.2 3.6.4 7.4-.4 9.6-2.6 1.6-1.6 1.9-3.6 1.4-4.6z" fill="#5a4a42" stroke={OUT} strokeWidth="1.2" />
    </g>
  ),
  eraser: (
    <g strokeLinejoin="round">
      <path d="M14.6 3.2a2 2 0 0 1 2.8 0l4.4 4.4a2 2 0 0 1 0 2.8l-8.6 8.6-7.2-7.2z" fill="#ef7f9e" stroke={OUT} strokeWidth="1.2" />
      <path d="M6 11.8l7.2 7.2-1.6 1.6a2 2 0 0 1-2.8 0L3.4 15.2a2 2 0 0 1 0-2.8z" fill="#fbd3df" stroke={OUT} strokeWidth="1.2" />
      <path d="M16.4 5.6l2.4 2.4" stroke="#fbd3df" strokeWidth="1.4" strokeLinecap="round" />
    </g>
  ),
  highlighter: (
    <g strokeLinejoin="round">
      <path d="M14 4.6l3-3a1.4 1.4 0 0 1 2 0l3.4 3.4a1.4 1.4 0 0 1 0 2L19.4 10z" fill="#5b6f66" stroke={OUT} strokeWidth="1.2" />
      <path d="M14 4.6l5.4 5.4-6.6 6.6-5.4-5.4z" fill="#f5d742" stroke={OUT} strokeWidth="1.2" />
      <path d="M7.4 11.2l5.4 5.4-2.8 1.2L6.2 14z" fill="#e8c21f" stroke={OUT} strokeWidth="1.2" />
      <path d="M6.2 14l3.8 3.8-3 3.2H3v-4z" fill="#f5d742" stroke={OUT} strokeWidth="1.2" />
    </g>
  ),
  laser: (
    <g>
      <circle cx="6" cy="18" r="5" fill="#ef3d35" opacity="0.22" />
      <path d="M8.6 15.4L20.2 3.8a1.8 1.8 0 0 1 2.6 2.6L11.2 18z" fill="#9aa0a8" stroke={OUT} strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="6" cy="18" r="2.6" fill="#ef3d35" stroke="#ffffff" strokeWidth="1" />
    </g>
  ),
  shape: (
    <g strokeLinejoin="round">
      <circle cx="15.4" cy="15.4" r="5.6" fill="#47a467" stroke={OUT} strokeWidth="1.2" />
      <path d="M9 3.4l6.4 11H2.6z" fill="#2b82de" stroke={OUT} strokeWidth="1.2" />
    </g>
  ),
  text: (
    <g>
      <rect x="2.6" y="2.6" width="18.8" height="18.8" rx="5" fill="#ffffff" stroke={OUT} strokeWidth="1.2" />
      <path d="M7.4 7.4h9.2M12 7.4v10" stroke={OUT} strokeWidth="2.4" strokeLinecap="round" />
    </g>
  ),
  redact: (
    <g strokeLinejoin="round">
      <rect x="2.6" y="8" width="18.8" height="8" rx="2" fill="#202023" stroke="#ffffff" strokeWidth="1" />
      <path d="M5.6 12h6" stroke="#5b5b61" strokeWidth="1.6" strokeLinecap="round" />
    </g>
  ),
  eyedropper: (
    <g strokeLinejoin="round">
      <path d="M15.6 3.6a2.6 2.6 0 0 1 3.7 0l1.1 1.1a2.6 2.6 0 0 1 0 3.7l-2.2 2.2-4.8-4.8z" fill="#8e8e93" stroke={OUT} strokeWidth="1.2" />
      <path d="M12.2 6.6l5.2 5.2-8.4 8.4-3.4 1-1.8-1.8 1-3.4z" fill="#bfe2f5" stroke={OUT} strokeWidth="1.2" />
      <path d="M5.4 16.4l3.4-3.4h4.2l-4 4z" fill="#2b82de" />
    </g>
  ),
  fill: (
    <g strokeLinejoin="round">
      <path d="M10.6 2.8l8.6 8.6-7 7a2.2 2.2 0 0 1-3.1 0l-5.5-5.5a2.2 2.2 0 0 1 0-3.1z" fill="#37b4b8" stroke={OUT} strokeWidth="1.2" />
      <path d="M5.2 10.8h12.6" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M4.2 16.6c-1.4 2-1.8 3.2-1.2 4 .6.8 1.8.6 2.2-.4.3-.8 0-1.8-1-3.6z" fill="#2b82de" stroke={OUT} strokeWidth="1" />
    </g>
  ),
  selection: (
    <g>
      <rect x="3" y="3" width="18" height="18" rx="2" fill="rgba(43,130,222,0.16)" stroke="#2b82de" strokeWidth="1.8" strokeDasharray="3.2 2.6" />
    </g>
  ),
};

export function ToolIcon({ tool, size = 22, className }: { tool: Tool; size?: number; className?: string }) {
  return (
    <svg className={`drawing-tool-icon ${className ?? ""}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {SHAPES[tool]}
    </svg>
  );
}
