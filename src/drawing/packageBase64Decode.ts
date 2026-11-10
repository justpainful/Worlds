/** Decode base64 in aligned chunks, avoiding an equally large binary string. */
export function decodePackageBase64(encoded: string, check: () => void = () => {}): Uint8Array<ArrayBuffer> {
  const input = encoded.replace(/[\t\n\f\r ]/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input) || input.length % 4 === 1 || (input.includes("=") && input.length % 4 !== 0)) throw new DOMException("Invalid base64", "InvalidCharacterError");
  const padding = input.endsWith("==") ? 2 : input.endsWith("=") ? 1 : 0;
  const output = new Uint8Array(Math.floor(input.length * 3 / 4) - padding);
  let written = 0;
  for (let offset = 0; offset < input.length; offset += 65536) {
    check();
    const binary = atob(input.slice(offset, offset + 65536));
    for (let i = 0; i < binary.length; i++) output[written++] = binary.charCodeAt(i);
  }
  check();
  return output;
}
