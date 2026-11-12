/**
 * Arabic interface. Worlds' components are written with English text, so the
 * Arabic interface translates what they render: text, `title`, `placeholder`
 * and `aria-label`, from the dictionary in ./ar.json, as the page changes.
 *
 * It never touches what people wrote: the editor, anything editable, inputs,
 * code, and every element inside `[translate="no"]` (page titles, chat
 * messages, previews and other user content are marked with it).
 *
 * Dictionary keys are the English text with runs of white space collapsed.
 * Keys starting with "§" are patterns: `{0}`, `{1}` stand for the changing
 * parts, which are themselves translated when the dictionary knows them.
 */
import { setArabicDates } from "./locale";

export type UiLanguage = "en" | "ar";

export function resolveUiLanguage(language: string | null | undefined): UiLanguage {
  if (language === "ar") return "ar";
  if (language === "en") return "en";
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("ar") ? "ar" : "en";
}

const exact = new Map<string, string>();
const patterns: { re: RegExp; out: string }[] = [];
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Load a dictionary (exported for tests). */
export function loadDictionary(dict: Record<string, string>): void {
  exact.clear();
  patterns.length = 0;
  for (const [key, value] of Object.entries(dict)) {
    if (!value || key.startsWith("//")) continue;
    if (key.startsWith("§")) {
      const src = key.slice(1);
      // A slot right after a letter ("page{1}") is a plural ending and may be empty.
      // A slot at the start of a short pattern ("{0} pages") is a count or one word,
      // so it cannot swallow a sentence like "Plan my week from my pages".
      const parts = src.split(/\{\d\}/);
      const short = parts.join("").replace(/[^A-Za-z]/g, "").length < 12;
      const slot = (lit: string, i: number) => (/[A-Za-z]$/.test(lit) ? "(.*?)" : i === 0 && lit === "" && short ? "(\\S+)" : "(.+?)");
      const body = parts.map((lit, i) => escape(lit) + (i < parts.length - 1 ? slot(lit, i) : "")).join("");
      const re = new RegExp("^" + body + "$", "s");
      patterns.push({ re, out: value });
    } else exact.set(key, value);
  }
  // The most specific (longest literal text) patterns win.
  const literal = (re: RegExp) => re.source.replace(/\((?:\.[*+]\?|\\S\+)\)/g, "").length;
  patterns.sort((a, b) => literal(b.re) - literal(a.re));
}
/** The dictionary is only downloaded when the interface is Arabic. */
let loading: Promise<void> | null = null;
let dictionaryReady = false;
function ensureDictionary(): Promise<void> {
  loading ??= import("./ar.json").then((m) => loadDictionary(m.default as Record<string, string>));
  return loading;
}

