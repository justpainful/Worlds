import json, math, sys
import numpy as np, cv2
from PIL import Image
R = json.load(open("raster.json")); S, OX, OY = R["S"], R["ox"], R["oy"]

def thin(img):
    # Zhang-Suen thinning, vectorised.
    im = img.astype(np.uint8).copy()
    while True:
        changed = False
        for step in (0, 1):
            p = np.pad(im, 1)
            P2, P3, P4, P5 = p[:-2,1:-1], p[:-2,2:], p[1:-1,2:], p[2:,2:]
            P6, P7, P8, P9 = p[2:,1:-1], p[2:,:-2], p[1:-1,:-2], p[:-2,:-2]
            nb = [P2,P3,P4,P5,P6,P7,P8,P9]
            B = sum(n.astype(int) for n in nb)
            A = sum(((nb[i] == 0) & (nb[(i+1) % 8] == 1)).astype(int) for i in range(8))
            if step == 0: c = (P2*P4*P6 == 0) & (P4*P6*P8 == 0)
            else: c = (P2*P4*P8 == 0) & (P2*P6*P8 == 0)
            m = (im == 1) & (B >= 2) & (B <= 6) & (A == 1) & c
            if m.any(): im[m] = 0; changed = True
        if not changed: return im

N8 = [(-1,0),(0,1),(1,0),(0,-1),(-1,1),(1,1),(1,-1),(-1,-1)]
def build(sk):
    pts = set(zip(*np.nonzero(sk)))
    adj = {}
    for (y, x) in pts:
        n4 = [(y+dy, x+dx) for dy, dx in N8[:4] if (y+dy, x+dx) in pts]
        nd = []
        for dy, dx in N8[4:]:
            q = (y+dy, x+dx)
            if q in pts and (y+dy, x) not in pts and (y, x+dx) not in pts: nd.append(q)
        adj[(y, x)] = n4 + nd
    return adj

def edges_of(adj, r):
    deg = {p: len(n) for p, n in adj.items()}
    nodes = [p for p in adj if deg[p] != 2]
    # cluster junction pixels that sit close together into one node
    nid = {}; cid = 0
    for p in nodes:
        if p in nid: continue
        stack = [p]; nid[p] = cid
        while stack:
            a = stack.pop()
            for b in nodes:
                if b not in nid and deg[b] >= 3 and deg[a] >= 3 and abs(a[0]-b[0]) + abs(a[1]-b[1]) <= r:
                    nid[b] = cid; stack.append(b)
        cid += 1
    edges = []; seen = set(); interior = set()
    for p in nodes:
        for q in adj[p]:
            if (p, q) in seen: continue
            path = [p, q]; prev, cur = p, q
            while cur not in nid:
                nxt = [z for z in adj[cur] if z != prev]
                if not nxt: break
                prev, cur = cur, nxt[0]; path.append(cur)
            seen.add((path[0], path[1])); seen.add((path[-1], path[-2]))
            inner = frozenset(path[1:-1]) or frozenset(path)
            if inner & interior: continue
            interior.update(inner)
            if cur in nid:
                a, b = nid[path[0]], nid[cur]
                if a == b and len(path) < r * 2: continue  # inside a junction cluster
                edges.append([a, b, path])
    # closed loops with no node at all
    covered = set(z for e in edges for z in e[2])
    # every pixel reachable from a node belongs to a traced edge or a junction
    stack = list(nid)
    while stack:
        a = stack.pop()
        for b in adj[a]:
            if b not in covered: covered.add(b); stack.append(b)
    covered.update(nid)
    for p in adj:
        if p in covered or deg[p] != 2: continue
        path = [p]; prev, cur = None, p
        while True:
            nxt = [z for z in adj[cur] if z != prev and (z not in path or (z == p and len(path) > 3))]
            if not nxt: break
            prev, cur = cur, nxt[0]
            if cur == p: path.append(p); break
            path.append(cur)
        covered.update(path)
        nid_loop = cid; cid += 1
        edges.append([nid_loop, nid_loop, path])
    pos = {}
    for p, i in nid.items(): pos.setdefault(i, []).append(p)
    pos = {i: (np.mean([a[0] for a in v]), np.mean([a[1] for a in v])) for i, v in pos.items()}
    return edges, pos, nid

def tangent(path, back):
    a = np.array(path[-1], float); b = np.array(path[max(0, len(path)-1-back)], float)
    d = a - b; n = np.hypot(*d); return d / n if n else d

