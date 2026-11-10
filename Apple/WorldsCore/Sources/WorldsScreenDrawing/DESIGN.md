# Screen drawing design decisions

- Subject: annotate a single frozen macOS display capture during study or review.
- Product vocabulary: Worlds drawing, pen, highlighter, eraser and laser. The frozen image fills the selected display; the controls stay small and readable over it.
- Palette: controls use native system window background and foreground; ink defaults to #E5484D, highlighter #F5C842, laser #007AFF, and white for the close affordance when system appearance calls for it. These are defaults, not a new product identity.
- Typography: system control font and native labels, scaled by macOS accessibility settings.
- Geometry: one compact toolbar with native buttons and color control, with a separate visible close control. The picture stays unobstructed except for this toolbar.
- Motion: no required animation; the laser fades according to elapsed time. Reduce Motion can disable that fade before integration.
- States: permission absent, display disconnected, capture failed, image ready, drawing, and closed. Escape and close both dismiss the window.
- Scope: no mock screenshot content in production, no automatic capture, and no attempt to pause another app. A displayed capture is a still image, so the underlying video continues.
- Verification: only generated images and injected fake capture sources in tests. UI and actual screen permission require later macOS review.
