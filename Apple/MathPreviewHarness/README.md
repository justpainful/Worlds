# Isolated native math preview

This XcodeGen project exists only for UI and accessibility investigation. It compiles the `WorldsMathSafePreview` source, `WorldsModels`, and the exact SwiftMath 1.7.3 dependency. It is not a product target and must not be packaged for distribution. Its content is a synthetic in-memory math node; it does not open or modify a Worlds database. The source editor applies changes only to that binding and keeps unknown fields. A real host would need access checks, conflict-safe persistence, undo and draft protection.

The preview gate accepts only a narrow LaTeX subset. Unsupported input remains visible and editable, without a false native rendering. SwiftMath output is not validated as KaTeX equivalent. Visual accuracy, screen reader behavior, Dynamic Type and Arabic coverage require Apple inspection. The MIT code license and the separate font notices are linked from `WorldsMathSafePreview/README.md`; a font-by-font audit and all distribution notices remain open. The harness does not authorize shipping any font or dependency in the product.

`MathPreviewUITests` is a simulator/macOS interaction with synthetic text and captures two screenshots. Its results, `MathSourceDocumentTests`, and all builds remain unverified until Apple CI runs.
