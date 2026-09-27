/**
 * CanvasRenderer — the 2D canvas renderer: draws every CanvasLayer's items, in tree order, on top of
 * the 3D frame with raw WebGL2 in three.js's context (state reset afterwards).
 *
 *   geometry   one dynamic vertex buffer per frame (x, y, u, v, r, g, b, a), batched by texture,
 *              primitive (triangles / 1-px lines) and scissor; straight-alpha "mix" blending like
 *              Godot's canvas (SRC_ALPHA, ONE_MINUS_SRC_ALPHA; alpha ONE, ONE_MINUS_SRC_ALPHA);
 *   text       a glyph atlas (white RGB, coverage in alpha) filled on demand from HarfBuzz outlines
 *              rasterised with Canvas 2D at the final pixel size, with Godot's sub-pixel variants
 *              (¼ px up to 16 px, ½ px up to 20 px, whole pixels above) and FreeType-stroker outlines;
 *   textures   ImageTexture pixels and theme icons (PNG data URLs, decoded ahead of time).
 *
 * Cost per frame: O(vertices) CPU for the transform pass, a handful of draw calls.
 */
import { CanvasLayer, CanvasItem, multiply } from './canvas_item.js';
import { Control } from './control.js';
import { outlineRadius } from '../text/raster.js';
import { SUBPIXEL_ONE_HALF_MAX_SIZE, SUBPIXEL_ONE_QUARTER_MAX_SIZE } from '../text/shaper.js';

const ATLAS_SIZE = 1024;
const GLYPH_PAD = 2;
const FLOATS_PER_VERTEX = 8;

const VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
in vec4 a_color;
uniform vec2 u_viewport;
out vec2 v_uv;
out vec4 v_color;
void main() {
  v_uv = a_uv;
  v_color = a_color;
  gl_Position = vec4(a_pos / u_viewport * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_color;
uniform sampler2D u_tex;
out vec4 frag;
void main() {
  frag = v_color * texture(u_tex, v_uv);
}`;

/** Glyph atlas pages: shelf-packed, CPU pixels mirrored to a texture when dirty. */
class GlyphAtlas {
  constructor() {
    this.pages = [];
    this.entries = new Map();
    this.scratch = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : document.createElement('canvas');
    this.ctx = this.scratch.getContext('2d', { willReadFrequently: true });
  }

  _page() {
    const page = { pixels: new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4), x: 0, y: 0, rowH: 0, dirty: true, texture: null, id: this.pages.length };
    // White RGB everywhere: glyph colour comes from the vertex colour, coverage from alpha.
    for (let i = 0; i < page.pixels.length; i += 4) {
      page.pixels[i] = 255;
      page.pixels[i + 1] = 255;
      page.pixels[i + 2] = 255;
    }
    this.pages.push(page);
    return page;
  }

  _alloc(w, h) {
    let page = this.pages[this.pages.length - 1] ?? this._page();
    if (page.x + w > ATLAS_SIZE) {
      page.x = 0;
      page.y += page.rowH + 1;
      page.rowH = 0;
    }
    if (page.y + h > ATLAS_SIZE) page = this._page();
    const slot = { page, x: page.x, y: page.y };
    page.x += w + 1;
    page.rowH = Math.max(page.rowH, h);
    return slot;
  }

  /**
   * Glyph bitmap for (font, pixel size, outline, glyph, sub-pixel shift): { page, u0…v1, left, top, w, h }
   * where (left, top) is the bitmap's offset from the pen position (pixels, y down).
   */
  glyph(font, pxSize, outline, gid, shift) {
    const key = `${font.name}|${pxSize}|${outline}|${gid}|${shift}`;
    let entry = this.entries.get(key);
    if (entry) return entry;
    const k = pxSize / font.upem;
    const e = font.glyphExtents(gid);
    const radius = outline > 0 ? outlineRadius(outline) : 0;
    const margin = Math.ceil(radius) + GLYPH_PAD;
    const x0 = Math.floor(e.xBearing * k + shift) - margin;
    const x1 = Math.ceil((e.xBearing + e.width) * k + shift) + margin;
    const y0 = Math.floor(-e.yBearing * k) - margin;
    const y1 = Math.ceil(-(e.yBearing + e.height) * k) + margin;
    const w = Math.max(1, x1 - x0);
    const h = Math.max(1, y1 - y0);
    const path = font.glyphPath(gid);
    if (!path || e.width === 0) {
      entry = { empty: true };
      this.entries.set(key, entry);
      return entry;
    }
    if (this.scratch.width < w || this.scratch.height < h) {
      this.scratch.width = Math.max(this.scratch.width, w);
      this.scratch.height = Math.max(this.scratch.height, h);
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(-x0 + shift, -y0);
    ctx.scale(k, -k);
    if (outline > 0) {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'butt';
      ctx.lineWidth = (radius * 2) / k;
      ctx.strokeStyle = '#fff';
      ctx.stroke(path);
    } else {
      ctx.fillStyle = '#fff';
      ctx.fill(path);
    }
    const data = ctx.getImageData(0, 0, w, h).data;
    const slot = this._alloc(w, h);
    const page = slot.page;
    for (let row = 0; row < h; row++) {
      const dst = ((slot.y + row) * ATLAS_SIZE + slot.x) * 4;
      for (let col = 0; col < w; col++) page.pixels[dst + col * 4 + 3] = data[(row * w + col) * 4 + 3];
    }
    page.dirty = true;
    entry = { page, u0: slot.x / ATLAS_SIZE, v0: slot.y / ATLAS_SIZE, u1: (slot.x + w) / ATLAS_SIZE, v1: (slot.y + h) / ATLAS_SIZE, left: x0, top: y0, w, h };
    this.entries.set(key, entry);
    return entry;
  }
}

export class CanvasRenderer {
  /** @param {import('three').WebGLRenderer} renderer */
  constructor(renderer) {
    this.renderer = renderer;
    const gl = renderer.getContext();
    this.gl = gl;
    this.program = this._program(VERTEX_SHADER, FRAGMENT_SHADER);
    this.attribs = { pos: gl.getAttribLocation(this.program, 'a_pos'), uv: gl.getAttribLocation(this.program, 'a_uv'), color: gl.getAttribLocation(this.program, 'a_color') };
    this.uniforms = { viewport: gl.getUniformLocation(this.program, 'u_viewport'), tex: gl.getUniformLocation(this.program, 'u_tex') };
    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();
    this.ibo = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const stride = FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(this.attribs.pos);
    gl.vertexAttribPointer(this.attribs.pos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.attribs.uv);
    gl.vertexAttribPointer(this.attribs.uv, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(this.attribs.color);
    gl.vertexAttribPointer(this.attribs.color, 4, gl.FLOAT, false, stride, 16);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bindVertexArray(null);
    this.white = this._texture(1, 1, new Uint8Array([255, 255, 255, 255]));
    this.textures = new Map();
    this.atlas = new GlyphAtlas();
    this.vertices = new Float32Array(65536 * FLOATS_PER_VERTEX);
    this.indices = new Uint32Array(65536 * 3);
    this.stats = { batches: 0, vertices: 0 };
  }

  _program(vs, fs) {
    const gl = this.gl;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`canvas shader: ${gl.getShaderInfoLog(shader)}`);
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`canvas program: ${gl.getProgramInfoLog(program)}`);
    return program;
  }

  _texture(width, height, pixels, source = null) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /** Decodes theme icons (data URLs) before first use, so nothing pops in. */
  async preload(textures) {
    await Promise.all(textures.filter((t) => t?.src && !t.image).map(async (t) => {
      const img = new Image();
      img.src = t.src;
      await img.decode();
      t.image = img;
    }));
  }

  _glTexture(texture) {
    let entry = this.textures.get(texture);
    if (entry && entry.version === texture.version) return entry.tex;
    const gl = this.gl;
    if (entry) gl.deleteTexture(entry.tex);
    let tex;
    if (texture.pixels) tex = this._texture(texture.width, texture.height, texture.pixels);
    else if (texture.image) tex = this._texture(texture.width, texture.height, null, texture.image);
    else return null;
    this.textures.set(texture, { tex, version: texture.version });
    return tex;
  }

  /** The page's GL texture (created on first use; pixel uploads happen once per flush). */
  _atlasTexture(page) {
    if (!page.texture) {
      page.texture = this._texture(ATLAS_SIZE, ATLAS_SIZE, page.pixels);
      page.dirty = false;
    }
    return page.texture;
  }

  _uploadAtlas() {
    const gl = this.gl;
    for (const page of this.atlas.pages) {
      if (!page.dirty || !page.texture) continue;
      gl.bindTexture(gl.TEXTURE_2D, page.texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ATLAS_SIZE, ATLAS_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, page.pixels);
      page.dirty = false;
    }
  }

  // ───────────────────────────────────────────────────────────────── frame ─────────────────────────

  /**
   * Draws all layers found under `root` (a Node). `scale` maps canvas units to pixels;
   * (width, height) is the drawing buffer size.
   */
  render(root, scale, width, height) {
    const layers = [];
    const collect = (node) => {
      for (const child of node.children) {
        if (child instanceof CanvasLayer) layers.push(child);
        else if (!(child instanceof CanvasItem)) collect(child);
      }
    };
    collect(root);
    layers.sort((a, b) => a.layer - b.layer);
    this._begin(width, height);
    const base = [scale, 0, 0, scale, 0, 0];
    for (const layer of layers) {
      if (layer.visible === false) continue;
      for (const child of layer.children) if (child instanceof CanvasItem) this._item(child, base, { r: 1, g: 1, b: 1, a: 1 }, null);
    }
    this._flush();
    this._end();
  }

  _item(item, parentTransform, parentModulate, clip) {
    if (!item._visible) return;
    const m = item._modulate;
    const modulate = { r: parentModulate.r * m.r, g: parentModulate.g * m.g, b: parentModulate.b * m.b, a: parentModulate.a * m.a };
    if (modulate.a <= 0) return;
    const transform = multiply(parentTransform, item.get_transform());
    if (item._needsRedraw) item._redraw();
    const sm = item._selfModulate;
    const own = { r: modulate.r * sm.r, g: modulate.g * sm.g, b: modulate.b * sm.b, a: modulate.a * sm.a };
    this._commands(item.drawList, transform, own, clip);
    let childClip = clip;
    if (item.clip_contents && item instanceof Control) {
      const p0 = { x: transform[4], y: transform[5] };
      const p1 = { x: transform[0] * item.size.x + transform[4], y: transform[3] * item.size.y + transform[5] };
      const rect = { x0: Math.min(p0.x, p1.x), y0: Math.min(p0.y, p1.y), x1: Math.max(p0.x, p1.x), y1: Math.max(p0.y, p1.y) };
      childClip = clip ? { x0: Math.max(clip.x0, rect.x0), y0: Math.max(clip.y0, rect.y0), x1: Math.min(clip.x1, rect.x1), y1: Math.min(clip.y1, rect.y1) } : rect;
    }
    for (const child of item.children) if (child instanceof CanvasItem) this._item(child, transform, modulate, childClip);
  }

  _commands(list, t, modulate, clip) {
    for (const segment of list.segments) {
      if (segment.kind === 'mesh') this._mesh(list.mesh, segment, t, modulate, clip);
      else if (segment.kind === 'lines') this._lines(list.lines, segment, t, modulate, clip);
      else if (segment.kind === 'glyphs') this._glyphs(segment.run, t, modulate, clip);
      else if (segment.kind === 'texture') this._textureRect(segment, t, modulate, clip);
    }
  }

  // ───────────────────────────────────────────────────────────────── batching ──────────────────────

  _begin(width, height) {
    const gl = this.gl;
    this.width = width;
    this.height = height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.STENCIL_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.colorMask(true, true, true, true);
    gl.useProgram(this.program);
    gl.uniform2f(this.uniforms.viewport, width, height);
    gl.uniform1i(this.uniforms.tex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(this.vao);
    this.batch = { texture: this.white, primitive: 'triangles', clip: null, v: 0, i: 0 };
    this.stats = { batches: 0, vertices: 0 };
  }

  _end() {
    const gl = this.gl;
    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(null);
    this.renderer.resetState();
  }

  _state(texture, primitive, clip, vertexCount, indexCount) {
    const b = this.batch;
    const sameClip = b.clip === clip || (b.clip && clip && b.clip.x0 === clip.x0 && b.clip.y0 === clip.y0 && b.clip.x1 === clip.x1 && b.clip.y1 === clip.y1);
    if (b.texture !== texture || b.primitive !== primitive || !sameClip || (b.v + vertexCount) * FLOATS_PER_VERTEX > this.vertices.length || b.i + indexCount > this.indices.length) {
      this._flush();
      b.texture = texture;
      b.primitive = primitive;
      b.clip = clip;
      if ((vertexCount * FLOATS_PER_VERTEX) > this.vertices.length) this.vertices = new Float32Array(vertexCount * FLOATS_PER_VERTEX * 2);
      if (indexCount > this.indices.length) this.indices = new Uint32Array(indexCount * 2);
    }
  }

  _vertex(x, y, u, v, r, g, bb, a) {
    const b = this.batch;
    const o = b.v * FLOATS_PER_VERTEX;
    const V = this.vertices;
    V[o] = x;
    V[o + 1] = y;
    V[o + 2] = u;
    V[o + 3] = v;
    V[o + 4] = r;
    V[o + 5] = g;
    V[o + 6] = bb;
    V[o + 7] = a;
    return b.v++;
  }

  _flush() {
    const b = this.batch;
    if (!b || b.v === 0) return;
    const gl = this.gl;
    this._uploadAtlas();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertices.subarray(0, b.v * FLOATS_PER_VERTEX), gl.STREAM_DRAW);
    gl.bindTexture(gl.TEXTURE_2D, b.texture);
    if (b.clip) {
      gl.enable(gl.SCISSOR_TEST);
      const x0 = Math.max(0, Math.round(b.clip.x0));
      const y0 = Math.max(0, Math.round(b.clip.y0));
      const x1 = Math.min(this.width, Math.round(b.clip.x1));
      const y1 = Math.min(this.height, Math.round(b.clip.y1));
      gl.scissor(x0, this.height - y1, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
    } else gl.disable(gl.SCISSOR_TEST);
    if (b.primitive === 'lines') {
      gl.drawArrays(gl.LINES, 0, b.v);
    } else {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indices.subarray(0, b.i), gl.STREAM_DRAW);
      gl.drawElements(gl.TRIANGLES, b.i, gl.UNSIGNED_INT, 0);
    }
    this.stats.batches += 1;
    this.stats.vertices += b.v;
    b.v = 0;
    b.i = 0;
  }

  _mesh(mesh, segment, t, mod, clip) {
    // Vertices referenced by the index range.
    let lo = Infinity;
    let hi = -1;
    for (let k = segment.start; k < segment.end; k++) {
      const idx = mesh.indices[k];
      if (idx < lo) lo = idx;
      if (idx > hi) hi = idx;
    }
    if (hi < 0) return;
    const count = hi - lo + 1;
    this._state(this.white, 'triangles', clip, count, segment.end - segment.start);
    const b = this.batch;
    const base = b.v;
    const P = mesh.positions;
    const C = mesh.colors;
    for (let k = lo; k <= hi; k++) {
      const x = P[k * 2];
      const y = P[k * 2 + 1];
      this._vertex(t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5], 0.5, 0.5, C[k * 4] * mod.r, C[k * 4 + 1] * mod.g, C[k * 4 + 2] * mod.b, C[k * 4 + 3] * mod.a);
    }
    for (let k = segment.start; k < segment.end; k++) this.indices[b.i++] = base + mesh.indices[k] - lo;
  }

  _lines(lines, segment, t, mod, clip) {
    const count = segment.end - segment.start;
    this._state(this.white, 'lines', clip, count, 0);
    const P = lines.positions;
    const C = lines.colors;
    for (let k = segment.start; k < segment.end; k++) {
      // Pixel-centre the 1-px lines as the engine's line primitive does.
      const x = t[0] * P[k * 2] + t[2] * P[k * 2 + 1] + t[4] + 0.5;
      const y = t[1] * P[k * 2] + t[3] * P[k * 2 + 1] + t[5] + 0.5;
      this._vertex(x, y, 0.5, 0.5, C[k * 4] * mod.r, C[k * 4 + 1] * mod.g, C[k * 4 + 2] * mod.b, C[k * 4 + 3] * mod.a);
    }
  }

  _quad(texture, x0, y0, x1, y1, u0, v0, u1, v1, c, clip) {
    this._state(texture, 'triangles', clip, 4, 6);
    const b = this.batch;
    const base = b.v;
    this._vertex(x0, y0, u0, v0, c.r, c.g, c.b, c.a);
    this._vertex(x1, y0, u1, v0, c.r, c.g, c.b, c.a);
    this._vertex(x1, y1, u1, v1, c.r, c.g, c.b, c.a);
    this._vertex(x0, y1, u0, v1, c.r, c.g, c.b, c.a);
    const I = this.indices;
    I[b.i++] = base;
    I[b.i++] = base + 1;
    I[b.i++] = base + 2;
    I[b.i++] = base;
    I[b.i++] = base + 2;
    I[b.i++] = base + 3;
  }

  _textureRect(cmd, t, mod, clip) {
    const tex = this._glTexture(cmd.texture);
    if (!tex) return;
    const r = cmd.rect;
    const m = cmd.modulate ?? { r: 1, g: 1, b: 1, a: 1 };
    const c = { r: m.r * mod.r, g: m.g * mod.g, b: m.b * mod.b, a: m.a * mod.a };
    const x0 = t[0] * r.x + t[2] * r.y + t[4];
    const y0 = t[1] * r.x + t[3] * r.y + t[5];
    const x1 = t[0] * (r.x + r.w) + t[2] * (r.y + r.h) + t[4];
    const y1 = t[1] * (r.x + r.w) + t[3] * (r.y + r.h) + t[5];
    this._quad(tex, x0, y0, x1, y1, cmd.uv.x, cmd.uv.y, cmd.uv.x + cmd.uv.w, cmd.uv.y + cmd.uv.h, c, clip);
  }

  /** Glyph quads at Godot's pixel positions (sub-pixel variants at small sizes). */
  _glyphs(run, t, mod, clip) {
    const scale = Math.hypot(t[0], t[1]);
    const pxSize = Math.max(1, Math.round(run.size * scale));
    const outline = run.outline > 0 ? Math.max(1, Math.round(run.outline * scale)) : 0;
    const c = { r: run.color.r * mod.r, g: run.color.g * mod.g, b: run.color.b * mod.b, a: run.color.a * mod.a };
    const steps = pxSize <= SUBPIXEL_ONE_QUARTER_MAX_SIZE ? 4 : pxSize <= SUBPIXEL_ONE_HALF_MAX_SIZE ? 2 : 1;
    for (const g of run.glyphs) {
      const px = t[0] * g.x + t[2] * g.y + t[4];
      const py = t[1] * g.x + t[3] * g.y + t[5];
      let base;
      let shift = 0;
      if (steps === 1) base = Math.round(px);
      else {
        const offset = 0.5 / steps;
        base = Math.floor(px + offset);
        shift = Math.floor(steps * (px + offset)) - steps * base;
      }
      const entry = this.atlas.glyph(run.font, pxSize, outline, g.gid, shift / steps);
      if (entry.empty) continue;
      const tex = this._atlasTexture(entry.page);
      const x0 = base + entry.left;
      const y0 = Math.round(py) + entry.top;
      this._quad(tex, x0, y0, x0 + entry.w, y0 + entry.h, entry.u0, entry.v0, entry.u1, entry.v1, c, clip);
    }
  }
}
