/**
 * Files on the web. The app asks for files the way the desktop does (a dialog
 * that returns paths, then a command that imports a path), so here the
 * browser's own file picker stands in for the dialog: each chosen File is kept
 * under a made-up path ("web-file:<id>/<name>") that the in-browser backend
 * (src/dev/mockTauri.ts) reads the bytes from. Saving goes the other way: the
 * browser downloads the bytes instead of writing a path.
 */

const picked = new Map<string, File>();
const PREFIX = "web-file:";

/** A path for a File, so it can travel through the desktop code paths. */
export function pathForFile(file: File): string {
  const key = Math.random().toString(36).slice(2) + Date.now().toString(36);
  picked.set(key, file);
  return `${PREFIX}${key}/${file.name}`;
}

/** The File behind a path from pathForFile, once. */
export function takeFile(path: string): File | undefined {
  if (!path.startsWith(PREFIX)) return undefined;
  const key = path.slice(PREFIX.length).split("/")[0];
  const file = picked.get(key);
  picked.delete(key);
  return file;
}

export const isWebFilePath = (path: string) => path.startsWith(PREFIX);

type Filter = { name: string; extensions: string[] };

/** What the picker accepts, from the desktop dialog's filters. */
function accept(filters?: Filter[]): string {
  const exts = (filters ?? []).flatMap((f) => f.extensions).filter((e) => e && e !== "*");
  return exts.length ? exts.map((e) => `.${e.replace(/^\./, "")}`).join(",") : "";
}

/**
 * The browser's file picker with the desktop dialog's options. Resolves with a
 * path, a list of paths (multiple), or null when the person closes the picker.
 */
export function pickFiles(options: { multiple?: boolean; filters?: Filter[]; directory?: boolean }): Promise<string | string[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = !!options.multiple;
    const a = accept(options.filters);
    if (a) input.accept = a;
    input.style.display = "none";
    let done = false;
    const finish = (value: string | string[] | null) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(value);
    };
    input.addEventListener("change", () => {
      const files = [...(input.files ?? [])];
      if (!files.length) return finish(null);
      const paths = files.map(pathForFile);
      finish(options.multiple ? paths : paths[0]);
    });
    input.addEventListener("cancel", () => finish(null));
    document.body.append(input);
    input.click();
  });
}

/** Hands bytes to the browser as a download named `name`. */
export function download(name: string, data: Blob | Uint8Array | string, type = "application/octet-stream"): void {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name || "download";
  a.style.display = "none";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
