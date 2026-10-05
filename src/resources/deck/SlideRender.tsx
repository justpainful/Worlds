import type { CSSProperties, ReactNode } from "react";
import { fileUrl } from "../../lib/api";
import { placeholderHint, STAGE_H, STAGE_W, type Slide, type SlideElement } from "./model";

/** Box style for an element on the 1280 x 720 stage. */
export function boxStyle(el: SlideElement): CSSProperties {
  return {
    left: el.x,
    top: el.y,
    width: el.w,
    height: el.h,
    rotate: el.rot ? `${el.rot}deg` : undefined,
    opacity: el.opacity ?? 1,
  };
}

export function textStyle(el: SlideElement): CSSProperties {
  const s = el.style;
  return {
    fontSize: s?.fontSize ?? 32,
    fontWeight: s?.fontWeight ?? 500,
    color: s?.color,
    textAlign: s?.align ?? "left",
    fontFamily: s?.font ? `"${s.font}", var(--font-ui)` : "var(--font-ui)",
    fontStyle: s?.italic ? "italic" : undefined,
  };
}

/** The visible content of one element (no editing chrome). */
export function ElementBody({ el, editing, showHints, children }: { el: SlideElement; editing?: boolean; showHints?: boolean; children?: ReactNode }) {
  switch (el.type) {
    case "text":
      if (editing) return <>{children}</>;
      return (
        <div className={`sl-text ${!el.text && el.role ? "is-placeholder" : ""}`} style={textStyle(el)} dir="auto">
          {el.text || (showHints && el.role ? placeholderHint(el) : "")}
        </div>
      );
    case "image":
      return el.attachmentId ? <img className="sl-media" src={fileUrl(el.attachmentId)} alt="" draggable={false} style={{ objectFit: el.fit ?? "cover" }} /> : <div className="sl-empty-media">Picture</div>;
    case "video":
      return el.attachmentId ? <video className="sl-media" src={fileUrl(el.attachmentId)} controls={!showHints} muted={showHints} playsInline style={{ objectFit: el.fit ?? "contain" }} /> : <div className="sl-empty-media">Video</div>;
    case "shape":
      if (el.shape === "line") return <div className="sl-line" style={{ background: el.stroke ?? el.fill ?? "#fff" }} />;
      return <div className="sl-shape" style={{ background: el.fill ?? "#d2a46e", borderRadius: el.shape === "ellipse" ? "50%" : el.radius ?? 0, boxShadow: el.stroke ? `inset 0 0 0 2px ${el.stroke}` : undefined }} />;
  }
}

/** A whole slide at stage size; scale it with `scale`. */
export function SlideRender({ slide, scale = 1, showHints = false, className = "" }: { slide: Slide; scale?: number; showHints?: boolean; className?: string }) {
  return (
    <div className={`sl-frame ${className}`} style={{ width: STAGE_W * scale, height: STAGE_H * scale }}>
      <div className="sl-stage" style={{ width: STAGE_W, height: STAGE_H, scale: String(scale), background: slideBackground(slide) }}>
        {slide.elements.map((el) => (
          <div key={el.id} className={`sl-el sl-${el.type}`} style={boxStyle(el)}>
            <ElementBody el={el} showHints={showHints} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function slideBackground(slide: Slide): string {
  const b = slide.background;
  if (b.attachmentId) return `center / cover no-repeat url("${fileUrl(b.attachmentId)}"), ${b.color}`;
  return b.color;
}