def strokes(edges, pos, w):
    # prune short spurs ending at an endpoint
    for _ in range(2):
        count = {}
        for a, b, p in edges: count[a] = count.get(a, 0) + 1; count[b] = count.get(b, 0) + 1
        edges = [e for e in edges if not ((count[e[0]] == 1 or count[e[1]] == 1) and count[e[0]] + count[e[1]] >= 4 and len(e[2]) < 0.6 * w)]
    count = {}
    for a, b, p in edges: count[a] = count.get(a, 0) + 1; count[b] = count.get(b, 0) + 1
    used = [False] * len(edges); out = []; visited = set()
    def score(pt): return pt[1] + 0.8 * pt[0]  # top left first (x + 0.8 y)
    while not all(used):
        best = None
        for i, (a, b, p) in enumerate(edges):
            if used[i]: continue
            for node, path in ((a, p), (b, p[::-1])):
                free = count.get(node) == 1 or node in visited
                s = score(path[0]) - (10000 if free else 0)
                if best is None or s < best[0]: best = (s, i, path)
        _, i, path = best; used[i] = True; line = list(path)
        node = edges[i][1] if path[0] == edges[i][2][0] else edges[i][0]
        visited.update(edges[i][:2])
        while True:
            t = tangent(line, int(w))
            cand = []
            for j, (a, b, p) in enumerate(edges):
                if used[j]: continue
                for n0, n1, pp in ((a, b, p), (b, a, p[::-1])):
                    if n0 != node: continue
                    d = np.array(pp[min(len(pp)-1, int(w))], float) - np.array(pp[0], float)
                    d /= (np.hypot(*d) or 1)
                    cand.append((-float(t @ d), j, n1, pp))
            if not cand: break
            cand.sort(key=lambda c: c[0])
            ang, j, n1, pp = cand[0]
            if ang > -0.5: break   # would turn more than 60 degrees
            used[j] = True; line += pp[1:]; node = n1; visited.add(n1)
        out.append(line)
    return out

def rdp(pts, eps):
    if len(pts) < 3: return pts
    a, b = np.array(pts[0], float), np.array(pts[-1], float)
    ab = b - a; L = np.hypot(*ab)
    arr = np.array(pts, float)
    d = np.abs(ab[0] * (arr[:,1] - a[1]) - ab[1] * (arr[:,0] - a[0])) / L if L else np.hypot(*(arr - a).T)
    i = int(np.argmax(d))
    if d[i] > eps: return rdp(pts[:i+1], eps)[:-1] + rdp(pts[i:], eps)
    return [pts[0], pts[-1]]

result = []
for k in range(2):
    g = np.array(Image.open(f"line{k}.png").convert("L"))
    ink = (g < 128).astype(np.uint8)
    dt = cv2.distanceTransform(ink, cv2.DIST_L2, 5)
    sk = thin(ink)
    w = 2 * float(np.median(dt[sk == 1]))
    edges, pos, nid = edges_of(build(sk), int(w * 0.95))
    st = strokes(edges, pos, w)
    st = [s for s in st if len(s) > w * 0.3]
    n, lab = cv2.connectedComponents(ink)
    hit = set()
    for s_ in st:
        for p in s_: hit.add(lab[p])
    for c in range(1, n):
        if c in hit: continue
        ys, xs = np.nonzero(lab == c); cy, cx = ys.mean(), xs.mean()
        r = max(2.0, float(dt[lab == c].max()) * 0.45)
        dot = [(int(cy + r * math.sin(t)), int(cx + r * math.cos(t))) for t in np.linspace(-math.pi / 2, 1.5 * math.pi, 24)]
        # write the dot right after the stroke that ends nearest to it (the bar of "!")
        k_ = min(range(len(st)), key=lambda i: (st[i][-1][0] - cy) ** 2 + (st[i][-1][1] - cx) ** 2)
        st.insert(k_ + 1, dot)
    lines = []
    for s in st:
        s = rdp([(p[1], p[0]) for p in s], 1.2)
        lines.append([(round(x / S + OX), round(y / S + OY)) for x, y in s])
    result.append({"width": w / S, "strokes": lines})
    # debug picture: strokes coloured in order
    dbg = cv2.cvtColor((255 - ink * 60).astype(np.uint8), cv2.COLOR_GRAY2BGR)
    for i, s in enumerate(st):
        col = tuple(int(c) for c in cv2.applyColorMap(np.uint8([[int(255 * i / max(1, len(st) - 1))]]), cv2.COLORMAP_JET)[0, 0])
        pts = np.array([(p[1], p[0]) for p in s], np.int32)
        cv2.polylines(dbg, [pts], False, col, 6)
        cv2.circle(dbg, tuple(pts[0]), 18, col, -1); cv2.putText(dbg, str(i), tuple(pts[0] + [20, -20]), 0, 2, col, 4)
    cv2.imwrite(f"dbg{k}.png", dbg)
    print(k, "stroke width", round(w, 1), "strokes", len(st), [len(s) for s in st])
json.dump(result, open("strokes.json", "w"))
