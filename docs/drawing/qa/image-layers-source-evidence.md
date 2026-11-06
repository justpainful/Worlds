# Image, mask and layer implementation evidence

Reviewed at 2026-11-06 08:57 UTC. This record maps implemented behavior to source and verified evidence. It does not replace native role testing or full visual acceptance.

## Browser pixel evidence

The current checked-in QA captures all report `passed: true`:

| Capture | Cases | What it establishes |
| --- | ---: | --- |
| `browser-mask-checks.json` | 28 | Actual disposable workers, independent gradient and masked-effect pixels, blur edges, nonconstant sharpen/pixelate goldens, ordered effects, crop source retention, linked and world mask rasterization, owned PNG output and cancel |
| `browser-redaction-checks.json` | 8 | Opaque cover at fractional scales and origins, zero-opacity layer safety, scoped capture, frame clipping, flattened PNG metadata removal |
| `browser-merge-checks.json` | 8 | Exact screen and per-frame pixels with nested blend/opacity, fixed frame paper, redaction retention, original source retention, one Undo preserving a foreign node, cancel and explicit overlap refusal |
| `browser-blend-checks.json` | 6 | All six supported blend modes against independent premultiplied alpha equations with mixed bitmap, shape and text |

Failed first-pass raw artifacts remain in the owner's Downloads directory. The initial blur oracle omitted transparent crop-boundary samples; its correction counts4/9 corner and6/9 edge coverage. The initial frame-redaction oracle incorrectly rounded transformed x to25 instead of24. Neither correction changed production pixels or relaxed tolerance2.

## Source map

| Behavior | Main files |
| --- | --- |
| Non-destructive numeric and dragged image crop, trim/fit, original restore, real comparison | `ImageCropDialog.tsx`, `imageCrop.ts`, `DrawingView.tsx` |
| Grayscale paint/fill/gradient/invert, isolation, enable/disable, linked/world domain | `MaskDialog.tsx`, `maskRaster.ts`, `maskRaster.worker.ts`, `maskRasterTasks.ts` |
| Independent owned mask and fork-on-write shared mask properties | `maskEdit.ts` |
| Ordered masked image effects and raster compositing | `maskedEffects.ts`, `pixels.ts`, `pixels.worker.ts`, `renderer.ts` |
| Bake current image appearance into a new owned PNG while keeping original assets | `RasterizeImageDialog.tsx`, `rasterizeImage.ts` |
| Final opaque redaction pass and source-scope retention | `redaction.ts`, `renderer.ts`, `exportScope.ts` |
| Source-preserving visible raster merge, preview/apply/cancel, strict base | `layerMerge.ts`, `LayerMergeDialog.tsx`, `DrawingView.tsx` |
| Complete nested duplicate/reorder/delete, copied asset metadata independence | `workflows.ts`, `layers.ts` |
| Serial real renderer thumbnails, search, ancestor context, collapse and local solo | `LayerBrowser.tsx`, `layerBrowser.css` |

All dialogs use fenced leases and current source checks. The image/mask mutation helpers include ancestor locks and original/mask asset dependencies. Merge additionally requires the canonical `requiresBase` protocol and root lease so a source-sensitive merge cannot rebase over a foreign edit.

## Focused tests

At08:55 UTC, `npm run typecheck` passed. A single focused run of `layerWorkflows.test.ts`, `workflows.test.ts`, `layers.test.ts`, `maskRaster.test.ts`, `imageCrop.test.ts` and `pixels.test.ts` passed29 tests across6 files. Coverage includes shared node/effect mask forks, immutable original arrays, inherited lock and stale refusals, subtree operations, strict merge base, one author Undo retaining a foreign shape, and a foreign copied merged bitmap retaining its forked asset after author Undo.

The parent separately verified strict-base canonical, transport and native tests. Final whole-project checks are owned by the parent.

## Thumbnail investigation

The full application screenshot initially made text and stroke thumbnails look empty. Actual production canvas readback found215 covered pixels for notes,218 for strokes and918 for shapes, each96x64. The source isolation and renderer are functioning; the thumbnail contains a whole1100x740 frame in a48x32 CSS box, so fine text/ink competes with the checkerboard. No renderer change or fake thumbnail was added.

`LayerBrowser` now exposes explicit loading and error states, with `aria-busy` and localized loading text. Diagnostic alpha counting is guarded by `import.meta.env.DEV` and absent from production execution. `scripts/drawing-thumbnail-smoke.html?mock` exercises the production component and serialized queue. Its result must be observed separately before claiming it passed. Search/collapse/solo UI acceptance is owned by the parent.

## Explicit limits

Per-effect raster masks apply to image/raster effects; non-image CSS filters do not gain independent per-effect masks. Node masks still support all node types. Linked/world mask conversion is a documented raster resampling operation.

Working masks are limited to16Mi pixels, effect images to8Mi pixels, merge output to64Mi total pixels and128MiB encoded batch, merge group working allocation to192MiB by depth, and the renderer group pass to256MiB. Oversized work is refused. Merge supports all visible content in clipped, integer-bounded, nonoverlapping frames and bakes each frame paper. It explicitly refuses world items, overlaps, unclipped/fractional frames and custom step-hidden-node views. The merge result is static imagery; text and links remain editable in retained originals after Undo.

Editable project files retain originals beneath redactions. Only a flattened image export removes covered original pixels from that artifact. The parent owns the explicit export warning and sampling/destructive-source restrictions.

R10.05 has the merge pixel and collaborative source evidence above. R10.08 has six-mode independent mixed-content pixel evidence. Nested structure helpers strengthen R10.02/R10.06. Do not infer a complete all-tools native role/lock matrix for R10.03/R10.04 or full native mixed-type UI acceptance for R10.01 from these focused checks.