/** Arabic for one piece of interface text, or null when there is none. */
export function translate(text: string, depth = 0): string | null {
  const key = text.replace(/\s+/g, " ").trim();
  if (!key || !/[A-Za-z]/.test(key)) return null;
  const hit = exact.get(key);
  if (hit !== undefined) return hit;
  if (depth > 1) return null;
  for (const p of patterns) {
    const m = p.re.exec(key);
    if (!m) continue;
    return p.out
      .replace(/\{(\d)\}/g, (_, i: string) => {
        const part = m[Number(i) + 1] ?? "";
        // English plural endings ("page{1}" with "s") have no place in Arabic.
        if (part === "s" || part === "es") return "";
        return translate(part, depth + 1) ?? part;
      })
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  return null;
}

/** Keep the white space around the text when replacing it. */
function swap(original: string, translated: string): string {
  const lead = /^\s*/.exec(original)![0];
  const trail = /\s*$/.exec(original)![0];
  return lead + translated + trail;
}

const SKIP = [
  '[translate="no"]',
  ".ProseMirror",
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[contenteditable="plaintext-only"]',
  "textarea",
  "code",
  "pre",
  "script",
  "style",
  "svg text",
  "[data-user-content]",
].join(",");
const ATTRS = ["title", "placeholder", "aria-label"] as const;

const texts = new Map<Text, { en: string; ar: string; group?: boolean }>();
const attrs = new Map<Element, Map<string, { en: string; ar: string }>>();
let observer: MutationObserver | null = null;
let queued = new Set<Node>();
let scheduled = false;

function skipped(el: Element | null): boolean {
  return !!el?.closest(SKIP);
}

/** Titles people gave their pages and chats: shown as written, never translated. */
let userTexts = new Set<string>();
export function setUserTexts(titles: Iterable<string>): void {
  const next = new Set<string>();
  for (const t of titles) {
    const k = t.replace(/\s+/g, " ").trim();
    if (k) next.add(k);
  }
  userTexts = next;
}

const INLINE = new Set(["B", "STRONG", "EM", "I", "MARK", "U", "CODE", "KBD", "SMALL", "SUB", "SUP"]);
const wordy = (n: Node | null) => !!n && (n.nodeType === Node.TEXT_NODE ? /[A-Za-z؀-ۿ]/.test((n as Text).data) : n instanceof Element && INLINE.has(n.tagName) && /[A-Za-z؀-ۿ]/.test(n.textContent ?? ""));

/** True when the text runs on with other words in the same sentence, like "Find <b>pages</b>". */
function isFragment(node: Text): boolean {
  if (wordy(node.previousSibling) || wordy(node.nextSibling)) return true;
  const parent = node.parentElement;
  return !!parent && INLINE.has(parent.tagName) && (wordy(parent.previousSibling) || wordy(parent.nextSibling));
}

/** An element holding only text pieces, as JSX makes of `Edited {time}` or `{n} pages`. */
function isTextGroup(el: Element | null): el is Element {
  if (!el || el.childNodes.length < 2) return false;
  for (const c of el.childNodes) if (c.nodeType !== Node.TEXT_NODE) return false;
  return true;
}

/** Translate the pieces of a text group as one sentence; false when there is no translation. */
function doGroup(el: Element): boolean {
  const nodes = [...el.childNodes] as Text[];
  const english = nodes.map((n) => {
    const t = texts.get(n);
    return t && n.data === t.ar ? t.en : n.data;
  });
  const joined = english.join("");
  const key = joined.replace(/\s+/g, " ").trim();
  if (userTexts.has(key)) return true;
  const ar = translate(joined);
  if (ar === null) return false;
  nodes.forEach((n, i) => {
    const out = i === 0 ? swap(joined, ar) : "";
    texts.set(n, { en: english[i], ar: out, group: true });
    if (n.data !== out) n.data = out;
  });
  return true;
}

function doText(node: Text) {
  const prev = texts.get(node);
  if (prev && node.data === prev.ar) return;
  if (skipped(node.parentElement)) return;
  const parent = node.parentElement;
  if (isTextGroup(parent)) {
    if (doGroup(parent)) return;
    // No sentence translation now: pieces translated together earlier go back to English.
    // Pieces translated on their own are left alone, or the two would undo each other forever.
    for (const c of parent.childNodes) {
      const t = texts.get(c as Text);
      if (!t?.group) continue;
      texts.delete(c as Text);
      if ((c as Text).data === t.ar) (c as Text).data = t.en;
    }
  }
  doSingle(node, texts.get(node));
}

function doSingle(node: Text, prev: { en: string; ar: string; group?: boolean } | undefined) {
  if (prev && node.data === prev.ar) return;
  if (!node.data.trim()) return;
  const key = node.data.replace(/\s+/g, " ").trim();
  // One word inside a longer sentence ("Find <b>pages</b> I haven't…") is not a label on its own.
  if (!key.includes(" ") && isFragment(node)) return;
  if (userTexts.has(key)) {
    // A page called "Meeting Notes" keeps its name.
    texts.delete(node);
    return;
  }
  const ar = translate(node.data);
  if (ar === null) {
    texts.delete(node);
    return;
  }
  const out = swap(node.data, ar);
  texts.set(node, { en: node.data, ar: out });
  if (node.data !== out) node.data = out;
}

function doAttrs(el: Element) {
  // A text box's content is the person's, but its placeholder and label are interface text.
  if (!ATTRS.some((a) => el.hasAttribute(a)) || (el.tagName === "TEXTAREA" ? skipped(el.parentElement) : skipped(el))) return;
  if (el instanceof HTMLInputElement && el.type !== "text" && el.type !== "search" && el.type !== "email" && el.type !== "url" && el.type !== "number" && el.type !== "password") {
    if (!el.hasAttribute("title") && !el.hasAttribute("aria-label")) return;
  }
  for (const name of ATTRS) {
    const value = el.getAttribute(name);
    if (value === null) continue;
    const seen = attrs.get(el)?.get(name);
    if (seen && value === seen.ar) continue;
    const ar = translate(value);
    if (ar === null) continue;
    let m = attrs.get(el);
    if (!m) attrs.set(el, (m = new Map()));
    m.set(name, { en: value, ar });
    el.setAttribute(name, ar);
  }
}

function doTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return doText(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (root instanceof Element) {
    if (root.tagName === "TEXTAREA") return doAttrs(root);
    if (root.matches(SKIP)) return;
    doAttrs(root);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      if (!(n instanceof Element) || !n.matches(SKIP)) return NodeFilter.FILTER_ACCEPT;
      if (n.tagName === "TEXTAREA") doAttrs(n);
      return NodeFilter.FILTER_REJECT;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text);
    else doAttrs(n as Element);
  }
}

function flush() {
  scheduled = false;
  const batch = queued;
  queued = new Set();
  // Our own edits come back as mutations too; doText and doAttrs skip them
  // because the node already holds the stored Arabic.
  for (const n of batch) if (n.isConnected) doTree(n);
}

function schedule(n: Node) {
  queued.add(n);
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(flush);
  }
}

function start() {
  if (observer || typeof document === "undefined") return;
  if (!dictionaryReady) {
    void ensureDictionary().then(() => {
      dictionaryReady = true;
      if (current === "ar") start();
    });
    return;
  }
  observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") schedule(r.target);
      else if (r.type === "attributes") schedule(r.target);
      else r.addedNodes.forEach(schedule);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  doTree(document.body);
  translateTitle();
}

function stop() {
  observer?.disconnect();
  observer = null;
  queued.clear();
  for (const [node, t] of texts) if (node.isConnected && node.data === t.ar) node.data = t.en;
  for (const [el, m] of attrs) for (const [name, t] of m) if (el.isConnected && el.getAttribute(name) === t.ar) el.setAttribute(name, t.en);
  texts.clear();
  attrs.clear();
  if (englishTitle !== null) document.title = englishTitle;
}

let englishTitle: string | null = null;
function translateTitle() {
  const ar = translate(document.title);
  if (ar !== null) {
    englishTitle = document.title;
    document.title = ar;
  }
}

let current: UiLanguage = "en";

/** The language the interface is shown in now. */
export function uiLanguage(): UiLanguage {
  return current;
}

/** Switch the interface language (and direction); safe to call often. */
export function applyUiLanguage(language: UiLanguage): void {
  const root = document.documentElement;
  setArabicDates(language === "ar");
  root.lang = language;
  root.dir = language === "ar" ? "rtl" : "ltr";
  if (language === current) {
    if (language === "ar") start();
    return;
  }
  current = language;
  if (language === "ar") start();
  else stop();
}

/** For code that builds strings outside the page (native dialogs, the window title). */
export function tr(text: string): string {
  return current === "ar" ? (translate(text) ?? text) : text;
}
