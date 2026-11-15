/**
 * A default frame or layer name ("Frame 3", "Layer 2") as shown in Arabic.
 * The stored name stays as it is, so shared drawings agree on it; a name the
 * person typed is shown as written.
 */
export function shownName(name: string, arabic: boolean): string {
  if (!arabic) return name;
  const m = /^(Frame|Layer) (\d+)$/.exec(name);
  return m ? `${m[1] === "Frame" ? "إطار" : "طبقة"} ${m[2]}` : name;
}
