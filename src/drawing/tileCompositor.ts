import type { Rect } from "./model";

export interface TileMatrix { a: number; b: number; c: number; d: number; e: number; f: number }
interface Vertex { x: number; y: number; u: number; v: number }
/** Clip in double-precision device coordinates before uploading float vertices.
 * Large document coordinates never reach the GPU vertex shader. */
export function tileVertices(rect: Rect, m: TileMatrix, width: number, height: number, padding: number, pixels: number): Float32Array {
  const uv0 = padding / pixels, uv1 = (pixels - padding) / pixels;
  let polygon: Vertex[] = [[rect.x, rect.y, uv0, uv0], [rect.x + rect.w, rect.y, uv1, uv0], [rect.x + rect.w, rect.y + rect.h, uv1, uv1], [rect.x, rect.y + rect.h, uv0, uv1]].map(([x, y, u, v]) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f, u, v }));
  if (polygon.some((p) => ![p.x, p.y].every(Number.isFinite))) return new Float32Array();
  for (const [axis, limit, sign] of [["x", 0, 1], ["x", width, -1], ["y", 0, 1], ["y", height, -1]] as const) {
    const next: Vertex[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i], q = polygon[(i + 1) % polygon.length], inside = (p[axis] - limit) * sign >= 0, otherInside = (q[axis] - limit) * sign >= 0;
      if (inside) next.push(p);
      if (inside !== otherInside) {
        const t = (limit - p[axis]) / (q[axis] - p[axis]);
        next.push({ x: axis === "x" ? limit : p.x + (q.x - p.x) * t, y: axis === "y" ? limit : p.y + (q.y - p.y) * t, u: p.u + (q.u - p.u) * t, v: p.v + (q.v - p.v) * t });
      }
    }
    polygon = next; if (polygon.length < 3) return new Float32Array();
  }
  const data: number[] = [];
  for (let i = 1; i + 1 < polygon.length; i++) for (const p of [polygon[0], polygon[i], polygon[i + 1]]) data.push(p.x, p.y, p.u, p.v);
  return new Float32Array(data);
}

