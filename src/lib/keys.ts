/** US punctuation by physical key, for layouts whose keys type other letters. */
const PHYSICAL: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
};

/**
 * The Latin letter or symbol of a keyboard shortcut. With an Arabic (or any
 * non-Latin) layout active, Ctrl+K reports `key` as "ن" and Ctrl+, as "و",
 * so the character comes from the physical key instead; Latin layouts such as
 * AZERTY keep the characters they type.
 */
export function shortcutKey(e: { key: string; code?: string }): string {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (/^[\x20-\x7e]$/.test(key)) return key;
  const code = e.code ?? "";
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1].toLowerCase();
  return PHYSICAL[code] ?? key;
}
