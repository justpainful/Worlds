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

# highlights
- new: أبرز ما في الإصدار || What matters most

# pages
- new: إضافة || Added
- improved: تحسين || Improved
- fixed: إصلاح || Fixed
```

Areas are the keys of `AREAS` in `build.mjs` (pages, cognition, drawing, claude, platforms, accounts...). Each area keeps one colour in every banner. The build fails on a dash, an unknown area, an item without a kind, or a line without both languages.

## The banner

Each release page opens with a map drawn from the release itself: an island for each area, sized by its number of changes, with a house for each change (fixes are paler) and a star for each highlight. The shapes are seeded by the version, so a release always draws the same map. The rules follow Cognition's world (`src/cognition/world.ts`).

## Adding a release

Write `releases/<version>.txt` from the commits since the last tag (`git log --no-merges v<old>..v<new>`), keep every change a person can notice, build, check it with `python -m http.server 1450 --directory web/changelog/site`, then deploy.
