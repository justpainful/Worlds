/**
 * Dates and relative times follow the interface language. Code across Worlds
 * formats them with the default locale (`toLocaleDateString(undefined, …)`,
 * `new Intl.RelativeTimeFormat(undefined, …)`), which is the system language.
 * While the interface is Arabic, that default becomes Arabic with the
 * Gregorian calendar and Western digits. Calls that name a locale are left
 * alone, and numbers keep their usual format.
 */
export const ARABIC_LOCALE = "ar-u-ca-gregory-nu-latn";

let arabic = false;
let installed = false;

const pick = (locales: Intl.LocalesArgument | undefined) => (locales === undefined && arabic ? ARABIC_LOCALE : locales);

function install() {
  if (installed) return;
  installed = true;
  const proto = Date.prototype as unknown as Record<string, (this: Date, l?: Intl.LocalesArgument, o?: Intl.DateTimeFormatOptions) => string>;
  for (const name of ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"]) {
    const original = proto[name];
    proto[name] = function (this: Date, locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
      return original.call(this, pick(locales), options);
    };
  }
  const intl = Intl as unknown as Record<string, unknown>;
  const Relative = Intl.RelativeTimeFormat;
  intl.RelativeTimeFormat = class extends Relative {
    constructor(locales?: Intl.LocalesArgument, options?: Intl.RelativeTimeFormatOptions) {
      super(pick(locales), options);
    }
  };
  const DateTime = Intl.DateTimeFormat;
  const wrapped = function (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
    return new DateTime(pick(locales), options);
  } as unknown as typeof Intl.DateTimeFormat;
  Object.defineProperty(wrapped, "prototype", { value: DateTime.prototype });
  wrapped.supportedLocalesOf = DateTime.supportedLocalesOf;
  intl.DateTimeFormat = wrapped;
}

export function setArabicDates(on: boolean): void {
  arabic = on;
  if (on) install();
}

/** Joins short items for display, with the Arabic comma while the interface is Arabic. */
export function joinList(items: string[]): string {
  return items.join(arabic ? "، " : ", ");
}

/** Arabic letters people type interchangeably (أ إ آ and ا, ة and ه, ى and ي) and diacritics, folded so a search still matches. */
export function foldArabic(text: string): string {
  return text.replace(/[\u064B-\u0652\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    // "٢٤" finds "24" and the other way round.
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
}

/**
 * `foldArabic` and lower case, keeping for each folded character its index in
 * the original text (plus the length at the end), so a match in the folded
 * text maps back to the exact characters to highlight or replace.
 */
export function foldWithMap(text: string): { folded: string; at: number[] } {
  // One pass with no regular expressions: find runs this on every edit while it is open.
  let folded = "";
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    let ch = text[i];
    if (code >= 0x0600 && code <= 0x06ff) {
      if ((code >= 0x064b && code <= 0x0652) || code === 0x0640) continue; // a diacritic or tatweel
      if (code === 0x0623 || code === 0x0625 || code === 0x0622) ch = "ا";
      else if (code === 0x0629) ch = "ه";
      else if (code === 0x0649) ch = "ي";
      else if (code >= 0x0660 && code <= 0x0669) ch = String(code - 0x0660);
      else if (code >= 0x06f0 && code <= 0x06f9) ch = String(code - 0x06f0);
    } else {
      const lower = ch.toLowerCase();
      if (lower.length === 1) ch = lower;
    }
    folded += ch;
    at.push(i);
  }
  at.push(text.length);
  return { folded, at };
}

/**
 * The Hijri months (Umm al-Qura, as used in Saudi Arabia) that a span of days
 * falls in, for the Arabic calendar header: "جمادى الآخرة 1448 هـ", or two
 * months joined when the span crosses into the next one.
 */
export function hijriSpan(from: Date, to: Date): string {
  const format = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", o).format(d);
  const first = format(from, { month: "long", year: "numeric" });
  const last = format(to, { month: "long", year: "numeric" });
  if (first === last) return first;
  const sameYear = format(from, { year: "numeric" }) === format(to, { year: "numeric" });
  return sameYear ? `${format(from, { month: "long" })} و${last}` : `${first} و${last}`;
}

/** Today's date for the Home header: "Thursday 12 November", and in Arabic the Hijri date after it. */
export function dateLine(d: Date): string {
  const gregorian = d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  if (!arabic) return gregorian;
  const hijri = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "long", year: "numeric" }).format(d);
  return `${gregorian} · ${hijri}`;
}
