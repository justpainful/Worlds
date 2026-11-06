# حالة تنفيذ خطة الرسم

آخر تدقيق: 2026-11-06. المصدر: [الخطة](PLAN.md) و[سجل المتطلبات](requirements.json).

**127 / 232 بندًا متحققًا = 54.74٪. المتبقي 105 بندًا.**

ضمن المتبقي: 63 منفذ يحتاج تحققًا، و35 جزئي، و7 لم يبدأ. المحاور الرئيسية المكتملة بالكامل: 0 / 29.

هذه نسبة تغطية بنود التحقق بأوزان متساوية، وليست تقديرًا للوقت أو جاهزية الإصدار. لا يُحتسب البند الجزئي أو الكود غير المتحقق كإنجاز كامل. اختبارات الوحدة تثبت نطاقها فقط؛ فحص التطبيق والأجهزة والأداء مدرج كبنود مستقلة. تقدير60٪ السابق كان تقديرًا ذاتيًا وقد استُبدل بهذه الحسبة.

يتحدث هذا الملف بتشغيل `node scripts/drawing-progress.mjs` بعد تحديث حالة البنود وأدلتها. تثبّت البصمة نطاق البنود؛ لا يتغير المقام بصمت. كل تقرير تقدم لاحق يجب أن يستخدم الأرقام الناتجة من هذا السجل.

| المحور | الإجمالي | متحقق | منفذ غير متحقق | جزئي | لم يبدأ | النسبة |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| R01 تكامل الرسم داخل وورلدز | 8 | 2 | 4 | 2 | 0 | 25.0٪ |
| R02 الواجهة والتفاعل | 6 | 3 | 2 | 1 | 0 | 50.0٪ |
| R03 محرك الرسم | 8 | 5 | 1 | 2 | 0 | 62.5٪ |
| R04 الفرشاة والإدخال | 9 | 3 | 6 | 0 | 0 | 33.3٪ |
| R05 الممحاة والتعبئة | 8 | 3 | 3 | 2 | 0 | 37.5٪ |
| R06 الألوان والتدرجات | 7 | 6 | 0 | 1 | 0 | 85.7٪ |
| R07 التحديد والتحويل | 13 | 10 | 2 | 1 | 0 | 76.9٪ |
| R08 الأشكال والمسارات | 8 | 3 | 3 | 2 | 0 | 37.5٪ |
| R09 النص العربي والإنجليزي | 7 | 5 | 1 | 1 | 0 | 71.4٪ |
| R10 الطبقات | 8 | 3 | 3 | 2 | 0 | 37.5٪ |
| R11 تعديل الصور | 7 | 4 | 1 | 2 | 0 | 57.1٪ |
| F01 العالم والإطارات | 9 | 4 | 4 | 1 | 0 | 44.4٪ |
| F02 روابط وورلدز والمهام | 9 | 7 | 2 | 0 | 0 | 77.8٪ |
| F03 الشروحات والروابط المكانية | 9 | 7 | 2 | 0 | 0 | 77.8٪ |
| F04 الأقنعة والتنقيح | 7 | 4 | 0 | 3 | 0 | 57.1٪ |
| F05 التجارب والمقارنة | 7 | 5 | 2 | 0 | 0 | 71.4٪ |
| F06 الخطوات والعرض | 8 | 2 | 5 | 1 | 0 | 25.0٪ |
| F07 المكتبة القابلة لإعادة الاستخدام | 10 | 7 | 2 | 0 | 1 | 70.0٪ |
| F08 التعاون والصلاحيات | 11 | 9 | 1 | 1 | 0 | 81.8٪ |
| F09 الليزر | 4 | 2 | 1 | 1 | 0 | 50.0٪ |
| F10 تصحيح الأشكال تلقائيًا | 4 | 2 | 1 | 1 | 0 | 50.0٪ |
| R18 قلم التحديد | 6 | 3 | 2 | 1 | 0 | 50.0٪ |
| R19 أنواع الفرش والألوان | 5 | 1 | 4 | 0 | 0 | 20.0٪ |
| R12 الحفظ والاسترجاع | 9 | 7 | 1 | 1 | 0 | 77.8٪ |
| R13 الاستيراد والتصدير | 14 | 9 | 3 | 2 | 0 | 64.3٪ |
| R14 اختصارات لوحة المفاتيح | 6 | 1 | 5 | 0 | 0 | 16.7٪ |
| R15 تكامل Rust وMCP والمزامنة | 8 | 6 | 1 | 1 | 0 | 75.0٪ |
| R16 الأداء وحدود الذاكرة | 8 | 4 | 1 | 2 | 1 | 50.0٪ |
| R17 التحقق النهائي | 9 | 0 | 0 | 4 | 5 | 0.0٪ |

## سجل التحقق

رمز الحالة يتعلق بالبند المحدد فقط. الأدلة السابقة تحتفظ بنطاقها ومصدرها؛ لا تعني قبول كل المحرر الحالي. إدراج ملف كود وحده لا يثبت اكتمال سلوك الواجهة.

### R01 تكامل الرسم داخل وورلدز

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| R01.01 | منفذ غير متحقق | Drawing resource, New menu and blank size/background creation | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [drawing.rs](../../src-tauri/src/drawing.rs) | Native creation/navigation UI acceptance |
| R01.02 | متحقق | Image import preview, original bytes, fit, Apply/Cancel and Undo | [imageIngest.test.ts](../../src/drawing/imageIngest.test.ts), [floatingPixels.test.ts](../../src/drawing/floatingPixels.test.ts), [browser-image-ingest.json](../../docs/drawing/qa/browser-image-ingest.json) | Independent SHA and scene-revision checks |
| R01.03 | جزئي | Open-image and system clipboard paste routing | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [imageIngest.test.ts](../../src/drawing/imageIngest.test.ts) | Actual clipboard read remained pending; native paste unverified |
| R01.04 | متحقق | Atomic drawing templates and independent duplication | [drawing_copy.rs](../../src-tauri/src/drawing_copy.rs), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Actual native/MCP template/copy checks |
| R01.05 | منفذ غير متحقق | Projects/sidebar/recent/favorite/archive/trash integration | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Complete drawing-specific navigation matrix |
| R01.06 | منفذ غير متحقق | Thumbnail and default embedded preview | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [drawing_references.rs](../../src-tauri/src/drawing_references.rs) | Current native rendered thumbnail/embed acceptance |
| R01.07 | منفذ غير متحقق | Searchable drawing text and frame names | [drawing.rs](../../src-tauri/src/drawing.rs), [operations.test.ts](../../src/drawing/operations.test.ts) | Code exists; matching current behavior for every named subpart needs stronger acceptance evidence |
| R01.08 | جزئي | Global comment indexing and search | [model.ts](../../src/drawing/model.ts) | Global search and independent rights |

