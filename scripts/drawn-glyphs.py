"""
Hand-drawn glyphs for the icons the bot emoji library has no drawing for
(text tools, arrows, panes, alignment). Same rules as the library: a coloured
fill, a thick ink edge, cream accents and a light diagonal grain.

    python scripts/drawn-glyphs.py      # writes src/assets/drawn/<set>/<name>.svg
"""
import os

INK = "#1a1a1f"
CREAM = "#FFF3D9"
SETS = {"gold": "#E8B01C", "teal": "#22A89D", "pink": "#FF9EC6", "blue": "#2F6EF2"}
W = 1.9  # ink width on the 24 unit grid

GRAIN = ('<defs><pattern id="g" patternUnits="userSpaceOnUse" width="1.6" height="1.6" patternTransform="rotate(-34)">'
         '<path d="M0 0V1.6" stroke="#20162C" stroke-width=".35" opacity=".2"/></pattern></defs>')


def shape(d, fill):
    return (f'<path d="{d}" fill="{fill}" stroke="{INK}" stroke-width="{W}" stroke-linejoin="round" stroke-linecap="round"/>'
            f'<path d="{d}" fill="url(#g)"/>')


def ribbon(d, col, w=2.6):
    return (f'<path d="{d}" fill="none" stroke="{INK}" stroke-width="{w + 2.2}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<path d="{d}" fill="none" stroke="{col}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>')


def line(d, w=1.7, col=INK):
    return f'<path d="{d}" fill="none" stroke="{col}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>'


def text(t, x, y, size, col=INK, weight=900):
    return (f'<text x="{x}" y="{y}" font-family="Segoe UI, Arial, sans-serif" font-size="{size}" font-weight="{weight}" '
            f'text-anchor="middle" fill="{col}">{t}</text>')


def tile(c):
    return shape("M4.5 3.5h15a1.8 1.8 0 0 1 1.8 1.8v13.4a1.8 1.8 0 0 1-1.8 1.8h-15a1.8 1.8 0 0 1-1.8-1.8V5.3a1.8 1.8 0 0 1 1.8-1.8z", c)


def panes(c, part):
    frame = shape("M3.5 4.5h17a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18V6a1.5 1.5 0 0 1 1.5-1.5z", CREAM)
    return frame + shape(part, c)


ARROW_R = "M3 9.4h9.6V5.2l8.4 6.8-8.4 6.8v-4.2H3z"
ARROW_L = "M21 9.4h-9.6V5.2L3 12l8.4 6.8v-4.2H21z"


