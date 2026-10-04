# Worlds: collected goals for the next big build

Goals are gathered here first and built together once the list is complete.

## 1. Claude chat: complete redesign

**What the user said:** the chat looks bad and incomplete. It should match modern Codex in its details, with special attention to the composer (the writing area has problems), and at the same time look like Apple Intelligence (reference images: the Siri prompt capsule over a wallpaper, and the Siri chat panel beside Keynote and Notes on macOS).

**What the references show (to carry over):**
- Apple Intelligence prompt capsule: a wide, very rounded dark glass capsule floating over content; large, light-weight type; the caret and edge carry the soft multicolour Apple Intelligence glow; a quiet inline hint ("Ask Siri") after the text; a small secondary glass pill under it ("Show Results").
- Apple Intelligence chat panel: a tall dark glass sheet with generous radius; close (x) top-left and expand top-right as round glass buttons; the user message as a compact right-aligned bubble; the answer as plain, airy text with no bubble; the composer at the bottom as a single capsule with a round "+" on the left, the field in the middle, and a mic on the right.
- Codex-level detail: a composer that never fights the user (auto-growing field, stable layout, clear send/stop state, attachments and context as tidy chips, model and effort in the composer itself), readable streaming of work (steps, files touched), and polished conversation management.

**Known problems to fix:** the composer layout and behaviour (writing area), the overall look of the panel and the full view.

## 2. Liquid Glass and icons: closer to the references

**What the user said:** improve the Liquid Glass and the icons so they resemble the reference images.

**What the references show:**
- Mail toolbar (macOS 26): related actions sit together in one thick, bright glass capsule (reply / reply all / forward; archive / delete / junk), separated only by faint hairline dividers inside the capsule; single actions get their own round glass button; generous height (~48px), full capsule radius; the glass reads as a bright, milky lens over the page with a crisp light rim and soft shadow; icons are bolder, rounded SF-style glyphs at a larger optical size, black on light glass.
- Files window (light): the whole window is translucent glass; the desktop shows through, blurred and colour-tinted; content (filter chips, section titles, thumbnails) sits directly on the glass.
- Music player (dark): a glass window with strong, clearly visible refraction of the wallpaper at the edges (thick rim that bends light), deep rounded corners, bright rim highlight.
- Liquid Glass settings sample: translucent window, inner glass cards with a darker tint, pill controls, all keeping the backdrop visible.
- Music capsule: the liquid "bulge" where the album art's lens merges into the capsule (two shapes melting into one continuous glass body with refraction along the join).

**Direction:** stronger, more visible refraction and rim light; toolbar actions grouped into shared capsules with internal dividers; liquid merging between neighbouring glass shapes; one bolder icon style at larger optical sizes in glass controls.

## 3. Window dragging and resizing

**What the user said:** I can't drag the app from one screen to another, and I can't resize it freely.

**Direction:** reliable window dragging from every empty chrome area (sidebar top, toolbar gaps, empty tab-strip space, title areas) including double-click to maximise and Windows Snap; comfortable resizing on all edges and corners; correct behaviour across monitors with different scaling.

## 4. Window transparency (the app itself)

**What the user said:** add the option to make the app itself transparent, with a transparency built to look like the second reference image (the light Files window that shows the blurred desktop through it).

**Direction:** a real see-through window (desktop visible behind, blurred and tinted), user-adjustable in Settings (off / subtle / strong), keeping text readable; content surfaces stay calm while the window body becomes glass.

## 5. Replace all icons with Apple-style product icons

**What the user said:** change all the icons to follow Apple's app-icon philosophy (Settings, Safari, Photos, Messages): each icon is a *miniature product render*, not a symbol in a square. Use the supplied Discord icon as is, and the supplied Claude icon.

**Supplied assets** (saved in `assets/reference/`):
- `discord-icon.png`: purple squircle with a vertical gradient (lighter top), the Discord mark as a soft, slightly embossed white body with inner lavender shading and a soft drop shadow. Use this one for Discord.
- `claude-icon.png`: a coral macOS-style folder with the Claude asterisk embossed in light grey. Use for Claude (only 256px, so it needs a clean high-resolution rebuild that matches it exactly).

