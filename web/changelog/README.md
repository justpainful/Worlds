# changelog.enterworlds.space

Every Worlds release, with every change, in Arabic and English. `node web/changelog/build.mjs` turns the files in `releases/` into `site/` (git-ignored): an index, a page per release, an Atom feed per language and a sitemap. Design decisions are in [docs/web/UPDATES-STATUS-DESIGN.md](../../docs/web/UPDATES-STATUS-DESIGN.md).

## A release file

`releases/<version>.txt`, written in formal Arabic, then ` || `, then English:

```
version: 1.0.0
date: 2026-11-21
published: no                      (only when the release had no installers of its own)
title: عنوان الإصدار || Release title
summary: سطر واحد للقائمة || One line for the list
intro: فقرة تفتح صفحة الإصدار || The paragraph that opens the release page
note: ملاحظة اختيارية || An optional note
feature: pages all :: عنوان البطاقة :: سطر يشرحها :: نص الرابط || Card title :: One line about it :: Link text
feature: cognition cognition :: Cognition :: سطر يشرحها || Cognition :: One line about it

# highlights
- new: أبرز ما في الإصدار || What matters most

# pages
- new: إضافة || Added
- improved: تحسين || Improved
- fixed: إصلاح || Fixed
```

Areas are the keys of `AREAS` in `build.mjs` (pages, cognition, drawing, claude, platforms, accounts...). Each area keeps one colour on every page. The build fails on a dash, an unknown area, an item without a kind, or a line without both languages.

## The release panel

Each release page opens with a dark panel: the version, the title, and a card for each `feature:` line. A card has a line drawing on near-black above its title and words on charcoal, and links to its area on the page (`all` links to every change). The newest release shows the same panel at the top of the list; older releases show their first drawing on a card.

The drawings are in `art.mjs`: white lines on a 160 x 120 canvas, a little loose, one meaning each. Add a new drawing there when no existing one fits a release; the build fails on a drawing it does not know or a feature whose area has no changes. Every release needs at least one feature, and two read best.

## Adding a release

Write `releases/<version>.txt` from the commits since the last tag (`git log --no-merges v<old>..v<new>`), keep every change a person can notice, build, check it with `python -m http.server 1450 --directory web/changelog/site`, then deploy.