def glyphs(c):
    return {
        "forward": shape(ARROW_R, c),
        "arrowRight": shape(ARROW_R, c),
        "arrowLeft": shape(ARROW_L, c),
        "chevronDown": ribbon("M6 9.5l6 6 6-6", c, 3),
        "more": "".join(shape(f"M{x} 12a2.3 2.3 0 1 0 4.6 0a2.3 2.3 0 1 0-4.6 0z", c) for x in (2.6, 9.7, 16.8)),
        "subpage": shape("M5 3h9l5 5v13H5z", CREAM) + line("M14 3v5h5") + ribbon("M8.5 11v4.5h6", c, 2.2) + shape("M14 13l3 2.5-3 2.5z", c),
        "unpin": shape("M9 3h6l-1 6 3 3H7l3-3z", c) + line("M12 12v8", 2.2) + line("M4 4l16 16", 2.4, "#E5484D"),
        "splitLeft": panes(c, "M3.5 4.5H9v15H3.5A1.5 1.5 0 0 1 2 18V6a1.5 1.5 0 0 1 1.5-1.5z"),
        "splitRight": panes(c, "M15 4.5h5.5A1.5 1.5 0 0 1 22 6v12a1.5 1.5 0 0 1-1.5 1.5H15z"),
        "sidebarClose": panes(c, "M3.5 4.5H9v15H3.5A1.5 1.5 0 0 1 2 18V6a1.5 1.5 0 0 1 1.5-1.5z") + line("M16.5 9.5L14 12l2.5 2.5", 1.9),
        "sidebarOpen": panes(c, "M3.5 4.5H9v15H3.5A1.5 1.5 0 0 1 2 18V6a1.5 1.5 0 0 1 1.5-1.5z") + line("M14 9.5l2.5 2.5-2.5 2.5", 1.9),
        "splitVertical": panes(c, "M12 4.5h8.5A1.5 1.5 0 0 1 22 6v12a1.5 1.5 0 0 1-1.5 1.5H12z"),
        "splitHorizontal": panes(c, "M2 12h20v6a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18z"),
        "tabs": panes(c, "M3.5 4.5h17A1.5 1.5 0 0 1 22 6v3H2V6a1.5 1.5 0 0 1 1.5-1.5z") + line("M9 4.5V9", 1.5),
        "video": shape("M3 6.5h12a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 16V8A1.5 1.5 0 0 1 3 6.5z", c) + shape("M16.5 10.5l5.5-3v9l-5.5-3z", CREAM),
        "h1": tile(c) + text("H1", 12, 16.3, 10),
        "h2": tile(c) + text("H2", 12, 16.3, 10),
        "h3": tile(c) + text("H3", 12, 16.3, 10),
        "text": tile(c) + text("T", 12, 17.2, 13),
        "typeTool": tile(c) + text("T", 12, 17.2, 13),
        "footnote": tile(c) + text("a", 10, 17.5, 11) + text("1", 16.5, 11, 7),
        "formula": tile(c) + text("Σ", 12, 17.2, 12),
        "numberedList": text("1", 4.2, 9, 6.5) + text("2", 4.2, 18, 6.5) + ribbon("M9 6.8h11", c, 2.4) + ribbon("M9 15.8h11", c, 2.4),
        "quote": shape("M4 7h6v6c0 3-2 5-5 5.5l-.5-2c1.6-.6 2.5-1.6 2.5-3.5H4z", c) + shape("M13.5 7h6v6c0 3-2 5-5 5.5l-.5-2c1.6-.6 2.5-1.6 2.5-3.5h-3z", c),
        "table": shape("M3 4.5h18v15H3z", CREAM) + shape("M3 4.5h18v4.5H3z", c) + line("M3 14h18M9 4.5v15M15 4.5v15", 1.5),
        "divider": ribbon("M3 12h18", c, 2.4) + shape("M10.2 12a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0z", CREAM),
        "highlight": shape("M14 3.5l6.5 6.5-8 8H6v-6z", c) + shape("M6 12v6h6", CREAM) + ribbon("M3 21.2h9", "#FFD63D", 2.2),
        "redo": ribbon("M19 9.5H9.5a5 5 0 0 0 0 10H12", c, 2.6) + shape("M16 5.5l4.5 4-4.5 4z", c),
        "external": shape("M4 6h9v3H7v8h8v-6h3v9H4z", CREAM) + shape("M13 3h8v8l-3-3-5 5-2-2 5-5z", c),
        "openExternal": shape("M4 6h9v3H7v8h8v-6h3v9H4z", CREAM) + shape("M13 3h8v8l-3-3-5 5-2-2 5-5z", c),
        "arrowUpRight": shape("M6 15.5L14.5 7H9V4h11v11h-3V9.5L8.5 18z", c),
        "alignLeft": ribbon("M4 6h15", c, 2.3) + ribbon("M4 12h10", c, 2.3) + ribbon("M4 18h13", c, 2.3),
        "alignCenter": ribbon("M4.5 6h15", c, 2.3) + ribbon("M7 12h10", c, 2.3) + ribbon("M5.5 18h13", c, 2.3),
        "alignRight": ribbon("M5 6h15", c, 2.3) + ribbon("M10 12h10", c, 2.3) + ribbon("M7 18h13", c, 2.3),
        "expand": "".join(ribbon(d, c, 2.4) for d in ("M4 9V4h5", "M15 4h5v5", "M20 15v5h-5", "M9 20H4v-5")),
        "whiteboard": shape("M3 4h18v12H3z", CREAM) + ribbon("M6.5 12l3-3 2.5 2 4.5-4.5", c, 2) + line("M8 16l-2 5M16 16l2 5M12 16v3", 1.7),
        "spellcheck": text("abc", 10.5, 11, 8.5, INK, 800) + ribbon("M9 17l3 3 8-8", c, 2.6),
        "shapes": shape("M3 13.5a4 4 0 1 0 8 0a4 4 0 1 0-8 0z", c) + shape("M13 10h8v8h-8z", CREAM) + shape("M10 2.5l4.5 7.5h-9z", c),
        "circle": shape("M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0z", c),
        "square": shape("M4 4h16v16H4z", c),
        "eraser": shape("M3.5 14.5l8-8 7 7-5 5H8.5z", "#FF9EC6") + shape("M11.5 6.5l4-4 7 7-4 4z", CREAM) + line("M8.5 18.5h12", 1.8),
    }


def main():
    for name, colour in SETS.items():
        out = f"src/assets/drawn/{name}"
        os.makedirs(out, exist_ok=True)
        for g, body in glyphs(colour).items():
            svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96">{GRAIN}{body}</svg>'
            with open(f"{out}/{g}.svg", "w", encoding="utf-8") as f:
                f.write(svg)
    print(len(glyphs("#000")), "glyphs in", len(SETS), "sets")


if __name__ == "__main__":
    main()
