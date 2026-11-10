# Project editing session

This experimental session keeps a full metadata baseline from the original read, applies known changes without dropping unknown fields, supports bounded undo and redo before saving, and commits through the repository's full-metadata compare-and-swap. A conflict or uncertain save invalidates the session and preserves the draft for recovery. Undo after a successful save is intentionally unavailable until a separate validated reverse transaction exists.

A repository must enforce live account and workspace permissions, secure-scoped access, links and atomic writes. This module does not provide UI, storage, archive filtering, cross-process policy, sync or permission grants. It remains disconnected from the application and package until the actual Rust bridge, Apple integration tests, conflict cases and UI review succeed.
