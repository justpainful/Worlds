/**
 * Messages to people outside Worlds about a pack item (docs/PACKS.md): a
 * note to a parent about an absence, a payment reminder to a client. Worlds
 * fills the message in from the item and opens it in the person's own
 * WhatsApp or email; they send it themselves, so nothing leaves without
 * them. These helpers are the pure part.
 */
import type { PageMeta } from "../lib/types";
import type { KindDef, MessageDef, PackDef } from "./definition";
import { formatField, type ItemData } from "./fields";
import { matchesAll, todayIso } from "./rules";
import { inLanguage } from "./samples";

export interface MessageDraft {
  channel: "whatsapp" | "email";
  /** The number (digits, with country code) or address. */
  to: string;
  /** Who it goes to, when the item says. */
  name: string;
  text: string;
}

/** An item's fields, as items.ts reads them (kept here so this stays free of the app API). */
const itemData = (p: Pick<PageMeta, "data"> | undefined): ItemData => {
  const d = p?.data;
  return d && typeof d === "object" && !Array.isArray(d) ? (d as ItemData) : {};
};

const ARABIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

/**
 * A phone number as WhatsApp wants it: digits with the country code. A Saudi
 * mobile written locally (05xxxxxxxx) gets 966; 00 in front is dropped.
 * Returns "" when it is not a number.
 */
export function whatsappNumber(raw: string): string {
  const western = raw.replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10));
  let digits = western.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^05\d{8}$/.test(digits)) digits = "966" + digits.slice(1);
  return digits.length >= 8 && digits.length <= 15 ? digits : "";
}

/** The link that opens the message ready to send. */
export function messageUrl(d: MessageDraft, subject = ""): string {
  if (d.channel === "whatsapp") return `https://wa.me/${d.to}?text=${encodeURIComponent(d.text)}`;
  const q = [subject ? `subject=${encodeURIComponent(subject)}` : "", `body=${encodeURIComponent(d.text)}`].filter(Boolean).join("&");
  return `mailto:${d.to}?${q}`;
}

/** Whether a message is offered for this item now. */
export function messageOffered(m: MessageDef, data: ItemData, today = todayIso()): boolean {
  return matchesAll(m.when, data, today);
}

/**
 * The message filled in for one item, or null when there is no one to send
 * it to (no linked item, no number or address).
 */
export function draftMessage(
  m: MessageDef,
  pack: PackDef,
  kind: KindDef,
  page: PageMeta,
  pages: Record<string, PageMeta>,
  lang: "en" | "ar" = "en",
): MessageDraft | null {
  const data = itemData(page);
  const locale = lang === "ar" ? "ar-u-nu-latn-ca-gregory" : "en";
  const titleOf = (id: string) => pages[id]?.title ?? "";
  const viaField = m.to.via ? kind.fields.find((f) => f.id === m.to.via) : undefined;
  const viaId = viaField && typeof data[viaField.id] === "string" ? (data[viaField.id] as string) : null;
  const viaPage = viaId ? pages[viaId] : undefined;
  const viaKind = viaField?.to ? pack.kinds.find((k) => k.id === viaField.to) : undefined;
  if (m.to.via && (!viaPage || !viaKind)) return null;
  const target = m.to.via ? { data: itemData(viaPage), kind: viaKind! } : { data, kind };

  let channel: MessageDraft["channel"] | null = null;
  let to = "";
  for (const id of m.to.fields) {
    const f = target.kind.fields.find((x) => x.id === id);
    const v = target.data[id];
    if (!f || typeof v !== "string" || !v.trim()) continue;
    if (f.type === "phone") {
      to = whatsappNumber(v);
      if (to) channel = "whatsapp";
    } else if (f.type === "email" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) {
      to = v.trim();
      channel = "email";
    }
    if (channel) break;
  }
  if (!channel) return null;

  const show = (k: KindDef, d: ItemData, id: string) => {
    const f = k.fields.find((x) => x.id === id);
    return f ? formatField(f, d[id], locale, titleOf) : "";
  };
  const text = inLanguage(m.text, lang).replace(/\{([a-zA-Z]+)(?:\.([a-zA-Z]+))?\}/g, (whole, a: string, b?: string) => {
    if (a === "title" && !b) return page.title;
    if (m.to.via && a === m.to.via) return b ? show(viaKind!, itemData(viaPage), b) : (viaPage?.title ?? "");
    if (!b && kind.fields.some((f) => f.id === a)) return show(kind, data, a);
    return whole;
  });
  const name = m.to.name ? String(target.data[m.to.name] ?? "") : "";
  return { channel, to, name, text };
}
