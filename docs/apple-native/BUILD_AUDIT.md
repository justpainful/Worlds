# Apple native build and dependency audit

Audit date: 2026-11-07. Scope: repository build configuration, current CI, dependencies and test inventory. This is an initial audit, not a claim that all source code or feature behavior has been verified. Paths below are relative to the repository root.

## Baseline and environment

- The isolated worktree is on `feat/native-apple-platforms`. The original checkout was on `main` with 173 changed or untracked entries when checked. Those local changes are not automatically part of this branch; compare them explicitly before claiming a complete feature inventory or parity.
- The execution host is Windows. Neither `swift` nor `xcodebuild` was found on its PATH. Apple builds, simulators, native visual inspection and installation therefore remain unverified locally.
- `git ls-files '*Package.swift' '*project.pbxproj' '*.swift'` returned no tracked native Apple source or Xcode project in the audited baseline. This does not establish parity.
- The repository is `justpainful/Worlds`, public, with `main` as its default branch. Access to repository metadata and historical Actions logs was confirmed. Actual eligibility, quota and successful execution of a new macOS workflow have not been verified.

## Existing build and dependencies

- `package.json` defines the frontend as React, TypeScript, Vite and Tauri 2. `pnpm build` runs `tsc -b && vite build`; `pnpm test` runs Vitest. `pnpm-lock.yaml` locks dependencies. This is the existing Windows application and must remain intact.
- The actual dependency manifest includes Tiptap and Yjs, y-protocols and lib0, Mermaid, KaTeX, Three.js, dxf-parser, occt-import-js, SheetJS XLSX, docx-preview and hls.js. Their presence establishes dependencies, not that every related feature has been audited or ported. Their data formats and actual call sites need separate parity analysis.
- `src-tauri/Cargo.toml` builds `staticlib`, `cdylib` and `rlib` and currently depends on Tauri, bundled SQLite through rusqlite, Tokio, reqwest, and keyring including an Apple-native feature. Windows-specific APIs are gated under `cfg(windows)`. The existence of a static library target does not establish iOS or macOS compatibility or a safe Swift interface; dependency isolation, FFI and platform support require investigation.
- `services/identity/package.json` uses Hono and SimpleWebAuthn. `services/sync/package.json` uses Yjs, y-protocols and lib0. Both use Cloudflare Workers tooling and their own package locks and test commands. Preserve protocol and service compatibility; do not infer a compatible native Yjs implementation merely from a build passing.

## Existing verification and CI

- `.github/workflows/ci.yml` runs on Windows: frontend install, TypeScript checking, Vitest and production build; Rust formatting, Clippy and tests. It triggers on pushes to `main` and pull requests.
- `.github/workflows/identity.yml` and `.github/workflows/sync.yml` run type checking and service tests on Ubuntu with path filters. There is no Apple workflow in the audited baseline, nor a native Apple screenshot or XCTest suite.
- The current baseline has 89 files matching `*.test.ts`, `*.test.tsx` or `*tests.rs` according to `rg --files`; this is a file count, not a test count or a coverage claim. `vitest.config.ts` runs frontend tests separately from service tests. Existing suites include sync, authentication and drawing behavior; they do not prove Apple compatibility.
- Latest observed CI run [42201800857](https://github.com/justpainful/Worlds/actions/runs/42201800857), 2026-11-06: frontend succeeded; Rust failed at the Format step (`cargo fmt --check`). The failure precedes any conclusion about later Rust steps.
- Latest observed Sync service run [42201800982](https://github.com/justpainful/Worlds/actions/runs/42201800982), 2026-11-06: type checking failed with unresolved `@tiptap/core` and `yjs` imports in shared frontend files and related TypeScript errors. The workflow installs the service dependencies in `services/sync`; investigate cross-package dependency resolution before attributing a definitive root cause. Tests did not establish a passing result for that run.
- The latest observed Identity service run [38275341413](https://github.com/justpainful/Worlds/actions/runs/38275341413) succeeded. These are historical remote runs and do not verify the current local working tree.
- `docs/drawing/STATUS.md` documents partial and unverified drawing behavior, including native input and visual acceptance gaps. Existing drawing feature completeness must be assessed from actual source and evidence, not assumed from labels or a past percentage.

## Apple build constraints and open work

- GitHub documents `macos-26` and `macos-15` hosted runners and has retired macOS 14 hosted images from GitHub Actions. See [runner images](https://github.com/actions/runner-images). A macOS 14 deployment target can still be configured, but running tests on macOS 14 requires another suitable machine or runner. The actual repository's access and build success must be demonstrated by a run.
- The current GitHub macOS 26 image documentation lists the installed Xcode tools and SDKs; check the exact image at execution time and explicitly select an available stable Xcode: [macOS 26 image](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md). Runner images change over time.
- Native `glassEffect` requires an SDK that exposes Apple's API and an availability-guarded fallback for earlier OS releases. Refer to [Apple's glassEffect documentation](https://developer.apple.com/documentation/swiftui/view/glasseffect(_:in:)). No implementation or rendered result has been verified yet.
- No unsigned iPhone or iPad IPA, macOS app, ZIP or DMG, simulator screenshot matrix, Apple XCTest or XCUITest results, or successful Apple Actions run was established by this audit. An unsigned device IPA cannot be represented as directly installable on a physical device.
- The user explicitly requires tests and visual QA in the current specification. Prior instructions to omit tests for the previous drawing task do not replace these current requirements.
