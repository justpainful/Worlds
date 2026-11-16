"""The enterworlds.space QR code, drawn in Worlds' hand.

Each horizontal run of dark modules is one rounded pen stroke, like the
handwriting on the front page: the top half in clay (Hello,) and the bottom
half in green (Worlds!). The three finder patterns take the shape of the
Worlds icon plate. Under the code, "Hello, Worlds!" in the same hand.

    python web/qr/make_qr.py   writes web/site/media/qr/enterworlds-qr.svg

Needs OpenCV (cv2) for the QR matrix. Check every change with
web/qr/check_qr.py: it renders the SVG and decodes it at many sizes.
"""
import json
import re
from pathlib import Path

import cv2
import numpy as np

URL = "https://enterworlds.space"
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web/site/media/qr"

CREAM = "#f9f1e8"
CLAY = "#b4513c"  # the site's --terra-ink: dark enough on cream for any camera
GREEN = "#24706b"  # --teal
INK = "#2a2420"
LABEL = "#5b6f66"

U = 10  # one module
QUIET = 4  # modules of empty margin every reader needs
INSET = 0.9  # the stroke leaves this much of a module on each side (thickness = U - 2 * INSET)
EYE = 0.06  # corner rounding of the finder patterns, as a share of their size


def matrix() -> np.ndarray:
    p = cv2.QRCodeEncoder.Params()
    p.correction_level = cv2.QRCodeEncoder_CORRECT_LEVEL_H
    img = cv2.QRCodeEncoder.create(p).encode(URL)
    ys, xs = np.where(img == 0)
    return (img[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1] == 0).astype(np.uint8)


def alignment_centres(n: int) -> list[tuple[int, int]]:
    version = (n - 17) // 4
    if version < 2:
        return []
    # Positions for versions 2 to 6 (enough for this short address).
    table = {2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34]}
    pos = table[version]
    out = []
    for r in pos:
        for c in pos:
            if (r, c) in [(6, 6), (6, pos[-1]), (pos[-1], 6)]:
                continue
            out.append((r, c))
    return out


def squircle(x: float, y: float, s: float, k: float = 0.36) -> str:
    """A rounded square with the softer corners of the Worlds icon plate."""
    r = s * k
    c = r * 0.45  # a longer handle than a circle gives the squircle look
    return (
        f"M{x + r:.2f} {y:.2f}H{x + s - r:.2f}C{x + s - c:.2f} {y:.2f} {x + s:.2f} {y + c:.2f} {x + s:.2f} {y + r:.2f}"
        f"V{y + s - r:.2f}C{x + s:.2f} {y + s - c:.2f} {x + s - c:.2f} {y + s:.2f} {x + s - r:.2f} {y + s:.2f}"
        f"H{x + r:.2f}C{x + c:.2f} {y + s:.2f} {x:.2f} {y + s - c:.2f} {x:.2f} {y + s - r:.2f}"
        f"V{y + r:.2f}C{x:.2f} {y + c:.2f} {x + c:.2f} {y:.2f} {x + r:.2f} {y:.2f}Z"
    )


def code_svg(m: np.ndarray, ox: float, oy: float) -> str:
    n = m.shape[0]
    reserved = np.zeros_like(m, dtype=bool)
    eyes = [(0, 0), (0, n - 7), (n - 7, 0)]
    for r, c in eyes:
        reserved[max(0, r - 1) : r + 8, max(0, c - 1) : c + 8] = True
    aligns = alignment_centres(n)
    for r, c in aligns:
        reserved[r - 2 : r + 3, c - 2 : c + 3] = True
    parts = []
    half = n // 2
    for r in range(n):
        colour = CLAY if r <= half else GREEN
        c = 0
        while c < n:
            if m[r, c] and not reserved[r, c]:
                start = c
                while c < n and m[r, c] and not reserved[r, c]:
                    c += 1
                x = ox + start * U + INSET
                y = oy + r * U + INSET
                w = (c - start) * U - 2 * INSET
                h = U - 2 * INSET
                parts.append(f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" rx="{h / 2:.2f}" fill="{colour}"/>')
            else:
                c += 1
    for r, c in eyes:
        x, y = ox + c * U, oy + r * U
        # Outer ring (7 modules) and centre (3 modules). Readers find the code by
        # these corners, so they stay nearly square (check_qr.py fails above about
        # 0.1); the centre carries the colour of its half, like the strokes.
        centre = GREEN if r > 0 else CLAY
        parts.append(f'<path d="{squircle(x, y, 7 * U, EYE)} {squircle(x + U, y + U, 5 * U, EYE)}" fill="{INK}" fill-rule="evenodd"/>')
        parts.append(f'<path d="{squircle(x + 2 * U, y + 2 * U, 3 * U, EYE)}" fill="{centre}"/>')
    for r, c in aligns:
        x, y = ox + (c - 2) * U, oy + (r - 2) * U
        parts.append(f'<path d="{squircle(x, y, 5 * U)} {squircle(x + U, y + U, 3 * U)}" fill="{INK}" fill-rule="evenodd"/>')
        parts.append(f'<circle cx="{x + 2.5 * U:.2f}" cy="{y + 2.5 * U:.2f}" r="{0.55 * U:.2f}" fill="{INK}"/>')
    return "\n".join(parts)


def hello_svg() -> tuple[str, list[float]]:
    """The two handwritten lines from the front page, as plain filled paths."""
    src = (ROOT / "web/content/hello.svg").read_text(encoding="utf-8")
    vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', src).group(1).split()]
    groups = re.findall(r'<g class="hw-line hw-l(\d)" transform="translate\(([-\d.]+) ([-\d.]+)\)"><path class="hw-fill" d="([^"]+)"', src)
    paths = []
    for line, tx, ty, d in groups:
        colour = CLAY if line == "0" else GREEN
        paths.append(f'<path transform="translate({tx} {ty})" d="{d}" fill="{colour}"/>')
    return "\n".join(paths), vb


def main() -> None:
    m = matrix()
    n = m.shape[0]
    size = (n + 2 * QUIET) * U
    pad = 24
    width = size + 2 * pad
    hello, vb = hello_svg()
    hello_w = size * 0.74
    scale = hello_w / vb[2]
    hello_h = vb[3] * scale
    top = pad
    code_y = top
    hello_y = code_y + size - 6
    label_y = hello_y + hello_h + 30
    height = label_y + 26
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} {height:.0f}" width="{width:.0f}" height="{height:.0f}" role="img" aria-label="QR code for {URL}">
<title>enterworlds.space</title>
<rect width="{width:.0f}" height="{height:.0f}" rx="36" fill="{CREAM}"/>
{code_svg(m, pad + QUIET * U, code_y + QUIET * U)}
<g transform="translate({(width - hello_w) / 2:.2f} {hello_y:.2f}) scale({scale:.5f}) translate({-vb[0]:.2f} {-vb[1]:.2f})">
{hello}
</g>
<text x="{width / 2:.1f}" y="{label_y:.1f}" text-anchor="middle" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="17" font-weight="500" fill="{LABEL}">enterworlds.space</text>
</svg>
"""
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "enterworlds-qr.svg").write_text(svg, encoding="utf-8")
    json.dump({"url": URL, "modules": n, "width": width, "height": height}, open(OUT / "qr.json", "w"))
    print(f"{n}x{n} modules, {width:.0f}x{height:.0f}")


if __name__ == "__main__":
    main()
