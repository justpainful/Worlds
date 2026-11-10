# Experimental project form

This independent SwiftUI form requires an injected authorized ProjectRepository. It stages status, date and description changes, validates the complete form before staging, and supports undo and redo of staged changes. Save stages the current form and performs a full-metadata compare-and-swap through ProjectEditingSession. A conflict disables further saving and keeps the typed fields visible; reload explicitly confirms discarding unsaved changes. No mock service or product entry point is provided.

The view and its service have not been built, UI-tested or reviewed visually on Apple. Text field focus, accessibility, RTL, long content, multiple windows, live authorization and scope lifetimes remain unverified. Linking resources, creating children, attachments, shared workspaces and undo after a committed save are not implemented. Do not enable this form in the app before end-to-end integration, conflict and permissions review.

The form is intended to be hosted in a sheet and requests confirmation before discarding staged or typed changes. It emits a callback after a successful save so the host can refresh displayed metadata. These behaviors and scope lifetime are not yet verified in a real UI.
