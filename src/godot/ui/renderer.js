/**
 * CanvasRenderer — the 2D canvas renderer: draws every CanvasLayer's items, in tree order, on top of
 * the 3D frame with raw WebGL2 in three.js's context (state reset afterwards).
 *
 *   geometry   one dynamic vertex buffer per frame (x, y, u, v, r, g, b, a), batched by texture,
 *              primitive (triangles / 1-px lines) and scissor; straight-alpha "mix" blending like
 *              Godot's canvas (SRC_ALPHA, ONE_MINUS_SRC_ALPHA; alpha ONE, ONE_MINUS_SRC_ALPHA);
 *   text       a glyph atlas (white RGB, coverage in alpha) filled on demand with the engine's own
 *              glyph bitmaps (FreeType in WebAssembly, text/glyphs.js), placed and scaled as
 *              TextServerAdvanced::_font_draw_glyph does: oversampled size, sub-pixel variants,
 *              a one-pixel margin around each bitmap, linear filtering;
 *   textures   ImageTexture pixels and theme icons (PNG data URLs, decoded ahead of time).
 *
 * Cost per frame: O(vertices) CPU for the transform pass, a handful of draw calls.
 */
import { CanvasLayer, CanvasItem, multiply } from './canvas_item.js';
import { Control } from './control.js';
import { glyphSize, placeGlyph, quantizeOversampling, subPixelMode } from '../text/glyphs.js';
import { ATLAS_SIZE, GlyphAtlas } from '../text/atlas.js';

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
  // Top-down into the screen buffer: row 0 is the canvas's first row, as in the engine's framebuffer.
  gl_Position = vec4(a_pos / u_viewport * 2.0 - 1.0, 0.0, 1.0);
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
    if (!page.handle) {
      page.handle = this._texture(ATLAS_SIZE, ATLAS_SIZE, page.pixels);
      page.dirty = false;
    }
    return page.handle;
  }

  _uploadAtlas() {
    const gl = this.gl;
    for (const page of this.atlas.pages) {
      if (!page.dirty || !page.handle) continue;
      gl.bindTexture(gl.TEXTURE_2D, page.handle);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ATLAS_SIZE, ATLAS_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, page.pixels);
      page.dirty = false;
    }
  }

  // ───────────────────────────────────────────────────────────────── frame ─────────────────────────

  /**
   * Draws all layers found under `root` (a Node). `stretch` = { x, y } maps canvas units to pixels
   * (the viewport's stretch transform), `oversampling` is the viewport's font oversampling;
   * (width, height) is the drawing buffer size; `target` the screen buffer (the engine's rows) the
   * canvas is drawn into — RenderPipeline.present() brings it to the page.
   */
  render(root, stretch, oversampling, width, height, target) {
    if (!target) throw new Error('CanvasRenderer.render: the screen buffer to draw into is required');
    const layers = [];
    const collect = (node) => {
      for (const child of node.children) {
        if (child instanceof CanvasLayer) layers.push(child);
        else if (!(child instanceof CanvasItem)) collect(child);
      }
    };
    collect(root);
    layers.sort((a, b) => a.layer - b.layer);
    this._begin(width, height, target);
    this.fontFactor = quantizeOversampling(oversampling);
    const base = [stretch.x, 0, 0, stretch.y, 0, 0];
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
    const transform = multiply(parentTransform, item.get_draw_transform ? item.get_draw_transform() : item.get_transform());
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

  _begin(width, height, target) {
    const gl = this.gl;
    this.width = width;
    this.height = height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.renderer.properties.get(target).__webglFramebuffer);
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
      // The screen buffer counts rows from the top, like the canvas: no flip.
      gl.scissor(x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
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

  /** A textured rectangle given in the item's units, carried to pixels by the affine `t`. */
  _quad(texture, t, x0, y0, x1, y1, u0, v0, u1, v1, c, clip) {
    this._state(texture, 'triangles', clip, 4, 6);
    const b = this.batch;
    const base = b.v;
    this._vertex(t[0] * x0 + t[2] * y0 + t[4], t[1] * x0 + t[3] * y0 + t[5], u0, v0, c.r, c.g, c.b, c.a);
    this._vertex(t[0] * x1 + t[2] * y0 + t[4], t[1] * x1 + t[3] * y0 + t[5], u1, v0, c.r, c.g, c.b, c.a);
    this._vertex(t[0] * x1 + t[2] * y1 + t[4], t[1] * x1 + t[3] * y1 + t[5], u1, v1, c.r, c.g, c.b, c.a);
    this._vertex(t[0] * x0 + t[2] * y1 + t[4], t[1] * x0 + t[3] * y1 + t[5], u0, v1, c.r, c.g, c.b, c.a);
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
    this._quad(tex, t, r.x, r.y, r.x + r.w, r.y + r.h, cmd.uv.x, cmd.uv.y, cmd.uv.x + cmd.uv.w, cmd.uv.y + cmd.uv.h, c, clip);
  }

  /**
   * TextServerAdvanced::_font_draw_glyph / _font_draw_glyph_outline for a run: the bitmap of each
   * glyph at the oversampled size and sub-pixel variant, its rectangle scaled back to the item's
   * units (cache scale / oversampling). O(glyphs).
   */
  _glyphs(run, t, mod, clip) {
    const factor = this.fontFactor;
    const { size26, outline } = glyphSize(run.size, run.outline, factor);
    if (size26 <= 0) return;
    const mode = subPixelMode(size26);
    const c = { r: run.color.r * mod.r, g: run.color.g * mod.g, b: run.color.b * mod.b, a: run.color.a * mod.a };
    for (const g of run.glyphs) {
      const place = placeGlyph(g.x, g.y, mode, factor);
      const entry = this.atlas.glyph(run.font, size26, outline, g.gid, place.shift26);
      if (entry.empty) continue;
      const k = entry.scale / factor;
      const x0 = place.x + entry.left * k;
      const y0 = place.y + entry.top * k;
      this._quad(this._atlasTexture(entry.page), t, x0, y0, x0 + entry.w * k, y0 + entry.h * k, entry.u0, entry.v0, entry.u1, entry.v1, c, clip);
    }
  }
}
