# Brush tip dimension preflight

Brush tips retain their original bytes. Before invoking the browser decoder, Worlds reads the encoded dimensions and enforces the 16 MiB file and 2048px side limits. The reader skips bounded chunks/segments without decompressing pixel data. PNG/APNG and WebP animation is rejected explicitly because a brush tip is a static image. JPEG baseline/progressive markers, BMP core/info headers, and WebP lossy/lossless/extended headers are supported. Both the extended WebP canvas and its actual image bitstream are checked. Embedded JPEG/PNG compression inside BMP is outside this static BMP reader.

The browser performs final image validation and decoding. Header preflight is not a replacement for codec validation or evidence of a measured whole-process memory ceiling. Decoder failure does not import an attachment; an unexpectedly oversized decoded bitmap is closed and refused.

Primary layout references:

- [W3C PNG specification, IHDR and chunk layout](https://www.w3.org/TR/png-3/#11IHDR).
- [libjpeg-turbo marker reader, SOF dimensions](https://github.com/libjpeg-turbo/libjpeg-turbo/blob/main/src/jdmarker.c).
- [WebP RIFF container, VP8X and padding](https://developers.google.com/speed/webp/docs/riff_container).
- [WebP lossless header](https://developers.google.com/speed/webp/docs/webp_lossless_bitstream_specification).
- [VP8 key-frame dimensions, RFC 6386 section 9.1](https://datatracker.ietf.org/doc/html/rfc6386#section-9.1).
- [Microsoft BITMAPFILEHEADER](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-bitmapfileheader), [BITMAPCOREHEADER](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-bitmapcoreheader), and [BITMAPINFOHEADER](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-bitmapinfoheader).

The seven constant-color encoded fixtures in src/drawing/fixtures/image-headers.json were produced independently with Pillow. Tests also cover malformed/truncated structures, mismatched MIME, giant declared dimensions, an oversized WebP bitstream hidden behind a small extended canvas, animation refusal and decoder cleanup. Browser decode evidence belongs in PROGRESS.md.


Drawing image paste/import reuses the bounded header reader with a separate256MiB encoded-size,1-million-pixel side and64-million-pixel area budget. Its HTML image decoder is invoked only after preflight and is disposed on mismatch/cancellation. This does not change brush-tip limits. Supported still-file originals remain byte-for-byte intact; the decoded browser source is only a temporary preview.

EXIF IFD0 Orientation is read from JPEG APP1, PNG eXIf and WebP EXIF metadata. Rotated orientations5-8 exchange the expected displayed width/height; the browser codec applies the orientation once. This follows [HTML naturalWidth/naturalHeight orientation semantics](https://html.spec.whatwg.org/multipage/embedded-content.html#dom-img-naturalwidth), [TIFF6 directory/header layout](https://www.itu.int/itudoc/itu-t/com16/tiff-fx/docs/tiff6.pdf), and [CIPA Orientation tag definitions](https://cipa.jp/std/documents/e/DC-X010-2017.pdf). Optional malformed TIFF metadata is ignored; the actual codec must still decode at the checked logical dimensions. No EXIF bytes are rewritten. Ten Pillow-encoded orientation fixtures cover all JPEG orientations and rotated PNG/WebP; browser verification must establish the actual codec behavior.
