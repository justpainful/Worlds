"""Reproduce only the lexical whitelist in MathPreviewGate; not SwiftMath parsing."""
import json
from pathlib import Path

def accepts(text):
    chars = text.encode("utf-8")
    if not chars or len(chars) > 512:
        return False
    i = depth = 0
    while i < len(chars):
        c = chars[i]
        if c == 92:
            i += 1
            if i >= len(chars): return False
            if chars[i] == 44:
                i += 1
                continue
            start = i
            while i < len(chars) and (65 <= chars[i] <= 90 or 97 <= chars[i] <= 122): i += 1
            if chars[start:i] not in (b"frac", b"sqrt", b"int"): return False
            continue
        if c == 123:
            depth += 1
            if depth > 12: return False
        elif c == 125:
            depth -= 1
            if depth < 0: return False
        elif not (48 <= c <= 57 or 65 <= c <= 90 or 97 <= c <= 122 or c in (32,9,10,13,43,45,61,40,41,91,93,42,47,94,95,46,44)):
            return False
        i += 1
    return depth == 0

for item in json.loads(Path(__file__).with_name("math-corpus.json").read_text(encoding="utf-8")):
    print(f"{item['id']}\t{'lexically-allowed' if accepts(item['latex']) else 'lexically-rejected'}")
