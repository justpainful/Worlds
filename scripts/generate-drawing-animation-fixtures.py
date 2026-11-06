"""Independent encoder and composited RGBA oracle. Requires Pillow.

Expected pixels come from Pillow seek/compositing, never Worlds' decoder.
"""
import base64
import io
import json
import struct
import zlib
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps

root = Path(__file__).resolve().parent.parent
out = root / '.lab/drawing-paste-fixtures'
out.mkdir(parents=True, exist_ok=True)
frames = []
for index in range(3):
    frame = Image.new('RGBA', (32, 24), (25, 40, 90, 255))
    draw = ImageDraw.Draw(frame)
    draw.rectangle((2 + index * 6, 3, 11 + index * 6, 12), fill=(230, 40 + index * 65, 20, 255))
    draw.rectangle((1, 18, 5, 22), fill=(40, 240, 60, 255))
    frames.append(frame)

cases = []
def png_oracle(raw):
    """Decode each PNG subframe independently, then apply fcTL with integer
    SOURCE/OVER and disposal arithmetic (W3C PNG 11.3.6.2). Pillow's APNG seek
    composites alpha using a mask and is not the oracle for partial-alpha OVER.
    The fixtures intentionally use RGBA8; no product parser is imported here.
    """
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    ihdr = raw[16:29]
    width, height = struct.unpack('>II', ihdr[:8])
    assert ihdr[8:10] == bytes([8, 6])
    controls, control, compressed = [], None, []
    offset = 8
    while offset < len(raw):
        size = struct.unpack('>I', raw[offset:offset + 4])[0]
        kind, data = raw[offset + 4:offset + 8], raw[offset + 8:offset + 8 + size]
        assert zlib.crc32(kind + data) == struct.unpack('>I', raw[offset + 8 + size:offset + 12 + size])[0]
        if kind == b'fcTL':
            if control is not None:
                controls.append((control, b''.join(compressed)))
            control, compressed = struct.unpack('>IIIIIHHBB', data), []
        elif kind == b'IDAT' and control is not None:
            compressed.append(data)
        elif kind == b'fdAT':
            compressed.append(data[4:])
        offset += size + 12
    controls.append((control, b''.join(compressed)))
    with Image.open(io.BytesIO(raw)) as original:
        orientation = original.getexif().get(274, 1)
    transpose = {2: Image.Transpose.FLIP_LEFT_RIGHT, 3: Image.Transpose.ROTATE_180,
                 4: Image.Transpose.FLIP_TOP_BOTTOM, 5: Image.Transpose.TRANSPOSE,
                 6: Image.Transpose.ROTATE_270, 7: Image.Transpose.TRANSVERSE,
                 8: Image.Transpose.ROTATE_90}
    canvas = bytearray(width * height * 4)
    result = []
    for control, compressed in controls:
        _, w, h, x, y, _, _, dispose, blend = control
        before = canvas[:]
        encoded = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>II', w, h) + ihdr[8:]) + chunk(b'IDAT', compressed) + chunk(b'IEND', b'')
        with Image.open(io.BytesIO(encoded)) as image:
            pixels = image.convert('RGBA').tobytes()
        for dy in range(h):
            for dx in range(w):
                source, target = (dy * w + dx) * 4, ((y + dy) * width + x + dx) * 4
                if blend == 0:
                    canvas[target:target + 4] = pixels[source:source + 4]
                else:
                    sa, da = pixels[source + 3], canvas[target + 3]
                    alpha = sa * 255 + da * (255 - sa)
                    for k in range(3):
                        numerator = pixels[source + k] * sa * 255 + canvas[target + k] * da * (255 - sa)
                        canvas[target + k] = (numerator + alpha // 2) // alpha if alpha else 0
                    canvas[target + 3] = (alpha + 127) // 255
        shown = Image.frombytes('RGBA', (width, height), bytes(canvas))
        if orientation in transpose:
            shown = shown.transpose(transpose[orientation])
        result.append(base64.b64encode(shown.tobytes()).decode())
        if dispose == 1:
            for dy in range(h):
                at = ((y + dy) * width + x) * 4
                canvas[at:at + w * 4] = bytes(w * 4)
        elif dispose == 2:
            canvas = before
    return result

def add(name, fmt, images, **options):
    stream = io.BytesIO()
    images[0].save(stream, format=fmt, save_all=True, append_images=images[1:], duration=[90] * len(images), loop=0, **options)
    raw = stream.getvalue()
    mime, ext = {'PNG': ('image/png', 'png'), 'WEBP': ('image/webp', 'webp'), 'GIF': ('image/gif', 'gif')}[fmt]
    golden = []
    with Image.open(io.BytesIO(raw)) as decoded:
        poster = 1 if decoded.info.get('default_image') else 0
        for index in range(poster, decoded.n_frames):
            decoded.seek(index)
            rgba = ImageOps.exif_transpose(decoded.convert('RGBA'))
            golden.append(base64.b64encode(rgba.tobytes()).decode())
        width, height = rgba.size
    if fmt == 'PNG':
        golden = png_oracle(raw)
    cases.append({'name': name, 'mime': mime, 'width': width, 'height': height, 'frameCount': len(golden), 'base64': base64.b64encode(raw).decode(), 'frames': golden})
    (out / (name + '.' + ext)).write_bytes(raw)

add('animated-webp', 'WEBP', frames, lossless=True, minimize_size=True)
add('animated-apng', 'PNG', frames, disposal=[0, 0, 0], blend=[0, 0, 0], optimize=True)
add('animated-gif', 'GIF', frames, disposal=[1, 2, 3], optimize=True)
alpha = []
for index in range(3):
    f = Image.new('RGBA', (32, 24), (0, 0, 0, 0))
    ImageDraw.Draw(f).rectangle((2 + index * 5, 4, 12 + index * 5, 17), fill=(40 + index * 90, 170, 60, 128 + index * 40))
    alpha.append(f)
add('animated-apng-blend-disposal', 'PNG', alpha, disposal=[0, 1, 2], blend=[0, 1, 1])
add('animated-apng-poster', 'PNG', [Image.new('RGBA', (32, 24), 'magenta')] + frames, default_image=True, disposal=[0, 0, 0], blend=[0, 0, 0])
exif = Image.Exif()
exif[274] = 6
add('animated-webp-oriented', 'WEBP', frames, lossless=True, exif=exif)
add('animated-apng-oriented', 'PNG', frames, exif=exif, disposal=[0, 0, 0], blend=[0, 0, 0])
(root / 'src/drawing/fixtures/animated-images.json').write_text(json.dumps({'generator': 'Pillow encoders; independent integer PNG SOURCE/OVER and fcTL disposal; Pillow GIF/WebP seek; independent EXIF transpose', 'images': cases}, indent=2) + '\n', encoding='utf-8')
print(f'{len(cases)} independent animated fixtures; {sum(c["frameCount"] for c in cases)} composited frames')