### R02 الواجهة والتفاعل

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| R02.01 | منفذ غير متحقق | Context toolbar, inspector, tooltips and shortcut hints | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Full native interaction/accessibility audit |
| R02.02 | متحقق | Independent remembered tool settings/colors | [preferences.test.ts](../../src/drawing/preferences.test.ts) | Owner/tool isolation, alpha and bounded recovery |
| R02.03 | متحقق | Collapsible/resizable/persistent panels | [PanelResize.tsx](../../src/drawing/PanelResize.tsx), [panelPreferences.ts](../../src/drawing/panelPreferences.ts), [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [browser-panel-checks.json](../../docs/drawing/qa/browser-panel-checks.json) | Actual pointer resize, RTL keyboard resize, collapsed/tab/width persistence through owner remount; broader narrow/light/native visual matrix remains R02.04/R17. |
| R02.04 | متحقق | Narrow inspector and focus mode | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [drawing-viewport-review.html](../../scripts/drawing-viewport-review.html), [38-editor-760x520.jpg](../../docs/drawing/qa/screenshots/38-editor-760x520.jpg), [39-focus-760x520.jpg](../../docs/drawing/qa/screenshots/39-focus-760x520.jpg) | Current corresponding browser behavior and independent pixel/output evidence passed; installed-window and physical-device acceptance remains R17. Current narrow/wide visual acceptance |
| R02.05 | منفذ غير متحقق | Accurate brush cursor and zoom/status footer | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Physical input and all-scale checks |
| R02.06 | جزئي | Per-text direction and accessible light/dark neutral surface | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [model.ts](../../src/drawing/model.ts) | Direction controls plus complete visual/accessibility matrix |

### R03 محرك الرسم

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| R03.01 | متحقق | Persistent mixed raster/vector/image/text scene and operation journal | [operations.test.ts](../../src/drawing/operations.test.ts), [drawing.rs](../../src-tauri/src/drawing.rs) | Editable roundtrip and validated durable operations |
| R03.02 | متحقق | Document coordinates including distant world transforms | [affine.test.ts](../../src/drawing/affine.test.ts), [objectTransforms.test.ts](../../src/drawing/objectTransforms.test.ts) | Independent matrix/source-point checks |
| R03.03 | متحقق | Immutable original samples/images and nondestructive transforms | [objectTransforms.test.ts](../../src/drawing/objectTransforms.test.ts), [imageIngest.test.ts](../../src/drawing/imageIngest.test.ts), [transport.test.ts](../../src/drawing/transport.test.ts) | Original point/byte and immutable transport assertions |
| R03.04 | جزئي | Complete mask and ordered-effect compositing | [renderer.ts](../../src/drawing/renderer.ts), [pixels.test.ts](../../src/drawing/pixels.test.ts) | All mask/effect types and combinations |
| R03.05 | متحقق | Partial repaint and complete viewport loading | [renderer.ts](../../src/drawing/renderer.ts), [browser-prefix-cache.json](../../docs/drawing/qa/browser-prefix-cache.json) | Current corresponding browser behavior and independent pixel/output evidence passed; installed-window and physical-device acceptance remains R17. Dirty-region invalidation and mixed-scene measurements |
| R03.06 | منفذ غير متحقق | Shared screen/export rendering | [renderer.ts](../../src/drawing/renderer.ts) | Current complete-scene image/export acceptance |
| R03.07 | متحقق | Bounded raster/spatial caches and mip arithmetic | [pigmentMip.test.ts](../../src/drawing/pigmentMip.test.ts), [tileSampling.test.ts](../../src/drawing/tileSampling.test.ts), [tileCompositor.test.ts](../../src/drawing/tileCompositor.test.ts), [browser-formatting-checks.json](../../docs/drawing/qa/browser-formatting-checks.json), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json), [browser-transform-pixels.json](../../docs/drawing/qa/browser-transform-pixels.json) | Fresh30 GPU/29 forced-Canvas checks plus numerical cache/mip tests; hardware/total-process performance remains R16 open. |
| R03.08 | جزئي | All heavy operations in cancelable workers | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [animatedImage.ts](../../src/drawing/animatedImage.ts) | Export worker and full cancellation coverage |

### R04 الفرشاة والإدخال

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| R04.01 | منفذ غير متحقق | Pencil, hard/soft, ink, marker, spray and image texture tools | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [renderer.ts](../../src/drawing/renderer.ts) | Current native style/pigment/input acceptance |
| R04.02 | متحقق | Deterministic sampling and bounded stroke work | [brushWork.test.ts](../../src/drawing/brushWork.test.ts), [operations.test.ts](../../src/drawing/operations.test.ts) | Incremental spray, granule/bristle limits and overload retention |
| R04.03 | منفذ غير متحقق | Size1-2048/opacity/flow/hardness/spacing/angle/roundness | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Each control's boundaries and actual pigment behavior |
| R04.04 | منفذ غير متحقق | Smoothing/stabilization and preset reset/save | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [LibraryPanel.tsx](../../src/drawing/LibraryPanel.tsx) | Native gesture tuning and preset roundtrip |
| R04.05 | متحقق | Taper and stored pressure-curve width geometry | [uniformStroke.test.ts](../../src/drawing/uniformStroke.test.ts) | Independent distance/width assertions |
| R04.06 | منفذ غير متحقق | Pressure/opacity/flow mappings and tilt diagnostics | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Physical pen and each mapping acceptance |
| R04.07 | منفذ غير متحقق | Mouse/touch-pan/coalesced input | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Real mouse/touch/pen device checks |
| R04.08 | متحقق | One reversible journal edit per completed stroke | [brushWork.test.ts](../../src/drawing/brushWork.test.ts), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Native atomic selected-stroke/mask and author Undo |
| R04.09 | منفذ غير متحقق | Escape/blur/pointer-cancel cleanup | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Complete physical input and keyboard matrix |

### R05 الممحاة والتعبئة

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| R05.01 | منفذ غير متحقق | Transparent soft/pressure/opacity eraser | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [renderer.ts](../../src/drawing/renderer.ts) | Native pixel/pen acceptance |
| R05.02 | متحقق | Selection-clipped persistent paint/erase masks | [selectionPaint.test.ts](../../src/drawing/selectionPaint.test.ts), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Owned linked mask and atomic Undo |
| R05.03 | جزئي | Mask painting and explicit vector rasterize-or-mask workflow | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [model.ts](../../src/drawing/model.ts) | Full mask editing and vector semantics |
| R05.04 | منفذ غير متحقق | Layer alpha lock | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [renderer.ts](../../src/drawing/renderer.ts) | Full erase/selection/native behavior |
| R05.05 | متحقق | Connected/global fill, tolerance and transparency algorithms | [pixels.test.ts](../../src/drawing/pixels.test.ts) | Alpha/connectivity and bounded-room assertions |
| R05.06 | منفذ غير متحقق | Current/merged fill sampling | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Opacity/blend/target-layer integration matrix |
| R05.07 | متحقق | Fill expansion/contraction and transparent-output trimming | [morphology.test.ts](../../src/drawing/morphology.test.ts) | Independent boundary/bounds tests |
| R05.08 | جزئي | Cancelable fill preview and complete target/mask/selection behavior | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Preview/Apply/Cancel and combinations |

