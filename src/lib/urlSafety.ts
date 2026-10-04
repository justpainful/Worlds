/** Pure URL and file-name checks (no app state), shared by links.ts and tests. */

const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:", "discord:"]);

/** Extensions Windows would execute or interpret when "opened". */
const RUNNABLE = /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msi|msp|scr|hta|lnk|pif|cpl|reg|jar|appref-ms|application|gadget|msc|inf|url|dll|sys)$/i;

export function isSafeUrl(url: string): boolean {
  try {
    return SAFE_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** A bare domain typed by the user ("example.com") becomes https. */
export function normalizeUrl(raw: string): string {
  const url = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  return `https://${url}`;
}

export function isRunnable(fileName: string): boolean {
  return RUNNABLE.test(fileName.trim());
}

