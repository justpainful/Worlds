import json, math
L = json.load(open("lines.json")); ST = json.load(open("strokes.json"))
GAP = 3150; X1 = -120   # second line: down one line, a little to the left, like the reference
SPEED = 21000           # font units per second
PAUSE = 0.07
def length(pts): return sum(math.dist(pts[i], pts[i+1]) for i in range(len(pts) - 1))
t = 0.0; groups = []; clips = []
minx = 10**9; maxx = -10**9
for k, (line, st) in enumerate(zip(L["lines"], ST)):
    dx, dy = (0, 0) if k == 0 else (X1, GAP)
    w = round(st["width"] * 1.4)
    paths = []
    for pts in st["strokes"]:
        d = "M" + " L".join(f"{x} {y}" for x, y in pts)
        dur = max(0.06, length(pts) / SPEED)
        paths.append(f'<path d="{d}" data-t="{t:.2f}" data-d="{dur:.2f}" pathLength="1"/>')
        t += dur + PAUSE
        for x, _ in pts: minx = min(minx, x + dx); maxx = max(maxx, x + dx)
    clips.append(f'<clipPath id="hw{k}"><path d="{line["d"]}"/></clipPath>')
    groups.append(f'<g class="hw-line hw-l{k}" transform="translate({dx} {dy})"><path class="hw-fill" d="{line["d"]}"/><g clip-path="url(#hw{k})" stroke-width="{w}">{"".join(paths)}</g></g>')
top = 200; bottom = GAP + L["ascent"] - L["descent"] - 150
vb = f"{minx - 200} {top} {maxx - minx + 400} {bottom - top}"
svg = (f'<svg class="hw" viewBox="{vb}" role="img" aria-labelledby="hw-title" data-total="{t:.2f}">'
       f'<title id="hw-title">Hello, Worlds!</title><defs>{"".join(clips)}</defs>{"".join(groups)}</svg>')
open("hello.svg.html", "w", encoding="utf-8").write(svg)
print("total", round(t, 2), "s", "bytes", len(svg), "viewBox", vb)
