export interface ReferencePreview {
  state: "ready" | "unavailable" | "loading" | "offline"; sourceId?: string; title?: string; kind?: string; excerpt?: string;
  updatedAt?: number; checkedAt: number; lastReadyAt?:number; lastUpdatedAt?:number; tasksDone?: number; tasksTotal?: number;
  imageAttachmentId?: string | null; imageMime?: string | null; imageWidth?: number | null; imageHeight?: number | null;
}
export type ReferenceSnapshot = Omit<ReferencePreview, "imageAttachmentId" | "sourceId" | "state"> & { title: string; kind: string };
