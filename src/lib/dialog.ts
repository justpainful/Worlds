// Native file dialogs with their title and filter names in the interface language,
// so an Arabic Worlds does not open an English "Choose a cover" window.
import { open as openNative, save as saveNative, type OpenDialogOptions, type SaveDialogOptions } from "@tauri-apps/plugin-dialog";
import { tr } from "../i18n/ui";
import { isWeb } from "./api";
import { pickFiles } from "../web/files";

export function localDialog<T extends { title?: string; filters?: { name: string; extensions: string[] }[] }>(options: T): T {
  return {
    ...options,
    title: options.title === undefined ? undefined : tr(options.title),
    filters: options.filters?.map((f) => ({ ...f, name: tr(f.name) })),
  };
}

export function open<T extends OpenDialogOptions>(options: T) {
  // On the web the browser's picker stands in; the paths it returns are read by the in-browser backend.
  if (isWeb) return pickFiles(options) as ReturnType<typeof openNative<T>>;
  return openNative(localDialog(options));
}

export function save(options: SaveDialogOptions) {
  return saveNative(localDialog(options));
}
