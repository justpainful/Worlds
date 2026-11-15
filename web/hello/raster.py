import json, subprocess, os
L = json.load(open("lines.json")); S = 0.25; H = int((L["ascent"] - L["descent"]) * S) + 40
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
for i, line in enumerate(L["lines"]):
    W = int(line["width"] * S) + 200
    html = f'<html><body style="margin:0;background:#fff"><svg width="{W}" height="{H}" viewBox="-400 -80 {W/S} {H/S}"><path fill="#000" d="{line["d"]}"/></svg></body></html>'
    open(f"line{i}.html", "w").write(html)
    png = os.path.abspath(f"line{i}.png")
    subprocess.run([EDGE, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--window-size={W},{H}", f"--screenshot={png}", "--force-device-scale-factor=1", "file:///" + os.path.abspath(f"line{i}.html").replace("\\", "/")], check=True, capture_output=True)
    print(png, W, H)
json.dump({"S": S, "ox": -400, "oy": -80}, open("raster.json", "w"))
