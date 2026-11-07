# Apple native porting log

## 2026-11-07: Native core started

- Added a Swift 6 package with open JSON editor values, resource summary and block models, plus round-trip compatibility tests. These models do not yet implement storage or the editor.
- Added binary `worlds-sync.v1` frame encoding and decoding with golden examples from the existing lib0 format. This is framing only: Yjs, network transport, persistence, awareness lifecycle and collaboration are not yet implemented.
- Added a detailed source-based drawing inventory and an initial native design brief.
- Prepared a macOS CI workflow for package tests and native build checks. The Windows host cannot run Swift or Xcode; no Apple build or test has yet passed. Intermediate empty applications must not be distributed as completed products.
- The 29 grouped rows in the preliminary parity matrix still contain zero complete, verified native features. The inventory is not exhaustive, so this is not a defensible whole-project percentage.

### First CI run

[Actions run 42383880774](https://github.com/justpainful/Worlds/actions/runs/42383880774) built the initial empty iPhone, iPad and macOS targets, but the Swift package test job failed to compile a raw string in a test fixture. That syntax was corrected locally and must be rerun. These successful target builds are infrastructure evidence only; they do not validate the actual application, UI or feature parity.

## 2026-11-07: Audit started

- Created isolated worktree on branch `feat/native-apple-platforms` at commit `185ee9a1019c8b7bc685d22dabf1b699579189cc`. The original Windows checkout has existing tracked modifications and untracked files, including drawing work. They have not been moved or deleted.
- Started a source-based parity inventory and separate frontend, backend and build audits. These are partial: all source paths, actual behaviors and known issues have not yet been exhaustively traced or run.
- Identified protocol and execution constraints requiring investigation: Yjs wire compatibility, device-bound sign-in, on-device Claude Code subprocesses, drawing synchronization, background automations and platform-specific screen annotation.
- The host has no Swift or Xcode. Apple builds, simulator tests, device runs, screenshots and packaging have not been performed.
- No native feature is implemented or verified at this point. No Apple release artifact exists. No completion percentage can be calculated until the full inventory and acceptance criteria are established.

## Next required work

1. Finish the source and service audit, including every original checkout change relevant to product behavior. Complete and split the parity matrix into independently testable features.
2. Record an evidence-based design brief using the existing product identity and adaptive layouts. Resolve source data and service contracts before designing the shared native core.
3. Implement complete native workflows and their real integrations. Establish reproducible Apple CI and test and visually review each workflow before marking it complete.
4. Produce and verify unsigned packages only after functional and visual gates are met. Record Actions run links and artifact provenance.
