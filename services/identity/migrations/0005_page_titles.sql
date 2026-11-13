-- Page titles for the shared pages list on phones (docs/PACKS.md). Devices
-- that mirror the tree may send a page's title with it; the service returns
-- it only with pages the caller can open. Older devices send none, so the
-- column stays null and apps show the page ID instead.
ALTER TABLE pages ADD COLUMN title TEXT;