**The user's rules for building icons (in order):**
1. Start from a clear black/white silhouette and a strong metaphor (gear, compass, flower): the icon must be recognisable from its outline alone, even tiny.
2. Test the silhouette at very small sizes.
3. Split the body into only 3 to 6 real layers: background, main body, cavities, edges, highlight, shadows, reflections (never a single gradient).
4. Add a gentle bevel on edges.
5. Add soft ambient shadow inside and outside (diffuse, never hard black); ambient occlusion in cavities.
6. Add one or two soft highlights; small rim light on edges; broad soft light from top/front.
7. Give each icon a material with its own response: metal, glass, plastic, paper (different roughness and lighting).
8. Then reduce every effect by 20 to 30 percent; the first pass is always overdone.
9. Test on light and dark backgrounds.
10. Small details must never carry the meaning. Optical (not mathematical) centring. Controlled colour: one main hue with lighter/darker steps, no blanket high saturation. Details reduce as the size shrinks (separate small-size versions, not just downscaling).
- macOS 26 / Liquid Glass direction: layered, semi-physical icons (front surface, depth, reflection, sometimes translucency) while the core symbol stays clear and never dissolves into the glass.

**Scope (agreed approach):** app icon, sidebar and navigation icons (Home, Claude, Templates, Automations, Integrations, Activity, Trash, Settings, Profile), integration icons (Discord, Claude), file-type icons (presentation, sheet, document, PDF, image, video, audio, code), and how rich icons coexist with the small line glyphs used inside dense toolbars.

## 6. Profile: a major redesign

**The user's vision** (blend of Apple Music calm and hierarchy, the new TikTok's big banner and overlapping avatar, plus Worlds' own glass):
- **Banner** is large (about 30 to 35 percent of the visible profile), edge to edge at the top, image or GIF. Its dominant colour bleeds downward and the last 50 to 80px dissolve into the page material: no visible line where the banner ends. Dark banners switch text and controls to light automatically. GIFs play at full quality but calmly; Reduce Motion shows a still frame.
- **Avatar** (120 to 140px on desktop) breaks the banner edge, with a thin near-glass ring that adapts to what is behind it (darker over light areas, lighter over dark) instead of a fixed stroke. Presence or verification is one tiny indicator beside it, never stacked rings. On desktop the avatar sits on the left of the content column (Avatar, Name, Metadata, Content reading order).
- **Name** large and clear (display weight), the handle small and secondary beneath; at most one small badge (for example Owner), never a row of badges.
- **Status / presence** line under the name, very secondary (for example "● Exploring Game Development").
- Then **bio**, small **links**, then **stats** shown the light Apple way (number above label, wide spacing, no heavy dividers; compact "n · n" form when narrow).
- **Actions:** one clear primary button; the rest as small round Liquid Glass buttons (share, more).
- **Background:** the profile page itself is one large glass canvas whose tint and temperature come from the banner (light from the banner entering the material), not a glass card on a background and not a visible gradient. Banner, background and content read as one continuous surface.
- **Scroll choreography:** banner parallaxes slowly; avatar shrinks; name rises; at a threshold the top becomes a glass toolbar ("◀ [avatar] name ... •••"), with the same elements moving into place on springs, no cuts.
- **Tabs** below the blocks (for example Pages / Media / About), then content.

**Adaptation for Worlds (local, single-user):** there are no followers or likes; stats and actions must be real (see question to the user at build time).

## 7. Profile Blocks (widgets)

A customizable section between the bio/stats and the tabs: rich, consistent blocks the user adds and arranges. Order: Banner, Avatar + Name, Bio + Stats + Actions, **Profile Blocks**, Tabs.

