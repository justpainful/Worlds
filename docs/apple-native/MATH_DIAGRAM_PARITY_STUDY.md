# Math and diagrams: source audit and native parity gaps

This is a partial, reproducible audit, not a feature-completeness estimate. The native experiments are not connected to the shipping app. Parsing an example is not proof of correct rendering, editing, accessibility, or synchronization.

## Existing behavior

`src/editor/extensions/pages4.ts` defines `mathInline` and `mathBlock` with a `latex` attribute and a Mermaid node with a `code` attribute. `src/editor/views/Pages4Views.tsx` edits the actual source. It renders math with KaTeX using `displayMode`, `throwOnError: true`, `strict: "ignore"`, `trust: false`, and `output: "htmlAndMathml"`, with an error fallback. Mermaid uses strict security and dark theme. Versions in `pnpm-lock.yaml` are KaTeX 0.19.0 and Mermaid 12.1.0. The default diagram is `flowchart LR` with three linked nodes. This audit does not establish every editor interaction or complete syntax coverage.

## Isolated source-library probes

The synthetic corpora and runners are in [math-diagram-audit](math-diagram-audit/). On Windows, the isolated probes were run against npm KaTeX 0.19.0 and Mermaid 12.1.0, using Chrome for Mermaid. They do not access user content or execute as part of the app.

* KaTeX accepted all 20 selected math examples, including the two placeholders in the original view. The script uses display mode for its corpus; this does not verify inline layout. The native experiment's separately reproduced lexical whitelist accepted 4 and rejected 16 of those strings. That whitelist is only the first gate: an accepted string may still fail SwiftMath parsing or render differently. In particular, the original inline placeholder contains `\\pi`, which the current whitelist rejects. This curated set is not representative enough to calculate feature parity.
* Mermaid's `parse` accepted all 20 selected examples, including the default, styled graphs, subgraphs, sequences, state and class diagrams, cycles, and a rank-skipping edge. Parsing is not rendering: it does not establish that each example's style, interactivity, labels, accessibility, or visual output works under the original security settings.
* `WorldsNativeDiagrams` explicitly supports only a bounded, strict subset of simple flowcharts. It rejects unsupported syntax instead of silently removing it. Its validation and rendering have not yet been run on Apple for this audit. It is not a replacement for Mermaid.

For reproduction, install `katex@0.19.0` in a temporary npm prefix and set `WORLDS_KATEX_MODULES` to its `node_modules` directory, then run `node docs/apple-native/math-diagram-audit/run-katex.cjs` and `python docs/apple-native/math-diagram-audit/run-lexical-gate.py`. Separately install `mermaid@12.1.0`, `esbuild`, and `playwright-core` in another temporary prefix, set `WORLDS_MERMAID_MODULES` and `WORLDS_CHROME_PATH`, and run `node docs/apple-native/math-diagram-audit/run-mermaid.cjs`. The temporary JavaScript tooling is a source oracle only; it is not an app runtime or UI.

## Dependencies and limits

[SwiftMath 1.7.3](https://github.com/mgriebling/SwiftMath/tree/1.7.3) is an experimental math renderer, not KaTeX. Its documented input and font support are narrower. Its [code license](https://github.com/mgriebling/SwiftMath/blob/1.7.3/LICENSE) does not settle distribution terms for every bundled font: review the separately supplied [GUST font license](https://github.com/mgriebling/SwiftMath/blob/1.7.3/Sources/SwiftMath/mathFonts.bundle/GUST-FONT-LICENSE.txt), [STIX/OFL license](https://github.com/mgriebling/SwiftMath/blob/1.7.3/Sources/SwiftMath/mathFonts.bundle/OFL.txt), exact font mapping, and required notices before distribution. The isolated MathPreviewHarness includes this dependency for testing; the product does not.

[MermaidKit 2.10.2](https://github.com/2389-research/MermaidKit/tree/v2.10.2) documents incomplete syntax and intentionally ignored behavior. Its [diagnostics](https://github.com/2389-research/MermaidKit/blob/v2.10.2/Sources/MermaidLayout/ParseDiagnostics.swift) do not identify every deliberately ignored style. Therefore it cannot establish full Mermaid compatibility by accepting input. It remains outside the product.

## Work required for parity

1. Build a broader, version-pinned corpus from synthetic examples and, only with authorization, sanitized real documents. Preserve the complete source and all node attributes. Cover inline and block math, errors, editor shortcuts, Markdown input and paste rules, and every diagram family actually used.
2. Use the original pinned libraries only as an isolated development and CI oracle. Compare diagnostics and rendered semantic output, not just parser acceptance. Capture reference images and accessibility information on Apple devices, including Arabic, mixed direction, Dynamic Type, dark and light modes, and export. Keep untrusted content subject to the original security policy.
3. Implement a native Mermaid-compatible parser and explicit AST that retains graph structure, labels, directives, styles and other supported diagram types. Implement native layout and vector drawing for each verified construct. Preserve original source and unknown attributes even when preview or editing is unsupported; show a clear error rather than discard content. Differential tests must cover both positive and negative cases before a feature is marked complete.
4. Implement or carefully extend a native KaTeX-compatible parser, math layout and glyph pipeline with tested OpenType math fonts. Check symbol and command behavior, line and display metrics, Unicode, diagnostics, accessibility and font licenses against the pinned source. A limited SwiftMath preview can only be enabled for cases proven safe and visually equivalent; it cannot stand in for general KaTeX.
5. Integrate editing through the existing checked persistence path with conflict handling, undo and preservation of unknown fields. For shared documents, retain Yjs-compatible collaboration before enabling writes. Validate on all three platforms and repeat the visual comparison; until then the experiments remain isolated and no full-parity percentage is justified.
