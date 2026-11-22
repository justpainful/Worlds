# The control dashboard: design decisions

The owner asked for Symbolic's style (Symbolic/docs/DESIGN-RULES.md and
docs/design-system), so the brief wins over the usual web defaults:

- **Subject:** the Worlds team's control dashboard at admin.enterworlds.space: find an
  account, see everything the services keep about it, and act on it with a reason.
- **Palette:** Symbolic's roles, light and dark (src/styles.css `:root`). The accent is
  Symbolic's blue, used for the one main action, the selected sidebar row and focus.
- **Type:** SF Pro, then Segoe UI Variable; Arabic at 14 px with line-height 1.6 in rows
  (single lines in dense lists; paragraphs stay short).
- **Glass:** only on chrome (toolbar, capsules, the segmented lens, pop-ups, menus,
  dialogs, the phone tab bar). The thin dark edge line and the bright inner band
  (`--glass-edge`, white at low alpha) are Symbolic's measured edge model, not a
  decorative border. Content sits on solid grouped sections.
- **Dark mode** follows the system (Automatic) and can be set by hand; it is not the default.
- **Icons:** SF Symbols from the owner's Symbolic library (src/symbols.ts, made with
  Symbolic's tools/render/glyph.py). Licensed for Apple platforms; the owner keeps the
  decision on using them in this page (docs/admin/PLAN.md, section 11).
- **Signature:** the security log in plain words, each line naming who did what to whom,
  with the reason the team member wrote.

Scanner notes (antislop):
- `letter-spacing: 0` on Arabic is the rule, not a breach; the 0.35em spacing is only on
  the six-digit code field, which holds Latin digits.
- `outline: none` on the search input and on the menu box: the search capsule draws the
  focus ring (`.search:focus-within`), and the menu shows the active row in accent.
