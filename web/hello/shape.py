# Shape the two lines with HarfBuzz and write the filled outlines as SVG path data (font units, y down).
import sys, json
sys.stdout.reconfigure(encoding="utf-8")
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
FONT = r"C:\Users\kuroi\OneDrive\Desktop\SFWindows.27.0.1789118100\MacintoshSkeletalFilled.otf"
blob = hb.Blob.from_file_path(FONT); face = hb.Face(blob); font = hb.Font(face)
tt = TTFont(FONT); gs = tt.getGlyphSet(); order = tt.getGlyphOrder()
asc = tt["hhea"].ascent; desc = tt["hhea"].descent
out = {"upm": tt["head"].unitsPerEm, "ascent": asc, "descent": desc, "lines": []}
for text in sys.argv[1:]:
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True, "liga": True, "calt": True})
    x = 0; d = []
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        pen = SVGPathPen(gs)
        gs[order[info.codepoint]].draw(TransformPen(pen, (1, 0, 0, -1, x + pos.x_offset, asc - pos.y_offset)))
        d.append(pen.getCommands()); x += pos.x_advance
    out["lines"].append({"text": text, "width": x, "d": " ".join(d), "glyphs": [order[i.codepoint] for i in buf.glyph_infos]})
json.dump(out, open("lines.json", "w"))
for l in out["lines"]: print(l["text"], l["width"], l["glyphs"])
print("asc", asc, "desc", desc)
