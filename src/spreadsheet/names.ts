import { uiLanguage } from "../i18n/ui";

/**
 * A new sheet's name in the interface language. Sheet names are the person's
 * data, which the interface translator leaves alone, so an Arabic workbook
 * used to start with an English "Sheet 1".
 */
export function defaultSheetName(n: number): string {
  return uiLanguage() === "ar" ? `ورقة ${n}` : `Sheet ${n}`;
}
