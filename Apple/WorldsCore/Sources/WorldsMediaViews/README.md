# WorldsMediaViews scope

This independent SwiftUI preview uses WorldsMedia and the authorized attachment root. It provides an image thumbnail with pinch zoom and scrolling, PDFKit viewing, selectable UTF-8 text, a bounded CSV/TSV grid, and AVKit playback when AVFoundation reports the media playable. It displays loading, failure and unsupported states and offers a back action. Animated image preview shows the first frame only. Image thumbnails are bounded to 2048 pixels by WorldsMedia, so zoom is not a full-resolution renderer.

Sharing is initiated explicitly: the module makes a private temporary copy and presents a system ShareLink. The copy is kept by the model while the preview exists and removed when the model is released. The system share flow has no completion callback in this implementation, so the host must ensure the model remains alive until the recipient finishes reading. Share copies and playback copies are limited to 512 MiB; copied names do not preserve the original filename. Do not enable this sharing flow until that lifecycle is verified on device and with external destinations.

DOCX, XLSX, ODS, PPTX, SVG, HLS, arbitrary encodings, large-file streaming, animated GIF playback, file-provider coordination and remote attachment transfer are not implemented. Codec compatibility depends on AVFoundation. The attachment record and its root must already be authorized by the host. The module does not enforce shared-workspace ACLs or connect to app navigation.

Synthetic model tests do not verify visible UI layout, image zoom gestures, PDF interaction, system share-sheet lifetime, audio controls or playback on actual devices. This module has not been compiled on Apple, added to Package.swift or connected to the app.
