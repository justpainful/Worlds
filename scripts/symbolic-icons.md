# Symbolic icons (machine-local)

Settings > Appearance > Icons shows a Symbolic choice when `private/symbolic/`
holds SF Symbols exported from the owner's Symbolic library. SF Symbols are
licensed for Apple platforms, so they stay in `private/` (ignored by git) and
never reach a public build, which is made from a clean checkout.

To fill the folder: start Symbolic with Plugins > AI Bridge on, then export the
names listed by `symbolicNames()` in `src/ui/symbolicMap.ts` as monochrome SVG
(weight regular) into `private/symbolic/`, one file per symbol named
`<symbol name>.svg`.
