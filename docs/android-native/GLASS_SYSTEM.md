# Worlds glass on Android

Glass is only for floating chrome: the tab capsule, the toolbar capsule and the drawing dock. Content stays on calm opaque cards, the same split as `worldsFloatingGlass` and `worldsContentCard` on Apple. See [DESIGN.md](DESIGN.md) for the full visual decisions.

## How it works (`glass/WorldsGlass.kt`)

1. `Modifier.glassBackdropSource(backdrop)` records the content into a `GraphicsLayer`.
2. `Modifier.worldsGlass(shape)` draws that layer behind the control, offset to the control's position, through a `RenderEffect`: blur, then a saturation lift, then on Android 13 and later an AGSL lens that bends the backdrop along a rounded box distance field.
3. On top: a milky body, a sheen and one uneven rim, bright at the upper left. The shadow is clipped outside the shape so it never shows through.
4. `Modifier.worldsGlassLens(shape)` marks a selection inside glass. It has no edge.

## Rules

- One light, from the upper left, on every surface.
- One edge per piece of glass. No inset rings, no stacked borders.
- A control must sit outside the content recorded by its backdrop.
- Menus and dialogs are separate windows, so they cannot sample the app. Dialogs use window blur behind them on Android 12 and later.

## Fallbacks

| Case | Result |
| :--- | :--- |
| Android 13 and later | Blur, saturation and lens |
| Android 12 | Blur and saturation |
| Android 8 to 11 | Solid raised fill, same geometry and rim |
| Glass quality Disabled | Solid raised fill |
