# WorldsMedia scope

This module models the camelCase attachment record exposed by the Rust store. `AttachmentVault` opens stored relative paths beneath the user-selected attachment root using directory-relative `openat` calls, rejects traversal and symlink components, checks for a regular file, enforces size limits, and keeps the root's security scope active while the descriptor is in use. Reads validate the actual file size and bound memory. Access to a trusted root and its permissions is still the host application's responsibility. Hard links inside a trusted root are not identified as external content.

Implemented preview building blocks are ImageIO thumbnail decoding with dimensions and frame count, PDFKit documents, bounded UTF-8 text, bounded CSV and TSV parsing, and AVFoundation assets backed by a private temporary copy. Image previews show the first frame only. Creating an AVURLAsset does not prove that a codec is playable; the caller must check playback availability. The temporary media lease must live until playback ends. No file-provider coordination or remote attachment transfer is provided.

DOCX, XLSX, XLS, ODS, PPTX, presentation conversion, GIF animation, arbitrary encodings, SVG, HLS, and the full range supported by the original application are not implemented. Classification is only a hint and does not authenticate content. There is no import, attachment database mutation, account authorization, gallery workflow, or UI in this module. CSV cells are plain data and formulas are not evaluated.

Tests use isolated temporary data and exercise traversal, symlink rejection, bounded reads, plain CSV, real image decoding and temporary-copy cleanup. Six tests passed on macOS in Actions run 42387357673. The module is included in SwiftPM but is not connected to app navigation.

## Isolated import staging

`AttachmentImport.stage` makes a private, bounded temporary copy of a selected regular file, holds security-scoped access during the copy, rejects a symlink at the selected path, and removes the temporary directory when the returned lease is released. It follows the original 1 GiB limit and display-name cleanup, with tests using temporary files. The implementation does not use `NSFileCoordinator`, does not guarantee a consistent snapshot if the source changes during copying, and does not validate parent path symlinks or hard links. A security scope is not an authorization decision.

This is preparation only: it does not insert attachment metadata, store under the original month/ID path, compute the original MIME and image dimensions, index a page, synchronize files, export, or check workspace authorization. Do not connect it to user data until those operations have an audited, transactional integration and appropriate permission checks. The temporary file is not durable and may be removed when its lease deinitializes. Tests have been written but require execution on an Apple runner; they have not been run in this Windows environment.
