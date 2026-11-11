# AI conversation interface decisions

- Subject: viewing and continuing an actual Worlds conversation through an injected authorized service.
- Source: Worlds' existing conversation list, streamed answer and tool activity; the interface shows only data delivered by the service.
- Palette: system semantic backgrounds and text for light and dark, plus the existing Worlds accent #2e92ff in dark and #0066cc in light from the current native design.
- Type: Apple system title, body and caption using Dynamic Type. Messages remain selectable and preserve bidirectional text.
- Signature: the streamed answer and its real tool activity share one timeline, keeping the user's conversation as the focus.
- Motion: native scrolling and progress only, with no decorative animation. Reduce Motion is respected by avoiding forced animated scrolling.
- Boundaries: no fabricated chat history or clickable controls without a service capability. The host supplies authorization, persistence, runtime and attachments. A local process runtime is not available on iPhone or iPad in the existing implementation.
