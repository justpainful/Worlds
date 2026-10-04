import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";

/**
 * Image that is careful with animated GIFs: it plays only while visible.
 * Off-screen it swaps to a still of the first frame, so a long page full
 * of GIFs does not keep decoding all of them.
 */
export function SmartImage({ src, animated, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { animated?: boolean }) {
  const ref = useRef<HTMLImageElement>(null);
  const [still, setStill] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!animated || !ref.current) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "120px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [animated]);

  const capture = () => {
    const img = ref.current;
    if (!animated || still || !img || !img.naturalWidth) return;
    try {
      const c = document.createElement("canvas");
      const scale = Math.min(1, 900 / img.naturalWidth);
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      setStill(c.toDataURL("image/webp", 0.85));
    } catch {
      /* tainted: just keep animating */
    }
  };

  const shown = animated && !visible && still ? still : src;
  return <img ref={ref} src={shown} crossOrigin="anonymous" onLoad={capture} decoding="async" draggable={false} {...rest} />;
}
