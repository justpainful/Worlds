/** The Worlds version this build is (from package.json, set by Vite), and the platform it runs on. */
declare const __APP_VERSION__: string;

export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";

/** windows, macos, linux, or web: the platform names the account service and the dashboard use. */
export function appPlatform(): string {
  const w = window as unknown as { __WORLDS_MOCK__?: boolean; __TAURI_INTERNALS__?: unknown };
  if (w.__WORLDS_MOCK__ || !w.__TAURI_INTERNALS__) return "web";
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macos";
  return "linux";
}
