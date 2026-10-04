import type { CSSProperties } from "react";
import { PRODUCT_ICONS, type ProductIconName } from "../assets/product-icons";
import { fileUrl } from "../lib/api";

export type { ProductIconName };
export const PRODUCT_ICON_NAMES = Object.keys(PRODUCT_ICONS) as ProductIconName[];

/**
 * A miniature product render (the Apple-style app icon set).
 * The simplified "-sm" artwork is used at 32px and below so small icons stay crisp.
 */
export function ProductIcon({ name, size = 20, className = "", style }: { name: ProductIconName; size?: number; className?: string; style?: CSSProperties }) {
  const art = PRODUCT_ICONS[name];
  if (!art) return null;
  return (
    <img
      src={size <= 32 ? art.small : art.full}
      width={size}
      height={size}
      alt=""
      draggable={false}
      className={`product-icon ${className}`}
      style={style}
    />
  );
}

export function isProductIcon(name: string): name is ProductIconName {
  return name in PRODUCT_ICONS;
}

/** Renders an icon reference: "pi:<product icon>", "img:<attachment id>" or an emoji. */
export function RefIcon({ value, size = 20, className = "" }: { value?: string; size?: number; className?: string }) {
  if (!value) return null;
  if (value.startsWith("pi:")) {
    const n = value.slice(3);
    return isProductIcon(n) ? <ProductIcon name={n} size={size} className={className} /> : null;
  }
  if (value.startsWith("img:")) {
    return <img src={fileUrl(value.slice(4))} width={size} height={size} alt="" draggable={false} className={`ref-icon-img ${className}`} style={{ borderRadius: size * 0.24 }} />;
  }
  return (
    <span className={`ref-icon-emoji ${className}`} style={{ fontSize: size * 0.82, width: size, height: size }}>
      {value}
    </span>
  );
}
