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
