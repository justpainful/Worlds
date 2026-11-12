/**
 * The Latin letter of a keyboard shortcut. With an Arabic (or any non-Latin)
 * layout active, Ctrl+K reports `key` as "ن", so the letter comes from the
 * physical key instead; Latin layouts such as AZERTY keep their own letters.
 */
export function shortcutKey(e: { key: string; code?: string }): string {
  const key = e.key.toLowerCase();
  if (/^[a-z]$/.test(key)) return key;
  const physical = /^Key([A-Z])$/.exec(e.code ?? "");
  return physical ? physical[1].toLowerCase() : key;
}
