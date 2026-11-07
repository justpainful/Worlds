# Apple native porting log

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
