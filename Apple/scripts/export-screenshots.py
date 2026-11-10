import json
import os
import re
import shutil
import subprocess
import sys

def main():
    if len(sys.argv) < 3:
        print("Usage: export-screenshots.py <xcresult_path> <output_dir>")
        sys.exit(0)

    xcresult_path = sys.argv[1]
    output_dir = sys.argv[2]

    if not os.path.exists(xcresult_path):
        print(f"xcresult does not exist: {xcresult_path}")
        sys.exit(0)

    named_dir = os.path.join(output_dir, "named")
    os.makedirs(named_dir, exist_ok=True)

    cmd = [
        "xcrun", "xcresulttool", "export", "attachments",
        "--path", xcresult_path,
        "--output-path", output_dir
    ]
    try:
        subprocess.run(cmd, check=True)
    except Exception as e:
        print(f"xcresulttool export failed: {e}")

    manifest_path = os.path.join(output_dir, "manifest.json")
    if not os.path.exists(manifest_path):
        print(f"manifest.json not found in {output_dir}")
        sys.exit(0)

    with open(manifest_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    copied = 0
    def walk(node):
        nonlocal copied
        if isinstance(node, dict):
            exp = node.get("exportedFileName")
            sug = node.get("suggestedHumanReadableName")
            if exp and sug:
                clean = re.sub(r"_[0-9]+_[0-9A-Fa-f-]+(\.[A-Za-z0-9]+)$", r"\1", sug)
                clean = re.sub(r"[^A-Za-z0-9._-]+", "_", clean)
                if clean.lower().endswith((".png", ".jpg", ".jpeg", ".heic")):
                    src = os.path.join(output_dir, exp)
                    dst = os.path.join(named_dir, clean)
                    if os.path.exists(src):
                        shutil.copy2(src, dst)
                        copied += 1
                        print(f"Saved screenshot: {clean}")
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(data)
    print(f"Total exported screenshots in {named_dir}: {copied}")

if __name__ == "__main__":
    main()
