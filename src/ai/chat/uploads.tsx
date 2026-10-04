import { api } from "../../lib/api";
import type { Attachment, ChatAttachment } from "../../lib/types";

export const toChatAttachment = (a: Attachment): ChatAttachment => ({ id: a.id, name: a.fileName, mime: a.mime, kind: a.kind, size: a.size });

/** Big photos are scaled down before Claude sees them (the API caps images at ~5 MB). */
export async function shrinkImage(file: File): Promise<File> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size < 3_400_000) return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.86));
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}

export async function uploadFiles(files: File[]): Promise<ChatAttachment[]> {
  const out: ChatAttachment[] = [];
  for (const f of files) {
    const small = await shrinkImage(f);
    const name = small.name || `pasted-${Date.now()}.${(small.type.split("/")[1] || "bin").replace("jpeg", "jpg")}`;
    const a = await api.importBytes(null, name, new Uint8Array(await small.arrayBuffer()));
    out.push(toChatAttachment(a));
  }
  return out;
}

export async function uploadPaths(paths: string[]): Promise<ChatAttachment[]> {
  const out: ChatAttachment[] = [];
  for (const p of paths) out.push(toChatAttachment(await api.importFile(null, p)));
  return out;
}
