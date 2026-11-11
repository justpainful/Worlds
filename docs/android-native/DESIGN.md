# Worlds on Android: visual decisions

Locked before code. Every value below comes from the Windows and Apple apps, so the three read as one product.

## Subject
Worlds is a local-first workspace for pages, documents, spreadsheets, drawings and study. On Android it runs on phones, foldables, tablets and Chromebooks, and one person moves between those and the desktop.

## Vernacular
What the product already owns: a near-black obsidian canvas, Apple's system blue as the accent, the 3D product icon tiles from the desktop sidebar, capsule toolbars, the five destinations Home, Spaces, Library, AI and Search, the focus timer capsule.

## Palette
| Role | Dark | Light | Source |
| :--- | :--- | :--- | :--- |
| Canvas | `#0C0C0E` | `#F6F6F4` | Apple `WorldsPalette` |
| Sidebar | `#121215` | `#EFEFEC` | Apple `darkSidebar` |
| Card | `#18181C` | `#FFFFFF` | Apple `cardBackground` |
| Raised | `#242428` | `#F5F5F3` | Apple `raisedSurface` |
| Ink | `#F5F5F7` | `#1C1C1F` | Windows `--text-1` |
| Accent (blue) | `#2E92FF` | `#0066CC` | Apple system blue, lifted just enough to pass 4.5:1 on selected surfaces; white is the alternative |

Hairlines are white at 8% in dark and black at 7% in light. Dark mode is the default look because the sibling apps are dark first; light is fully supported.

## Type
- UI and text: Worlds Sans, built from Instrument Sans (Latin) and IBM Plex Sans Arabic (Arabic), the desktop pair. One file per weight so mixed Arabic and English lines stay in one family.
- Mono: system monospace for code.
- Scale from `tokens.css`: 34 title, 25 h1, 19.5 h2, 16 h3, 15.5 body, 13.5 UI, 12.5 small, 11.5 caption.
- Letter spacing stays 0, because tracking breaks joined Arabic letters. Arabic body line height stays at or above 1.68.

## Signature
Real glass only on floating chrome: the tab capsule, the toolbar capsule and the drawing tool dock. It samples the content moving behind it, blurs it and bends it at the edge, with one light from the upper left and a single uneven rim. Content stays on calm opaque cards, the same split as `worldsFloatingGlass` and `worldsContentCard` on Apple.

The glass request is the owner's brief and is derived from the product's own material system, so it is not decoration here.

## Layout across devices
- Under 600dp: full screen content under a floating tab capsule.
- 600dp and wider: sidebar with Workspace and Collections, collapsible.
- 840dp and wider: list and detail side by side.
- Destination, selection and drafts survive rotation, folding and window resizing.

## Motion
Press 100ms, selection 280ms with a spring, panel 300ms. Reduce motion removes the springs. Glass quality Disabled, and Android below 12, use solid surfaces with the same geometry.

## Apple control rules
Toggles are round thumb pills, sliders are thin with a white thumb, fields are filled with no outline, list selection is a trailing check, alerts centre the title above split buttons, and press feedback appears on touch down with no spreading ripple.
