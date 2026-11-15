/**
 * Files dropped on an element from the computer, on the web. The desktop gets
 * dropped files from the window (Tauri's drag and drop event, with paths);
 * the browser hands them to the element under the pointer instead.
 * Returns a function that stops listening.
 */
export function onFilesDropped(el: HTMLElement | null, take: (files: File[]) => void): () => void {
  if (!el) return () => {};
  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  const over = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  const drop = (e: DragEvent) => {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    take(files);
  };
  el.addEventListener("dragover", over);
  el.addEventListener("drop", drop);
  return () => {
    el.removeEventListener("dragover", over);
    el.removeEventListener("drop", drop);
  };
}
