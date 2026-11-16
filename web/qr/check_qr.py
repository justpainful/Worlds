"""Checks that the drawn QR code still reads, the way a phone camera sees it.

Renders web/site/media/qr/enterworlds-qr.svg with Edge, then decodes it with
OpenCV's two readers after shrinking, blurring, tilting, rotating and JPEG
compression. Prints each case and fails if any reads wrong or not at all.

    python web/qr/check_qr.py
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SVG = ROOT / "web/site/media/qr/enterworlds-qr.svg"
URL = json.loads((SVG.parent / "qr.json").read_text())["url"]
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


def render(width: int) -> np.ndarray:
    meta = json.loads((SVG.parent / "qr.json").read_text())
    height = round(width * meta["height"] / meta["width"])
    with tempfile.TemporaryDirectory() as d:
        page = Path(d) / "qr.html"
        png = Path(d) / "qr.png"
        page.write_text(f'<html><body style="margin:0;background:#fff"><img src="{SVG.as_uri()}" width="{width}" height="{height}"></body></html>', encoding="utf-8")
        subprocess.run([EDGE, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--window-size={width},{height}", f"--screenshot={png}", "--force-device-scale-factor=1", page.as_uri()], check=True, capture_output=True)
        return cv2.imread(str(png))


def readers(img: np.ndarray) -> list[str]:
    out = []
    for det in (cv2.QRCodeDetector(), cv2.QRCodeDetectorAruco()):
        try:
            text = det.detectAndDecode(img)[0]
        except cv2.error:
            text = ""
        out.append(text)
    return out


def cases(base: np.ndarray):
    h, w = base.shape[:2]
    yield "as drawn", base
    for target in (420, 300, 220, 160):
        s = target / w
        yield f"{target}px wide", cv2.resize(base, (target, round(h * s)), interpolation=cv2.INTER_AREA)
    yield "blurred", cv2.GaussianBlur(base, (0, 0), 2.2)
    for angle in (-12, 9):
        m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1)
        yield f"rotated {angle}", cv2.warpAffine(base, m, (w, h), borderValue=(255, 255, 255))
    yield "turned sideways", cv2.rotate(base, cv2.ROTATE_90_CLOCKWISE)
    yield "upside down", cv2.rotate(base, cv2.ROTATE_180)
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = np.float32([[w * 0.08, h * 0.04], [w * 0.95, 0], [w, h], [0, h * 0.94]])
    yield "seen at an angle", cv2.warpPerspective(base, cv2.getPerspectiveTransform(src, dst), (w, h), borderValue=(255, 255, 255))
    ok, jpg = cv2.imencode(".jpg", base, [cv2.IMWRITE_JPEG_QUALITY, 35])
    yield "JPEG 35", cv2.imdecode(jpg, cv2.IMREAD_COLOR)
    dim = (base.astype(np.float32) * 0.6 + 40).clip(0, 255).astype(np.uint8)
    yield "dim light", dim


def main() -> int:
    base = render(900)
    failed = 0
    for name, img in cases(base):
        got = readers(img)
        ok = any(g == URL for g in got) and all(g in ("", URL) for g in got)
        print(f"{'ok ' if ok else 'BAD'}  {name:18} {got}")
        failed += not ok
    print("all read" if not failed else f"{failed} cases did not read")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
