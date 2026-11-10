import { encodeFlattenedSvg } from "./svgEncode";

self.onmessage = async (event: MessageEvent<{ png: Blob }>) => {
  try { self.postMessage({ blob: await encodeFlattenedSvg(event.data.png) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
