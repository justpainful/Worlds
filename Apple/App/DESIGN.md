# Worlds Apple interface decisions

- Subject: a native, read-only view of real Worlds pages selected from an existing local database.
- Source: the page hierarchy and compact inspector language of Worlds; no invented content, actions or character assets.
- Palette: existing Worlds dark canvas #000000, sidebar #111113, deep surface #1c1c1e, primary text base #f5f5f7 and configurable accent #2e92ff from src/styles/tokens.css. SwiftUI semantic backgrounds and text adapt these roles in light mode and accessibility settings.
- Type: Apple system rounded title, system body and monospaced metadata. Dynamic Type uses title2, body and caption styles. The existing Instrument Sans and IBM Plex Sans Arabic are not substituted without licensing and localization review.
- Signature: a clear hierarchy of the user's own Worlds pages and their content, presented with native navigation, a restrained glass control and the existing warm accent.
- Explicit user requirements: system light and dark appearance, native Liquid Glass on supported systems, a Material fallback, and adaptive iPhone, iPad and macOS layouts.
- Motion: no decorative motion. Native navigation and accessibility settings determine transitions.