interface TextureEntry { owner: object; id: string; key: string; texture: WebGLTexture; bytes: number }
export class TileCompositor {
  readonly canvas = document.createElement("canvas");
  private gl: WebGL2RenderingContext;
  private program!: WebGLProgram;
  private buffer!: WebGLBuffer;
  private vao!: WebGLVertexArrayObject;
  private viewport!: WebGLUniformLocation;
  private textures = new Map<string, TextureEntry>();
  private owners = new WeakMap<object, number>();
  private ownerSequence = 0;
  private listeners = new Map<object, () => void>();
  private ready = false;
  residentBytes = 0;
  readonly limit = 128 * 1024 * 1024;
  constructor() {
    const gl = this.canvas.getContext("webgl2", { alpha: true, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true, depth: false, stencil: false });
    if (!gl) throw new Error("GPU tile sampling is unavailable"); this.gl = gl;
    this.initialize();
    this.canvas.addEventListener("webglcontextlost", (event) => { event.preventDefault(); this.ready = false; this.textures.clear(); this.residentBytes = 0; for (const notify of this.listeners.values()) notify(); });
    this.canvas.addEventListener("webglcontextrestored", () => { try { this.initialize(); } catch { this.ready = false; } for (const notify of this.listeners.values()) notify(); });
  }
  private initialize() {
    const gl = this.gl;
    const shader = (kind: number, source: string) => {
      const s = gl.createShader(kind); if (!s) throw new Error("GPU shader allocation failed"); gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); throw new Error("GPU tile shader could not compile"); } return s;
    };
    const vertex = shader(gl.VERTEX_SHADER, `#version 300 es
      in vec2 position; in vec2 texcoord; uniform vec2 viewport; out vec2 uv;
      void main(){ gl_Position=vec4(position.x*2.0/viewport.x-1.0,1.0-position.y*2.0/viewport.y,0.0,1.0); uv=texcoord; }`);
    let fragment: WebGLShader;
    try { fragment = shader(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float; uniform sampler2D pigment; in vec2 uv; out vec4 color;
      void main(){ color=texture(pigment,uv); }`); }
    catch (error) { gl.deleteShader(vertex); throw error; }
    const program = gl.createProgram(); if (!program) { gl.deleteShader(vertex); gl.deleteShader(fragment); throw new Error("GPU program allocation failed"); } gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); throw new Error("GPU tile program could not link"); }
    const buffer = gl.createBuffer(), vao = gl.createVertexArray(), viewport = gl.getUniformLocation(program, "viewport");
    if (!buffer || !vao || !viewport) { if (buffer) gl.deleteBuffer(buffer); if (vao) gl.deleteVertexArray(vao); gl.deleteProgram(program); throw new Error("GPU tile buffers are unavailable"); }
    this.program = program; this.buffer = buffer; this.vao = vao; this.viewport = viewport;
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (const [name, offset] of [["position", 0], ["texcoord", 8]] as const) { const at = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 16, offset); }
    gl.useProgram(program); gl.uniform1i(gl.getUniformLocation(program, "pigment"), 0); this.ready = true;
  }
  begin(owner: object, width: number, height: number, notify: () => void): boolean {
    const gl = this.gl; this.listeners.set(owner, notify);
    if (!this.ready || gl.isContextLost()) return false;
    if (!this.owners.has(owner)) this.owners.set(owner, ++this.ownerSequence);
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    gl.viewport(0, 0, width, height); gl.useProgram(this.program); gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer); gl.activeTexture(gl.TEXTURE0);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST); gl.uniform2f(this.viewport, width, height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); return true;
  }
  draw(owner: object, id: string, key: string, rect: Rect, matrix: TileMatrix, source: () => HTMLCanvasElement, padding = 1, pixels = 514) {
    const gl = this.gl, cacheId = `${this.owners.get(owner)}:${id}`;
    let entry = this.textures.get(cacheId);
    if (entry && entry.key !== key) { gl.deleteTexture(entry.texture); this.residentBytes -= entry.bytes; this.textures.delete(cacheId); entry = undefined; }
    if (!entry) {
      const canvas = source(), texture = gl.createTexture(); if (!texture) throw new Error("GPU texture allocation failed");
      try {
        gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      } catch (error) { gl.deleteTexture(texture); throw error; }
      entry = { owner, id, key, texture, bytes: canvas.width * canvas.height * 4 };
      while (this.residentBytes + entry.bytes > this.limit && this.textures.size) { const oldest = this.textures.keys().next().value!, old = this.textures.get(oldest)!; gl.deleteTexture(old.texture); this.residentBytes -= old.bytes; this.textures.delete(oldest); }
      this.textures.set(cacheId, entry); this.residentBytes += entry.bytes;
    } else { this.textures.delete(cacheId); this.textures.set(cacheId, entry); gl.bindTexture(gl.TEXTURE_2D, entry.texture); }
    const vertices = tileVertices(rect, matrix, this.canvas.width, this.canvas.height, padding, pixels);
    if (vertices.length) { gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW); gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 4); }
  }
  finish(): HTMLCanvasElement | null {
    const gl = this.gl; gl.flush();
    if (!this.ready || gl.isContextLost()) return null;
    if (gl.getError() !== gl.NO_ERROR) { this.ready = false; for (const entry of this.textures.values()) gl.deleteTexture(entry.texture); this.textures.clear(); this.residentBytes = 0; return null; }
    return this.canvas;
  }
  snapshot() { return { ready: this.ready && !this.gl.isContextLost(), bytes: this.residentBytes, limit: this.limit, textures: this.textures.size, owners: this.listeners.size, surfacePixels: this.canvas.width * this.canvas.height }; }
  release(owner: object) {
    this.listeners.delete(owner);
    for (const [id, entry] of this.textures) if (entry.owner === owner) { this.gl.deleteTexture(entry.texture); this.residentBytes -= entry.bytes; this.textures.delete(id); }
    if (!this.listeners.size) { this.canvas.width = this.canvas.height = 1; }
  }
}
let shared: TileCompositor | null | undefined;
export function tileCompositor(): TileCompositor | null {
  if (shared === undefined) { try { shared = new TileCompositor(); } catch { shared = null; } }
  return shared;
}
export function releaseTileCompositor(owner: object) { shared?.release(owner); }
export function tileCompositorSnapshot() { return shared?.snapshot() ?? { ready: false, bytes: 0, limit: 128 * 1024 * 1024, textures: 0, owners: 0, surfacePixels: 0 }; }