### R06 الألوان والتدرجات

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| R06.01 | متحقق | Foreground/background swap and visual HEX/RGB picker | [Colors.tsx](../../src/drawing/Colors.tsx), [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [browser-formatting-checks.json](../../docs/drawing/qa/browser-formatting-checks.json), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Matching browser interaction/source invariants and native storage/sync evidence recorded; physical native UI/device and final whole-product acceptance remain separately open in R17. |
| R06.02 | متحقق | Alpha picker and transparent-paint UI | [Colors.tsx](../../src/drawing/Colors.tsx), [preferences.test.ts](../../src/drawing/preferences.test.ts), [browser-formatting-checks.json](../../docs/drawing/qa/browser-formatting-checks.json), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Matching browser interaction/source invariants and native storage/sync evidence recorded; physical native UI/device and final whole-product acceptance remain separately open in R17. |
| R06.03 | متحقق | Current/merged eyedropper choices | [colorSample.ts](../../src/drawing/colorSample.ts), [Stage.tsx](../../src/drawing/Stage.tsx), [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [browser-color-checks.json](../../docs/drawing/qa/browser-color-checks.json) | Actual source choice/canvas clicks; independent expected sRGB8 current alpha/merged multiply pixels; cancellation and no canonical mutation; sampled color retained by prior painting tool. |
| R06.04 | متحقق | Owner-scoped recent colors and palette payload validation | [preferences.test.ts](../../src/drawing/preferences.test.ts), [library.test.ts](../../src/drawing/library.test.ts), [drawing_library.rs](../../src-tauri/src/drawing_library.rs) | Stored alpha and malformed-palette refusal |
| R06.05 | متحقق | Shared palette metadata synchronization | [libraryPublication.ts](../../src/drawing/libraryPublication.ts), [drawing_library.rs](../../src-tauri/src/drawing_library.rs), [LibraryPanel.tsx](../../src/drawing/LibraryPanel.tsx), [native-library-sync.json](../../docs/drawing/qa/native-library-sync.json) | Actual two Rust/SQLite processes and Worker synchronization of immutable publication versions/palettes/metadata/originals; reopen/revocation and stale/corrupt directories tested. Service capability1 required for library metadata. Native visual gate remains R17. |
| R06.06 | متحقق | Linear/radial multistop gradient editor | [model.ts](../../src/drawing/model.ts), [renderer.ts](../../src/drawing/renderer.ts), [browser-formatting-checks.json](../../docs/drawing/qa/browser-formatting-checks.json), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Matching browser interaction/source invariants and native storage/sync evidence recorded; physical native UI/device and final whole-product acceptance remain separately open in R17. |
| R06.07 | جزئي | Defined sRGB8 import/color-profile behavior | [imageIngest.test.ts](../../src/drawing/imageIngest.test.ts), [renderer.ts](../../src/drawing/renderer.ts) | Profile/alpha fixtures and documented limits |

### R07 التحديد والتحويل

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| R07.01 | متحقق | Rectangle/ellipse/lasso/polygon alpha algorithms | [pixelSelection.test.ts](../../src/drawing/pixelSelection.test.ts) | Independent rays, clipping and combined regions |
| R07.02 | متحقق | Alpha-aware magic/color selection | [pixelSelection.test.ts](../../src/drawing/pixelSelection.test.ts) | Tolerance/connectivity and transparent source assertions |
| R07.03 | متحقق | Add/subtract/intersect/invert/clear/all including empty active selection | [pixelSelection.test.ts](../../src/drawing/pixelSelection.test.ts), [selectionController.test.ts](../../src/drawing/selectionController.test.ts) | Holes, disconnected regions and state lifetime |
| R07.04 | متحقق | Grow/shrink/feather and canceled-worker ownership | [pixelSelection.test.ts](../../src/drawing/pixelSelection.test.ts), [selectionController.test.ts](../../src/drawing/selectionController.test.ts) | Late results, frame changes and alpha preservation |
| R07.05 | منفذ غير متحقق | Actual gestures/modifiers/polygon cancel and object-vs-pixel UI | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Complete current native gesture/keyboard matrix |
| R07.06 | متحقق | Floating move/duplicate with current-vs-visible layer sampling | [floatingPixels.test.ts](../../src/drawing/floatingPixels.test.ts), [browser-floating-checks.json](../../docs/drawing/qa/browser-floating-checks.json), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Independent alpha/blend arithmetic and native author Undo |
| R07.07 | متحقق | Copy PNG, failure-safe cut and original-preserving deletion | [browser-floating-checks.json](../../docs/drawing/qa/browser-floating-checks.json), [floatingPixels.test.ts](../../src/drawing/floatingPixels.test.ts) | Actual page PNG; injected refusal and unchanged original scene |
| R07.08 | جزئي | System clipboard paste and native shortcuts | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [imageIngest.test.ts](../../src/drawing/imageIngest.test.ts) | Physical/native clipboard read and routing |
| R07.09 | متحقق | Numeric rotate/flip/scale, grips and one source-preserving Undo | [objectTransforms.test.ts](../../src/drawing/objectTransforms.test.ts), [transformHandles.test.ts](../../src/drawing/transformHandles.test.ts), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Independent source points, opposite grips and foreign properties |
| R07.10 | منفذ غير متحقق | Align/distribute/group/ungroup/stack UI | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Full rotated/grouped/collaborative acceptance |
| R07.11 | متحقق | Grid, editable guides and snapping | [browser-formatting-checks.json](../../docs/drawing/qa/browser-formatting-checks.json), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Matching browser interaction/source invariants and native storage/sync evidence recorded; physical native UI/device and final whole-product acceptance remain separately open in R17. |
| R07.12 | متحقق | Original-quality image resampling and preview | [renderer.ts](../../src/drawing/renderer.ts), [imageIngest.test.ts](../../src/drawing/imageIngest.test.ts), [browser-transform-pixels.json](../../docs/drawing/qa/browser-transform-pixels.json) | Current corresponding browser behavior and independent pixel/output evidence passed; installed-window and physical-device acceptance remains R17. Current canonical image/export pixel matrix |
| R07.13 | متحقق | Durable locks/stale-source guards and floating Cancel/no-op | [pixelGuard.test.ts](../../src/drawing/pixelGuard.test.ts), [gestureLeases.test.ts](../../src/drawing/gestureLeases.test.ts), [browser-floating-checks.json](../../docs/drawing/qa/browser-floating-checks.json) | Membership/fence/refusal and unchanged-history checks |

### R08 الأشكال والمسارات

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| R08.01 | منفذ غير متحقق | Line/rect/roundrect/ellipse/triangle/right-triangle/polygon/star | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [renderer.ts](../../src/drawing/renderer.ts) | Actual gestures and shape-specific parameters |
| R08.02 | منفذ غير متحقق | Arrows and two-ended arrows | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [renderer.ts](../../src/drawing/renderer.ts) | Style and full native workflow |
| R08.03 | جزئي | Callout/number/highlight semantics | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [renderer.ts](../../src/drawing/renderer.ts) | Proper callout geometry and highlight workflow |
| R08.04 | متحقق | Polyline and editable curve creation | [model.ts](../../src/drawing/model.ts), [browser-formatting-checks.json](../../docs/drawing/qa/browser-formatting-checks.json), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Matching browser interaction/source invariants and native storage/sync evidence recorded; physical native UI/device and final whole-product acceptance remain separately open in R17. |
| R08.05 | متحقق | Path point/handle editing, insert/delete and open/close | [model.ts](../../src/drawing/model.ts), [browser-formatting-checks.json](../../docs/drawing/qa/browser-formatting-checks.json), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Matching browser interaction/source invariants and native storage/sync evidence recorded; physical native UI/device and final whole-product acceptance remain separately open in R17. |
| R08.06 | متحقق | Fill/stroke/opacity controls | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [renderer.ts](../../src/drawing/renderer.ts), [browser-formatting-checks.json](../../docs/drawing/qa/browser-formatting-checks.json), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Matching browser interaction/source invariants and native storage/sync evidence recorded; physical native UI/device and final whole-product acceptance remain separately open in R17. |
| R08.07 | منفذ غير متحقق | Dashes/endcaps/corner radius and proportional drawing | [model.ts](../../src/drawing/model.ts), [renderer.ts](../../src/drawing/renderer.ts) | Full controls and modifier behavior |
| R08.08 | جزئي | Reusable shape styles | [LibraryPanel.tsx](../../src/drawing/LibraryPanel.tsx) | Create/apply/edit styles as specified |

### R09 النص العربي والإنجليزي

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| R09.01 | متحقق | Editable bilingual text persists exactly | [operations.test.ts](../../src/drawing/operations.test.ts), [drawing.rs](../../src-tauri/src/drawing.rs) | Arabic/Latin JSON and SQLite roundtrips |
| R09.02 | منفذ غير متحقق | Create/double-click edit/search text UI | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [drawing.rs](../../src-tauri/src/drawing.rs) | Current native workflow and permitted search |
| R09.03 | متحقق | Bidi direction/shaping and font picker | [model.ts](../../src/drawing/model.ts), [renderer.ts](../../src/drawing/renderer.ts), [browser-formatting-checks.json](../../docs/drawing/qa/browser-formatting-checks.json), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Matching browser interaction/source invariants and native storage/sync evidence recorded; physical native UI/device and final whole-product acceptance remain separately open in R17. |
| R09.04 | متحقق | Font-size control | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [browser-formatting-checks.json](../../docs/drawing/qa/browser-formatting-checks.json), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Matching browser interaction/source invariants and native storage/sync evidence recorded; physical native UI/device and final whole-product acceptance remain separately open in R17. |
| R09.05 | متحقق | Weight/style/align/leading/color/background/border formatting | [model.ts](../../src/drawing/model.ts), [renderer.ts](../../src/drawing/renderer.ts), [browser-formatting-checks.json](../../docs/drawing/qa/browser-formatting-checks.json), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Matching browser interaction/source invariants and native storage/sync evidence recorded; physical native UI/device and final whole-product acceptance remain separately open in R17. |
| R09.06 | متحقق | Wrap vs scale choice | [renderer.ts](../../src/drawing/renderer.ts), [model.ts](../../src/drawing/model.ts), [browser-formatting-checks.json](../../docs/drawing/qa/browser-formatting-checks.json), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Matching browser interaction/source invariants and native storage/sync evidence recorded; physical native UI/device and final whole-product acceptance remain separately open in R17. |
| R09.07 | جزئي | Missing fonts/export appearance/font licensing | [renderer.ts](../../src/drawing/renderer.ts) | Fallback warning and export/license audit |

### R10 الطبقات

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| R10.01 | منفذ غير متحقق | Mixed raster/image/text/shape/Worlds layer content | [model.ts](../../src/drawing/model.ts), [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Complete mixed-layer native acceptance |
| R10.02 | منفذ غير متحقق | Add/name/select/duplicate/reorder/delete layers | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Nested dependencies and collaborative Undo |
| R10.03 | منفذ غير متحقق | Visibility/edit lock/opacity controls | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Inherited state and role/native checks |
| R10.04 | جزئي | Position lock and alpha-lock enforcement | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [model.ts](../../src/drawing/model.ts) | Full controls and all tools |
| R10.05 | جزئي | Reversible layer merge | [layerMerge.ts](../../src/drawing/layerMerge.ts), [LayerMergeDialog.tsx](../../src/drawing/LayerMergeDialog.tsx), [browser-merge-checks.json](../../docs/drawing/qa/browser-merge-checks.json), [drawing_sync.rs](../../src-tauri/src/drawing_sync.rs) | Supported fixed, clipped, nonoverlapping integer frames pass screen/export/Undo/cancel checks. Whole-plan audit leaves this unit open because world items, overlapping/unclipped/fractional frames and custom step visibility are refused. No scope reduction. |
| R10.06 | متحقق | Nested layer groups and inherited rendering | [layers.ts](../../src/drawing/layers.ts), [layers.test.ts](../../src/drawing/layers.test.ts), [renderer.ts](../../src/drawing/renderer.ts), [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [browser-layer-checks.json](../../docs/drawing/qa/browser-layer-checks.json) | Actual hierarchy UI, cycle refusal, inherited lock/visibility/selection and Undo; independent group-compositing pixels/export; ancestor receipt tests in Rust and actual Worker transport. Final native visual gate stays R17. |
| R10.07 | متحقق | Layer thumbnails/isolate/search | [editor-ui-review.json](../../docs/drawing/qa/editor-ui-review.json), [image-layers-source-evidence.md](../../docs/drawing/qa/image-layers-source-evidence.md) | Matching current real editor behavior observed in isolated full-App browser UI, with focused algorithm and native persistence/authority evidence listed. Physical installed-window and pen/touch gates remain R17. Implement and verify |
| R10.08 | متحقق | Normal/multiply/screen/overlay/darken/lighten | [drawing-blend-smoke.html](../../scripts/drawing-blend-smoke.html), [browser-blend-checks.json](../../docs/drawing/qa/browser-blend-checks.json) | Six independent normal/multiply/screen/overlay/darken/lighten color checks with nested groups and screen/export equivalence; two-unit premultiplied tolerance unchanged. |

### R11 تعديل الصور

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| R11.01 | متحقق | Nondestructive crop controls | [model.ts](../../src/drawing/model.ts), [renderer.ts](../../src/drawing/renderer.ts), [editor-ui-review.json](../../docs/drawing/qa/editor-ui-review.json), [browser-mask-checks.json](../../docs/drawing/qa/browser-mask-checks.json) | Matching current real editor behavior observed in isolated full-App browser UI, with focused algorithm and native persistence/authority evidence listed. Physical installed-window and pen/touch gates remain R17. Interactive crop workflow |
| R11.02 | متحقق | Rotate/flip/resize without changing original bytes/samples | [objectTransforms.test.ts](../../src/drawing/objectTransforms.test.ts), [imageIngest.test.ts](../../src/drawing/imageIngest.test.ts) | Source invariants and original SHA |
| R11.03 | منفذ غير متحقق | Image dimensions distinct from frame dimensions | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Full native interaction acceptance |
| R11.04 | متحقق | Brightness/contrast/saturation/temperature/grayscale/invert/blur/sharpen/pixelate algorithms | [pixels.ts](../../src/drawing/pixels.ts), [browser-mask-checks.json](../../docs/drawing/qa/browser-mask-checks.json) | Actual worker independent outputs for every listed adjustment; nonconstant premultiplied pixelate and sharpen impulse; transparent-edge blur oracle and source invariant. Native visual gate separate. |
| R11.05 | متحقق | Effect order/on-off/reset | [renderer.ts](../../src/drawing/renderer.ts), [browser-mask-checks.json](../../docs/drawing/qa/browser-mask-checks.json) | Actual brightness/invert order reversed, effect-mask disabled/inverted and exact reset/original retention checks. |
| R11.06 | جزئي | Per-effect masks and explicit reversible rasterize/merge | [MaskDialog.tsx](../../src/drawing/MaskDialog.tsx), [rasterizeImage.ts](../../src/drawing/rasterizeImage.ts), [browser-mask-checks.json](../../docs/drawing/qa/browser-mask-checks.json) | Image/raster per-effect masks and reversible rasterization are implemented and sampled; generalized masks/merge combinations and native workflow remain open. |
| R11.07 | جزئي | Before/after image-edit comparison | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Full image-effect comparison workflow |

### F01 العالم والإطارات

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| F01.01 | منفذ غير متحقق | World canvas, navigation and world items | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [renderer.ts](../../src/drawing/renderer.ts) | Complete native interaction/performance |
| F01.02 | متحقق | Stable single-parent frame ownership | [operations.test.ts](../../src/drawing/operations.test.ts), [workflows.test.ts](../../src/drawing/workflows.test.ts) | Invalid membership rejected |
| F01.03 | منفذ غير متحقق | Frame name/dimensions/background/order/state/default/export settings | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [model.ts](../../src/drawing/model.ts) | All controls and persistence |
| F01.04 | متحقق | Move children and duplicate with remapped internal anchors | [workflows.test.ts](../../src/drawing/workflows.test.ts) | Exact coordinates, original geometry and independent copies |
| F01.05 | منفذ غير متحقق | Crop bounds vs content scaling | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [renderer.ts](../../src/drawing/renderer.ts) | Native crop/resize workflow |
| F01.06 | متحقق | Minimap | [browser-formatting-checks.json](../../docs/drawing/qa/browser-formatting-checks.json), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Matching browser interaction/source invariants and native storage/sync evidence recorded; physical native UI/device and final whole-product acceptance remain separately open in R17. |
| F01.07 | جزئي | Complete mixed-scene viewport loading/LOD | [tileSampling.test.ts](../../src/drawing/tileSampling.test.ts), [renderer.ts](../../src/drawing/renderer.ts) | Images/text/masks/references and measured performance |
| F01.08 | منفذ غير متحقق | Single frame/region export | [renderer.ts](../../src/drawing/renderer.ts), [Steps.tsx](../../src/drawing/Steps.tsx) | Current saved image/native acceptance |
| F01.09 | متحقق | Selected-frame batch export | [frameArchive.ts](../../src/drawing/frameArchive.ts), [ExportDialog.tsx](../../src/drawing/ExportDialog.tsx), [browser-frame-archive.json](../../docs/drawing/qa/browser-frame-archive.json) | Selected-frame Arabic UI save; independent ZIP CRC/UTF-8 names/dimensions and every colored pixel; scale/document order/progress/cancel/source preservation. Native file-dialog release gate remains R17.06. |

### F02 روابط وورلدز والمهام

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| F02.01 | منفذ غير متحقق | Live page/task/file cards and preview links | [drawing_references.rs](../../src-tauri/src/drawing_references.rs), [renderer.ts](../../src/drawing/renderer.ts) | All resource kinds in actual native UI |
| F02.02 | متحقق | Stable source IDs, no durable live-preview leakage | [references.test.ts](../../src/drawing/references.test.ts) | Denied/late data cleared; durable snapshot refusal |
| F02.03 | متحقق | Safe live-field updates and timestamps | [renderer.ts](../../src/drawing/renderer.ts), [references.test.ts](../../src/drawing/references.test.ts), [editor-ui-review.json](../../docs/drawing/qa/editor-ui-review.json), [REFERENCES.md](../../docs/drawing/REFERENCES.md), [browser-reference-workflow.json](../../docs/drawing/qa/browser-reference-workflow.json), [native-reference-authority.json](../../docs/drawing/qa/native-reference-authority.json), [native-reference-snapshot.json](../../docs/drawing/qa/native-reference-snapshot.json) | Matching current real editor behavior observed in isolated full-App browser UI, with focused algorithm and native persistence/authority evidence listed. Physical installed-window and pen/touch gates remain R17. Native live/offline update matrix |
| F02.04 | متحقق | Preview layout-affecting source updates | [editor-ui-review.json](../../docs/drawing/qa/editor-ui-review.json), [REFERENCES.md](../../docs/drawing/REFERENCES.md), [browser-reference-workflow.json](../../docs/drawing/qa/browser-reference-workflow.json), [native-reference-authority.json](../../docs/drawing/qa/native-reference-authority.json), [native-reference-snapshot.json](../../docs/drawing/qa/native-reference-snapshot.json) | Matching current real editor behavior observed in isolated full-App browser UI, with focused algorithm and native persistence/authority evidence listed. Physical installed-window and pen/touch gates remain R17. Implement and verify |
| F02.05 | متحقق | Frozen owned snapshots with date and missing-source relink | [ReferencesPanel.tsx](../../src/drawing/ReferencesPanel.tsx), [drawing_references.rs](../../src-tauri/src/drawing_references.rs), [editor-ui-review.json](../../docs/drawing/qa/editor-ui-review.json), [REFERENCES.md](../../docs/drawing/REFERENCES.md), [browser-reference-workflow.json](../../docs/drawing/qa/browser-reference-workflow.json), [native-reference-authority.json](../../docs/drawing/qa/native-reference-authority.json), [native-reference-snapshot.json](../../docs/drawing/qa/native-reference-snapshot.json) | Matching current real editor behavior observed in isolated full-App browser UI, with focused algorithm and native persistence/authority evidence listed. Physical installed-window and pen/touch gates remain R17. Complete delete/relink/independence workflow |
| F02.06 | متحقق | Offline-specific source state/timestamp | [renderer.ts](../../src/drawing/renderer.ts), [references.test.ts](../../src/drawing/references.test.ts), [editor-ui-review.json](../../docs/drawing/qa/editor-ui-review.json), [REFERENCES.md](../../docs/drawing/REFERENCES.md), [browser-reference-workflow.json](../../docs/drawing/qa/browser-reference-workflow.json), [native-reference-authority.json](../../docs/drawing/qa/native-reference-authority.json), [native-reference-snapshot.json](../../docs/drawing/qa/native-reference-snapshot.json) | Matching current real editor behavior observed in isolated full-App browser UI, with focused algorithm and native persistence/authority evidence listed. Physical installed-window and pen/touch gates remain R17. Offline status and stale labels |
| F02.07 | متحقق | Region-to-task with exact return-region/thread identity | [drawing_references.rs](../../src-tauri/src/drawing_references.rs), [navigation.test.ts](../../src/drawing/navigation.test.ts) | Native rights and retained requested navigation |
| F02.08 | منفذ غير متحقق | Live/pinned embedded-frame navigation | [ReferencesPanel.tsx](../../src/drawing/ReferencesPanel.tsx) | Current native rendered embed acceptance |
| F02.09 | متحقق | Independent source permissions/no restricted-preview leakage | [references.test.ts](../../src/drawing/references.test.ts), [drawing_references.rs](../../src-tauri/src/drawing_references.rs), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Native export and live revocation recheck |

### F03 الشروحات والروابط المكانية

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| F03.01 | متحقق | Point/region/node/world anchors follow transforms | [operations.test.ts](../../src/drawing/operations.test.ts), [collaboration.test.ts](../../src/drawing/collaboration.test.ts) | Transform/fallback geometry tests |
| F03.02 | متحقق | Edge anchors and anchor editing UI | [model.ts](../../src/drawing/model.ts), [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [editor-ui-review.json](../../docs/drawing/qa/editor-ui-review.json), [annotations-workflow.json](../../docs/drawing/qa/annotations-workflow.json) | Matching current real editor behavior observed in isolated full-App browser UI, with focused algorithm and native persistence/authority evidence listed. Physical installed-window and pen/touch gates remain R17. Explicit picker/edge behavior |
| F03.03 | متحقق | Two-ended connector propagation | [objectTransforms.test.ts](../../src/drawing/objectTransforms.test.ts) | Pinned ends and internal UV-anchor assertions |
| F03.04 | متحقق | Independent label positioning | [editor-ui-review.json](../../docs/drawing/qa/editor-ui-review.json), [annotations-workflow.json](../../docs/drawing/qa/annotations-workflow.json) | Matching current real editor behavior observed in isolated full-App browser UI, with focused algorithm and native persistence/authority evidence listed. Physical installed-window and pen/touch gates remain R17. Implement and verify |
| F03.05 | متحقق | Cropped/dangling/deleted/replaced-source review states | [renderer.ts](../../src/drawing/renderer.ts), [model.ts](../../src/drawing/model.ts), [editor-ui-review.json](../../docs/drawing/qa/editor-ui-review.json), [annotations-workflow.json](../../docs/drawing/qa/annotations-workflow.json) | Matching current real editor behavior observed in isolated full-App browser UI, with focused algorithm and native persistence/authority evidence listed. Physical installed-window and pen/touch gates remain R17. All states, replacement review and repair UI |
| F03.06 | منفذ غير متحقق | Annotation groups and numbering | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [model.ts](../../src/drawing/model.ts) | Full numbered-group workflow |
| F03.07 | متحقق | Annotation statuses/reusable styles | [editor-ui-review.json](../../docs/drawing/qa/editor-ui-review.json), [annotations-workflow.json](../../docs/drawing/qa/annotations-workflow.json) | Matching current real editor behavior observed in isolated full-App browser UI, with focused algorithm and native persistence/authority evidence listed. Physical installed-window and pen/touch gates remain R17. Implement and verify |
| F03.08 | منفذ غير متحقق | Clean or annotated export | [ExportDialog.tsx](../../src/drawing/ExportDialog.tsx), [renderer.ts](../../src/drawing/renderer.ts) | Current saved pixel checks |
| F03.09 | متحقق | Clean and annotated copies in one export | [frameArchive.ts](../../src/drawing/frameArchive.ts), [browser-pair-export.json](../../docs/drawing/qa/browser-pair-export.json) | Eight actual ZIP/CRC/PNG checks with exact clean/annotated output, filenames, cancellation and missing-frame refusal. Native save policy independently tested. |

### F04 الأقنعة والتنقيح

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| F04.01 | متحقق | Original image/stroke content preserved | [imageIngest.test.ts](../../src/drawing/imageIngest.test.ts), [objectTransforms.test.ts](../../src/drawing/objectTransforms.test.ts), [transport.test.ts](../../src/drawing/transport.test.ts) | Immutable byte/sample evidence |
| F04.02 | جزئي | Complete nondestructive crop/effect/mask pipeline | [renderer.ts](../../src/drawing/renderer.ts), [model.ts](../../src/drawing/model.ts) | All tools and combinations |
| F04.03 | جزئي | Grayscale mask paint/fill/gradient/invert/disable | [model.ts](../../src/drawing/model.ts), [renderer.ts](../../src/drawing/renderer.ts) | Complete mask editor |
| F04.04 | جزئي | Mask isolate/link/unlink controls | [model.ts](../../src/drawing/model.ts), [renderer.ts](../../src/drawing/renderer.ts) | All controls and geometry behavior |
| F04.05 | متحقق | Linked mask from selection | [selectionPaint.test.ts](../../src/drawing/selectionPaint.test.ts), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Owned alpha/local geometry and Undo |
| F04.06 | متحقق | Explicit opaque redaction tool | [editor-ui-review.json](../../docs/drawing/qa/editor-ui-review.json), [browser-redaction-checks.json](../../docs/drawing/qa/browser-redaction-checks.json) | Matching current real editor behavior observed in isolated full-App browser UI, with focused algorithm and native persistence/authority evidence listed. Physical installed-window and pen/touch gates remain R17. Implement and verify |
| F04.07 | متحقق | Sanitized flattened metadata-stripped output with no hidden originals | [renderer.ts](../../src/drawing/renderer.ts), [ExportDialog.tsx](../../src/drawing/ExportDialog.tsx), [browser-redaction-checks.json](../../docs/drawing/qa/browser-redaction-checks.json), [independent-redaction-audit.json](../../docs/drawing/qa/independent-redaction-audit.json) | Current corresponding browser behavior and independent pixel/output evidence passed; installed-window and physical-device acceptance remains R17. Independent output-byte inspection and redaction audit |

### F05 التجارب والمقارنة

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| F05.01 | متحقق | Named durable branch with author/base/date/description/state | [drawing.rs](../../src-tauri/src/drawing.rs) | Native independent experiment test |
| F05.02 | متحقق | Immutable shared originals with independent ownership | [drawing.rs](../../src-tauri/src/drawing.rs), [drawing_copy.rs](../../src-tauri/src/drawing_copy.rs) | Materialized dependency and copy tests |
| F05.03 | منفذ غير متحقق | Side-by-side/wipe/difference/linked-view comparison | [ExperimentsPanel.tsx](../../src/drawing/ExperimentsPanel.tsx) | Current full visual/native acceptance |
| F05.04 | متحقق | Whole/frame/node/property adoption logic | [experiments.test.ts](../../src/drawing/experiments.test.ts) | Independent current edits preserved |
| F05.05 | متحقق | Explicit keep/use/duplicate conflicts and stacking-order adoption | [experiments.test.ts](../../src/drawing/experiments.test.ts) | Real conflicts and order difference assertions |
| F05.06 | منفذ غير متحقق | Saved-version and scoped adoption UI | [ExperimentsPanel.tsx](../../src/drawing/ExperimentsPanel.tsx) | Current native/multiuser workflow |
| F05.07 | متحقق | Remapped internal anchors/dependencies | [workflows.test.ts](../../src/drawing/workflows.test.ts), [drawing_copy.rs](../../src-tauri/src/drawing_copy.rs) | Internal IDs and independent originals |

### F06 الخطوات والعرض

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| F06.01 | منفذ غير متحقق | Title/body/camera/frame/zoom/visibility/fixed content | [Steps.tsx](../../src/drawing/Steps.tsx) | All native step workflows and fixed-node semantics |
| F06.02 | منفذ غير متحقق | Transitions/optional duration/reorder/duplicate | [Steps.tsx](../../src/drawing/Steps.tsx) | Native behavior and collaborative Undo |
| F06.03 | منفذ غير متحقق | Preview/fullscreen/keyboard/reduced motion | [Steps.tsx](../../src/drawing/Steps.tsx) | Physical keys/OS preference acceptance |
| F06.04 | متحقق | Portable pinned revisions and transitive snapshots | [package.test.ts](../../src/drawing/package.test.ts), [drawing_copy.rs](../../src-tauri/src/drawing_copy.rs) | Deduplicated originals and remapped version IDs |
| F06.05 | منفذ غير متحقق | Follow draft vs pinned UI | [Steps.tsx](../../src/drawing/Steps.tsx) | Native update/pinned stability |
| F06.06 | متحقق | Numbered UTF-8 ZIP image archive structure | [archive.test.ts](../../src/drawing/archive.test.ts) | Independent CRC/archive verification |
| F06.07 | منفذ غير متحقق | Steps rendering and image export | [Steps.tsx](../../src/drawing/Steps.tsx) | Current renderer and native save |
| F06.08 | جزئي | Authorized interactive presentation viewer | [Steps.tsx](../../src/drawing/Steps.tsx) | Full source rights/current-access viewer audit |

### F07 المكتبة القابلة لإعادة الاستخدام

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| F07.01 | متحقق | Brush/palette publication validation | [library.test.ts](../../src/drawing/library.test.ts), [drawing_library.rs](../../src-tauri/src/drawing_library.rs) | Malformed settings/palette refusal |
| F07.02 | متحقق | Selected shapes/groups/masks/dependencies capture | [library.test.ts](../../src/drawing/library.test.ts) | Only chosen assets and detached external anchors |
| F07.03 | منفذ غير متحقق | All annotation/frame/document/signature library kinds | [LibraryPanel.tsx](../../src/drawing/LibraryPanel.tsx) | Complete listed-kind workflows; Doti required for any future characters |
| F07.04 | منفذ غير متحقق | Name/preview/tags/owner/source/scope/version metadata | [LibraryPanel.tsx](../../src/drawing/LibraryPanel.tsx), [drawing_library.rs](../../src-tauri/src/drawing_library.rs) | Current preview and all-device metadata |
| F07.05 | متحقق | Detached/version-linked insert and opt-in instance update | [library.test.ts](../../src/drawing/library.test.ts), [drawing_copy.rs](../../src-tauri/src/drawing_copy.rs) | Correct remapped IDs and selected-instance replacement |
| F07.06 | متحقق | Deletion/revocation leaves inserted copies intact | [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Native destination-owned originals |
| F07.07 | متحقق | Portable library import/export and dependency checks | [package.test.ts](../../src/drawing/package.test.ts), [library.test.ts](../../src/drawing/library.test.ts) | Palette metadata and original integrity |
| F07.08 | متحقق | Rights/current export-copy policy | [drawing_library.rs](../../src-tauri/src/drawing_library.rs), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Native permitted/refused materialization |
| F07.09 | متحقق | Shared library metadata synchronization | [libraryPublication.ts](../../src/drawing/libraryPublication.ts), [drawing_library.rs](../../src-tauri/src/drawing_library.rs), [LibraryPanel.tsx](../../src/drawing/LibraryPanel.tsx), [native-library-sync.json](../../docs/drawing/qa/native-library-sync.json) | Actual two Rust/SQLite processes and Worker synchronization of immutable publication versions/palettes/metadata/originals; reopen/revocation and stale/corrupt directories tested. Service capability1 required for library metadata. Native visual gate remains R17. |
| F07.10 | لم يبدأ | Font rights/missing dependency workflow |  | Implement and verify |

### F08 التعاون والصلاحيات

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| F08.01 | متحقق | Independent view/comment/edit/full roles and export policy | [canonical.test.ts](../../src/drawing/canonical.test.ts), [exportPolicy.test.ts](../../src/drawing/exportPolicy.test.ts), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Native authorization and actual byte writer |
| F08.02 | متحقق | Ephemeral cursor/tool/selection presence and follow/leave | [collaboration.test.ts](../../src/drawing/collaboration.test.ts), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Actual sockets without durable outbox |
| F08.03 | منفذ غير متحقق | Share-location/follow multi-pane UI | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Native multi-pane interaction |
| F08.04 | متحقق | Anchored threads/replies/mentions/resolve outside artwork | [collaboration.test.ts](../../src/drawing/collaboration.test.ts), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Native durable comments and resolution |
| F08.05 | متحقق | Immutable completed strokes and transient preview cleanup | [drafts.test.ts](../../src/drawing/drafts.test.ts), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Bounded previews outside journal |
| F08.06 | متحقق | Canonical ordering/revision preconditions/explicit conflicts | [canonical.test.ts](../../src/drawing/canonical.test.ts), [transport.test.ts](../../src/drawing/transport.test.ts), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Independent additions and stale/generation refusal |
| F08.07 | متحقق | Expiring server-validated fenced reservations | [gestureLeases.test.ts](../../src/drawing/gestureLeases.test.ts), [canonical.test.ts](../../src/drawing/canonical.test.ts), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Renewal, protected edit and exact acknowledgement |
| F08.08 | متحقق | Author-only Undo preserves others | [operations.test.ts](../../src/drawing/operations.test.ts), [objectTransforms.test.ts](../../src/drawing/objectTransforms.test.ts), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Foreign fields/artwork retained |
| F08.09 | متحقق | Offline durable queue/revalidation/recovery copy/revocation | [session.test.ts](../../src/drawing/session.test.ts), [drawing_sync.rs](../../src-tauri/src/drawing_sync.rs), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Native process restart and live access changes |
| F08.10 | متحقق | Rejected offline comments safely recover/resubmit | [rejectedComments.test.ts](../../src/drawing/rejectedComments.test.ts), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Owner-only content export and fresh authorized discussion |
| F08.11 | جزئي | Complete native multiuser/multi-pane UI acceptance | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Full visual/socket/access matrix beyond headless adapters |

### F09 الليزر

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| F09.01 | متحقق | Temporary trail never enters artwork/history/package/export | [laser.test.ts](../../src/drawing/laser.test.ts), [collaboration.test.ts](../../src/drawing/collaboration.test.ts) | Ephemeral model/awareness assertions |
| F09.02 | منفذ غير متحقق | Smooth release fade, adjustable lifetime/width/all colors | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Native visual/device/settings acceptance |
| F09.03 | جزئي | Cursor and reduced-motion behavior | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Native accessibility acceptance |
| F09.04 | متحقق | Shared laser and departure/disconnect cleanup | [collaboration.test.ts](../../src/drawing/collaboration.test.ts), [drafts.test.ts](../../src/drawing/drafts.test.ts), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Actual blue native laser and cleanup |

### F10 تصحيح الأشكال تلقائيًا

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| F10.01 | متحقق | Approximate right triangle becomes exact orthogonal shape | [recognition.test.ts](../../src/drawing/recognition.test.ts) | Right-angle geometry assertion |
| F10.02 | متحقق | Rough rectangle/ellipse normalize with confidence refusal | [recognition.test.ts](../../src/drawing/recognition.test.ts) | Shapes, tiny stroke and scribble fixtures |
| F10.03 | جزئي | Complete line/triangle recognition and real gesture set | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [recognition.test.ts](../../src/drawing/recognition.test.ts) | Expanded algorithms and physical gesture acceptance |
| F10.04 | منفذ غير متحقق | Optional toggle, retained freehand samples and Undo restoration | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Actual correction/Undo/native pen workflow |

### R18 قلم التحديد

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| R18.01 | منفذ غير متحقق | Persistent translucent highlighter, round/chisel and full colors | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [renderer.ts](../../src/drawing/renderer.ts) | Native tip/control/visual acceptance |
| R18.02 | متحقق | Straight-line highlighter option | [browser-formatting-checks.json](../../docs/drawing/qa/browser-formatting-checks.json), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Matching browser interaction/source invariants and native storage/sync evidence recorded; physical native UI/device and final whole-product acceptance remain separately open in R17. |
| R18.03 | متحقق | Uniform within-stroke pressure/taper geometry | [uniformStroke.test.ts](../../src/drawing/uniformStroke.test.ts) | Original sample/width/distance tests |
| R18.04 | منفذ غير متحقق | Separate stroke accumulation and readable content | [renderer.ts](../../src/drawing/renderer.ts) | Current independent pixel/native visual checks |
| R18.05 | متحقق | Persistent selection mask and author Undo | [selectionPaint.test.ts](../../src/drawing/selectionPaint.test.ts), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Owned stroke/mask journal; native highlighter export separate |
| R18.06 | جزئي | Full highlighter layer/mask/persistence/export acceptance | [renderer.ts](../../src/drawing/renderer.ts) | Complete current native combinations |

### R19 أنواع الفرش والألوان

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| R19.01 | منفذ غير متحقق | Nine-category reference menu with real stroke previews | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [renderer.ts](../../src/drawing/renderer.ts) | Current native full-size visual comparison |
| R19.02 | منفذ غير متحقق | Different normal/calligraphy/handwriting/airbrush/oil pigment | [renderer.ts](../../src/drawing/renderer.ts) | Current visual/native/export audit |
| R19.03 | منفذ غير متحقق | Different crayon/highlighter/natural-pencil/watercolor pigment | [renderer.ts](../../src/drawing/renderer.ts) | Current visual/native/export audit |
| R19.04 | متحقق | Independent remembered per-tool colors/settings | [preferences.test.ts](../../src/drawing/preferences.test.ts) | Alpha/ownership/tool slot recovery |
| R19.05 | منفذ غير متحقق | Full palette/recent colors for laser/brush/highlighter | [Colors.tsx](../../src/drawing/Colors.tsx), [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Complete native switching and palette behavior |

### R12 الحفظ والاسترجاع

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| R12.01 | متحقق | Atomic committed journal and assets-before-references | [drawing.rs](../../src-tauri/src/drawing.rs), [drawing_sync.rs](../../src-tauri/src/drawing_sync.rs), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | SQLite durable operations and owned source dependencies |
| R12.02 | متحقق | Serialized periodic checkpoints preserve concurrent input | [session.test.ts](../../src/drawing/session.test.ts) | Rebase, conflict and queued writer tests |
| R12.03 | متحقق | Integrity/checksum and required pre-migration backup | [package.test.ts](../../src/drawing/package.test.ts), [transport.test.ts](../../src/drawing/transport.test.ts), [drawing.rs](../../src-tauri/src/drawing.rs) | Damaged inputs and current Rust migration checks |
| R12.04 | منفذ غير متحقق | Actual saving/local/sync/error states | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Native state/error UI |
| R12.05 | متحقق | Renderer recovery retains work and retries lost acknowledgements | [session.test.ts](../../src/drawing/session.test.ts) | Restart/storage failure/idempotent record assertions |
| R12.06 | جزئي | Real crash/kill/relaunch and disk-full preservation | [session.test.ts](../../src/drawing/session.test.ts) | Actual native crash/disk-full faults and recovery UI |
| R12.07 | متحقق | Restore as new history preserves prior version and Undo | [drawing.rs](../../src-tauri/src/drawing.rs), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Atomic retry-safe restore across native replicas |
| R12.08 | متحقق | Bounded disk-backed Undo | [drawing_history.rs](../../src-tauri/src/drawing_history.rs), [undo.ts](../../src/drawing/undo.ts), [native-history-storage.json](../../docs/drawing/qa/native-history-storage.json) | Native SQLite author window200 edits/16MiB, author-only toggles, durable request retry and original retention. The complete canonical sync journal remains resident and is separately open underR16.08. |
| R12.09 | متحقق | Undo/versions/experiments remain distinct | [operations.test.ts](../../src/drawing/operations.test.ts), [drawing.rs](../../src-tauri/src/drawing.rs) | Separate journal/version/branch models |

### R13 الاستيراد والتصدير

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| R13.01 | متحقق | PNG/JPEG/WebP/BMP header/size/area preflight | [imageHeaders.test.ts](../../src/drawing/imageHeaders.test.ts), [imageIngest.test.ts](../../src/drawing/imageIngest.test.ts) | Independent real-format and refusal fixtures |
| R13.02 | متحقق | EXIF logical orientation and original encoded bytes | [imageIngest.test.ts](../../src/drawing/imageIngest.test.ts), [browser-image-ingest.json](../../docs/drawing/qa/browser-image-ingest.json) | Original hashes plus21 asymmetric browser pixel checks |
| R13.03 | متحقق | Animated static-frame choice retaining original | [animatedImage.test.ts](../../src/drawing/animatedImage.test.ts), [package.test.ts](../../src/drawing/package.test.ts), [browser-animation-checks.json](../../docs/drawing/qa/browser-animation-checks.json), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | 21 actual composited frames, original SHA, frame3 UI Cancel/Apply/Undo, Worker abort, native sync/second process/version/copy and portable original metadata roundtrip proved; physical/native UI gates remain R17. |
| R13.04 | منفذ غير متحقق | Localized unsupported/truncated/oversized input errors | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [imageIngest.test.ts](../../src/drawing/imageIngest.test.ts) | Complete native error UI states |
| R13.05 | منفذ غير متحقق | PNG transparency/JPEG matte/WebP quality export | [ExportDialog.tsx](../../src/drawing/ExportDialog.tsx), [renderer.ts](../../src/drawing/renderer.ts) | Current actual output and native saved-byte checks |
| R13.06 | متحقق | BMP export | [browser-formatting-checks.json](../../docs/drawing/qa/browser-formatting-checks.json), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Matching browser interaction/source invariants and native storage/sync evidence recorded; physical native UI/device and final whole-product acceptance remain separately open in R17. |
| R13.07 | متحقق | Sanitized SVG import/export | [SVG.md](../../docs/drawing/SVG.md), [browser-svg-ui.json](../../docs/drawing/qa/browser-svg-ui.json) | Current corresponding browser behavior and independent pixel/output evidence passed; installed-window and physical-device acceptance remains R17. Implement and verify |
| R13.08 | جزئي | System clipboard image read/write/paste | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [imageIngest.test.ts](../../src/drawing/imageIngest.test.ts) | Page writes pass; read stalled and was canceled; physical/native gate open |
| R13.09 | متحقق | Editable worldsdraw scene/assets/masks/effects/library/annotations/steps/checksums | [package.test.ts](../../src/drawing/package.test.ts) | Roundtrip/integrity and transitive pinned snapshots |
| R13.10 | متحقق | Package previews and optional experiment/history inclusion | [package.ts](../../src/drawing/package.ts), [portableHistory.ts](../../src/drawing/portableHistory.ts), [drawing_package.rs](../../src-tauri/src/drawing_package.rs), [PORTABLE-PROJECT.md](../../docs/drawing/PORTABLE-PROJECT.md), [browser-package-experiments.json](../../docs/drawing/qa/browser-package-experiments.json), [native-package-owned-originals.json](../../docs/drawing/qa/native-package-owned-originals.json), [native-package-source-policy.json](../../docs/drawing/qa/native-package-source-policy.json) | Preview/history/editable-experiment package; independent comparison bases/pins, atomic new-local import, owned originals, edit/Undo/reopen and independent text-only source policy. Main journal only; no crash-staging garbage collector, documented separately. |
| R13.11 | متحقق | Frame batch export | [frameArchive.ts](../../src/drawing/frameArchive.ts), [ExportDialog.tsx](../../src/drawing/ExportDialog.tsx), [browser-frame-archive.json](../../docs/drawing/qa/browser-frame-archive.json) | Selected-frame Arabic UI save; independent ZIP CRC/UTF-8 names/dimensions and every colored pixel; scale/document order/progress/cancel/source preservation. Native file-dialog release gate remains R17.06. |
| R13.12 | منفذ غير متحقق | Step image/project export with size/background/annotations/preview/cancel | [ExportDialog.tsx](../../src/drawing/ExportDialog.tsx), [Steps.tsx](../../src/drawing/Steps.tsx) | Current native full workflow |
| R13.13 | متحقق | Frozen export context and independent source-rights recheck | [exportPolicy.test.ts](../../src/drawing/exportPolicy.test.ts), [exportScope.test.ts](../../src/drawing/exportScope.test.ts), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Exact scope and native live refusal |
| R13.14 | جزئي | Sanitized metadata and redaction byte inspection | [renderer.ts](../../src/drawing/renderer.ts) | No hidden originals and full output inspection |

### R14 اختصارات لوحة المفاتيح

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| R14.01 | منفذ غير متحقق | Context B/E/G/I/T/V/M/L/Space shortcuts | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Physical/native keyboard matrix |
| R14.02 | متحقق | Customizable shortcuts | [shortcuts.ts](../../src/drawing/shortcuts.ts), [ShortcutsDialog.tsx](../../src/drawing/ShortcutsDialog.tsx), [shortcuts.test.ts](../../src/drawing/shortcuts.test.ts), [editor-ui-review.json](../../docs/drawing/qa/editor-ui-review.json) | Matching current real editor behavior observed in isolated full-App browser UI, with focused algorithm and native persistence/authority evidence listed. Physical installed-window and pen/touch gates remain R17. Owner-scoped validated mappings and complete settings UI; actual keyboard and native routing gate remains open. |
| R14.03 | منفذ غير متحقق | Undo/redo/deselect/fit/100-percent/bracket-size/swap | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | All actual key combinations |
| R14.04 | منفذ غير متحقق | Escape across transient gestures/workers/modals | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Full native cancellation behavior |
| R14.05 | منفذ غير متحقق | Protect text inputs/modals/Worlds shortcuts/active pane | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Physical native focus/routing acceptance |
| R14.06 | منفذ غير متحقق | Serialized keyboard grip edits | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [transformHandles.test.ts](../../src/drawing/transformHandles.test.ts) | Real rapid-key/focus acceptance |

### R15 تكامل Rust وMCP والمزامنة

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| R15.01 | متحقق | Validated TS/Rust registration/storage and durable originals | [operations.test.ts](../../src/drawing/operations.test.ts), [drawing.rs](../../src-tauri/src/drawing.rs) | Root/Rust invariant and roundtrip tests |
| R15.02 | منفذ غير متحقق | Dedicated view/create/navigation/search/thumbnail/embed | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [drawing_references.rs](../../src-tauri/src/drawing_references.rs) | Complete native rendered routing |
| R15.03 | متحقق | Drawing-aware template/duplicate paths | [drawing_copy.rs](../../src-tauri/src/drawing_copy.rs), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Actual native/MCP authorized and rejected copies |
| R15.04 | متحقق | Validated actual IPC/MCP command paths | [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Real worlds --mcp policy/template checks |
| R15.05 | متحقق | Dedicated sync adapter, immutable original transfer | [transport.test.ts](../../src/drawing/transport.test.ts), [drawing_sync.rs](../../src-tauri/src/drawing_sync.rs), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Native replicas and signed SHA checks |
| R15.06 | متحقق | Versions/restore/attachment dependency enumeration | [package.test.ts](../../src/drawing/package.test.ts), [drawing_copy.rs](../../src-tauri/src/drawing_copy.rs), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Transitive original and pinned revision retention |
| R15.07 | جزئي | Complete asset garbage-collection lifecycle | [model.ts](../../src/drawing/model.ts), [drawing.rs](../../src-tauri/src/drawing.rs) | Deleted/history/recovery/shared dependency retention audit |
| R15.08 | متحقق | No giant metadata or image-per-pointer snapshots | [drafts.test.ts](../../src/drawing/drafts.test.ts), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Bounded transient previews and operation storage |

### R16 الأداء وحدود الذاكرة

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| R16.01 | متحقق | Recorded benchmark hardware and reproducible fixture | [benchmarkFixture.ts](../../src/drawing/benchmarkFixture.ts), [benchmark-hardware.json](../../docs/drawing/qa/benchmark-hardware.json), [browser-benchmark-baseline.json](../../docs/drawing/qa/browser-benchmark-baseline.json) | Recorded actual CPU/GPU/OS/RAM and stable mixed fixture; native physical input and final GPU targets remain separate. |
| R16.02 | لم يبدأ | Measured60fps/30ms stroke target |  | Actual native input benchmark |
| R16.03 | منفذ غير متحقق | Measured1second local save and3second medium open | [native-storage-benchmark.json](../../docs/drawing/qa/native-storage-benchmark.json) | Actual Rust/SQLite4K30layer501node save70-85ms and open/load/validate41-93ms. Native window paint and GPU preparation remain unmeasured. |
| R16.04 | متحقق | 4K/30-layer/hundreds-node workload | [benchmarkFixture.ts](../../src/drawing/benchmarkFixture.ts), [browser-benchmark-baseline.json](../../docs/drawing/qa/browser-benchmark-baseline.json), [native-storage-benchmark.json](../../docs/drawing/qa/native-storage-benchmark.json) | Actual3840x2160/30-layer/600-node mixed renderer fixture and separate501-node native SQLite fixture ran; timings documented, no frame-rate or native-window acceptance inferred. |
| R16.05 | متحقق | Sparse512px tiles, viewport mip/spatial math and bounded caches | [tileSampling.test.ts](../../src/drawing/tileSampling.test.ts), [pigmentMip.test.ts](../../src/drawing/pigmentMip.test.ts), [tileCompositor.test.ts](../../src/drawing/tileCompositor.test.ts), [browser-formatting-checks.json](../../docs/drawing/qa/browser-formatting-checks.json), [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json), [browser-transform-pixels.json](../../docs/drawing/qa/browser-transform-pixels.json) | Fresh30 GPU/29 forced-Canvas checks plus numerical cache/mip tests; hardware/total-process performance remains R16 open. |
| R16.06 | جزئي | Background fill/filter/export | [DrawingView.tsx](../../src/drawing/DrawingView.tsx), [animatedImage.ts](../../src/drawing/animatedImage.ts) | Export worker and end-to-end cancellation |
| R16.07 | متحقق | Dimension/byte/work limits before unsafe allocation | [brushWork.test.ts](../../src/drawing/brushWork.test.ts), [pixelSelection.test.ts](../../src/drawing/pixelSelection.test.ts), [imageIngest.test.ts](../../src/drawing/imageIngest.test.ts) | Overload/late-cancel and dimensions checked |
| R16.08 | جزئي | Graceful actual memory/storage failures and total-process bounds | [renderer.ts](../../src/drawing/renderer.ts) | Native failure UX and measured process memory |

### R17 التحقق النهائي

| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |
| --- | --- | --- | --- | --- |
| R17.01 | جزئي | Full-size screenshots with capture provenance | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Current full application capture/review matrix |
| R17.02 | لم يبدأ | Light/dark/busy/narrow/wide/scaled screens |  | Capture/review all main screens |
| R17.03 | لم يبدأ | Long labels and Arabic across all screens |  | Complete typography/overflow audit |
| R17.04 | جزئي | Keyboard/focus/reduced motion | [DrawingView.tsx](../../src/drawing/DrawingView.tsx) | Full native accessibility/input acceptance |
| R17.05 | لم يبدأ | Physical native pen/touch/clipboard |  | Real device and system clipboard verification |
| R17.06 | لم يبدأ | Native export/relaunch |  | Actual application UI and saved files/reopen |
| R17.07 | جزئي | Full multi-client disconnect/access UI | [native-sync-headless.json](../../docs/drawing/qa/native-sync-headless.json) | Real native UI beyond headless46 checks |
| R17.08 | جزئي | Final tests/build/migration regression gate | [drawing.rs](../../src-tauri/src/drawing.rs) | Rerun after entire implementation and final source freeze |
| R17.09 | لم يبدأ | Original-scope final requirement audit |  | Every requirement and delivery gate must be proved |

## نطاق الأدلة الحالي

- rootTests: 287 passed,4 skipped after final source freeze
- rootTypecheck: passed with latest production build
- rustTests: 112 passed,1 ignored after final source freeze
- browser: Formatting source invariant checks plus actual UI text/path/gradient/color/snapping/minimap; current30 GPU/29 Canvas checks. Full native/visual release gates remain open.
- limitations: Native visual/device/clipboard/full screenshot/hardware targets remain open. Browser storage is synthetic; native52 evidence is actual isolated Rust/SQLite/Worker/MCP. No blanket release acceptance.
- productionBuild: Final NSIS and production frontend built; installed locally with exact executable match except expected three-byte NSIS bundle marker
- native: 52 actual native headless integration scenarios; installed owner schema6-to11 migration preserves all16pages195blocks32attachments5versions and integrityok
- hourTarget: [object Object]
- serviceTests: 51 passed after final source freeze; typecheck passed
- deliveryDeadline: [object Object]
- storage: 11 native history/storage/crash/capacity/import tests plus13 session/Undo tests
- library: 10 native/Worker checks, Rust5, rootlibrary/manager10, fullservice50 after publication hardening