**Block types (template + custom fields, never a free canvas):**
1. **Info (hero):** small label, title, subtitle, image/logo on the side, optional badge/status, link, accent colour.
2. **Progress:** title, left caption, right value, current/max, style, leading icon. (Reference: "Current Session 1h 24m / 2h, 67/100".)
3. **Quote / Statement:** small label, statement, subtext, side image/mascot, alignment. (Reference: "The penguin remembers. / I make it unfair / do not disturb the process" with the frog mascot.)
4. **Grid:** 2x2, 1x4, 3x2 items, each with icon/image, title, subtitle, optional link. (Reference: Game Development / Product Design / Software Engineering / Creative Direction with glossy app-style icons.)
5. **List:** 3 to 6 rows with icon/thumbnail, title, subtitle.
6. **Media:** image, GIF, or short silent video, with fit Contain / Cover / Original, plus a focus point for Cover (center, top, bottom, left, right, or custom).
7. **Fields:** key-value rows (Location, Role, Server, Main Game, Focus).
8. **Links / CTA:** one or more buttons (Store, Discord, Portfolio, GitHub).
9. **Badge shelf:** a few small badges.
10. **Dynamic (connected):** updates itself from Worlds data or integrations (for example current session, Discord bot status, latest page, streaks).

**Settings per block:** title, subtitle, description, icon, image, image mode, accent colour, background style, layout (image left/right/top/full background), link / click action, visibility, size.
**Style presets:** Soft Glass, Tinted Glass, Solid (like the reference image: dark solid card, soft border, artwork bleeding off the right edge), Compact, Showcase, Minimal. The user said blocks are either Liquid Glass or like the reference image.
**Layout:** a 12-column grid on desktop with fixed sizes (12x1, 6x1, 4x1, 6x2, 12x2); auto-aligned; collapses to one or two columns when narrow.
**Edit mode:** "Customize Blocks": add (Apple-style picker of types), remove, reorder by drag, resize, edit content, live preview.
**Limits:** 8 to 12 blocks, first 3 are "featured", some types limited to two instances, fixed sizes, always aligned.
**Visual language:** same as the profile: large radii, subtle glass or tint, very light shadows, tidy spacing, calm motion.

## 8. Liquid Glass as a background (optional)

The user's earlier suggestion: a real Liquid Glass background (for the profile, and wherever it makes sense) as an **option** in Settings, never forced. Ties in with goal 4 (window transparency) and goal 6 (profile glass canvas).

## 9. Pages 2.0 (major features, not side features)
- **Cover** on every page using the same banner engine as the profile (smart height, focus and zoom crop).
- **Icons** from the product icon set as page icons (picker with Icons / Emoji / Upload, search in English and Arabic).
- **Properties** under the title: Status, Tags, Date, Number, Checkbox, URL, Text, Select. Stored per page, searchable.
- **Collection block**: a live view of subpages (or pages with a tag) as Table, Board (grouped by Status), Gallery or List, with sort and filter by properties, inline editing and "New" in place.
- **Columns** block (2 or 3 columns) for layouts.
- **Toggle** blocks and toggle headings (collapsible).
- **Outline**: a floating table of contents with scroll spy, plus reading stats (words, reading time).
- **Page style**: font (Default, Serif, Mono), small text, full width.

## 10. Banner and avatar cropping
- Adjust sheet for banner and avatar: drag to choose the area, zoom slider, Smart button, reset. Avatar crop is circular.
- Banner algorithm: height from the image's own proportions within bounds, upscale guard for small images, automatic focus from image saliency when none is set.

## 11. Frame block (profile)
Photos the way the user's LiquidGlassWidgets Frame widget lays them out: shapes square, circle, classic 4:3, upright 3:4, phone 9:16, portrait, column 1:3, wide, pano 3:1, large, auto (the picture's own ratio); fit Fill or Whole (whole shows a blurred, darkened copy behind instead of bars); radius, shadow on or off, an optional line of text top or bottom, and a slideshow of several photos with an interval. No card behind the photo: the art is the widget.

## 12. Settings in the Apple style
System Settings layout: search, profile card, coloured icon tiles, grouped inset lists with footnotes.

## 13. Icons
- Interface glyphs larger and heavier (SF Symbols medium feel); menus denser so text behind never competes.
- 100 more product icons now (one agent), 200 later.

## 14. Collaboration with accounts and strong permissions
Every person has their own account; strong page-level permissions; the app stays local-first. Backend on Cloudflare, server-enforced permissions, passkeys plus email codes, the owner's own Discord bot is never shared. Full plan and phases: docs/COLLAB.md.
