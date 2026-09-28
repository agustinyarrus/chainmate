/**
 * Label3D — port of scene/3d/label_3d.cpp (Godot 4.7): text in the 3D scene, one textured quad per
 * glyph straight from the font's glyph cache.
 *
 *   layout    the line is shaped by the text server at font_size; with centre alignment the pen
 *             starts at −width/2 and the first baseline at (total height − line spacing)/2 − ascent,
 *             everything multiplied by pixel_size;
 *   glyphs    bitmap of (font_size, outline_size) without sub-pixel variants; the quad is the glyph
 *             rectangle (bitmap plus its one-pixel margin) offset from the pen;
 *   surfaces  outline quads first (outline_render_priority), then the text's (render_priority), each
 *             blended on its own — overlapping outlines of neighbouring letters add up, as in the
 *             engine; vertex colours are modulate / outline_modulate, sRGB converted by the shader;
 *   material  StandardMaterial3D::get_material_for_2d: unshaded, alpha blended, double sided,
 *             optional billboard and no depth test, linear filtering.
 *
 * The mesh is rebuilt at render time when text, font or sizes change (the engine's deferred
 * _im_update); colour changes only rewrite the colour buffer. O(glyphs) either way.
 */
import * as THREE from 'three';
import { Color } from './math.js';
import { Node3D } from './node3d.js';
import { SceneTree } from './scene.js';
import { SpatialMaterial } from './render/material.js';
import { ATLAS_SIZE, GlyphAtlas } from './text/atlas.js';

const VERTICES_PER_GLYPH = 4;
const FIXED_ONE = 64;
const DEFAULT_LINE_SPACING = 0;

const LABEL_SHADER = (depthTest) => ({
  name: depthTest ? 'label3d' : 'label3d_nodepth',
  renderMode: { unshaded: true, alpha: true, depthDraw: 'never', depthTest, cull: 'disabled', shadowsDisabled: true, fogDisabled: true },
  uniforms: {
    texture_albedo: { type: 'sampler2D', value: null },
    billboard: { type: 'float', value: 0 },
  },
  functions: /* glsl */ `
vec3 label_srgb_to_linear(vec3 color) {
	return mix(pow((color + vec3(0.055)) * (1.0 / (1.0 + 0.055)), vec3(2.4)), color * (1.0 / 12.92), lessThan(color, vec3(0.04045)));
}`,
  vertex: /* glsl */ `
	if (billboard > 0.5) {
		// BILLBOARD_ENABLED: face the camera plane, keep the node's scale.
		vec3 s = vec3(length(MODEL_MATRIX[0].xyz), length(MODEL_MATRIX[1].xyz), length(MODEL_MATRIX[2].xyz));
		MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
		MODELVIEW_MATRIX = MODELVIEW_MATRIX * mat4(vec4(s.x, 0.0, 0.0, 0.0), vec4(0.0, s.y, 0.0, 0.0), vec4(0.0, 0.0, s.z, 0.0), vec4(0.0, 0.0, 0.0, 1.0));
	}`,
  fragment: /* glsl */ `
	vec4 albedo_tex = texture(texture_albedo, UV);
	// vertex_color_is_srgb + vertex_color_use_as_albedo
	ALBEDO = label_srgb_to_linear(COLOR.rgb) * albedo_tex.rgb;
	ALPHA = COLOR.a * albedo_tex.a;`,
});

/** One atlas for every Label3D; its pages become three.js textures on first use. */
const atlas = new GlyphAtlas();

function pageTexture(page) {
  if (!page.handle) {
    const texture = new THREE.DataTexture(page.pixels, ATLAS_SIZE, ATLAS_SIZE, THREE.RGBAFormat);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.NoColorSpace;
    page.handle = texture;
    page.dirty = true;
  }
  if (page.dirty) {
    page.handle.needsUpdate = true;
    page.dirty = false;
  }
  return page.handle;
}

export class Label3D extends Node3D {
  constructor() {
    super('Label3D', new THREE.Mesh(new THREE.BufferGeometry(), []));
    this.object3d.castShadow = false;
    this.object3d.receiveShadow = false;
    this.object3d.frustumCulled = false;
    this._text = '';
    this._font = null;
    this._fontSize = 32;
    this._outlineSize = 12;
    this._pixelSize = 0.005;
    this._lineSpacing = DEFAULT_LINE_SPACING;
    this._modulate = new Color(1, 1, 1, 1);
    this._outlineModulate = new Color(0, 0, 0, 1);
    this._billboard = false;
    this._noDepthTest = false;
    this._renderPriority = 0;
    this._outlineRenderPriority = -1;
    /** What must be rebuilt at the next render: the whole mesh, or only its colours. */
    this._dirtyMesh = true;
    this._dirtyColors = false;
    /** Per surface: { outline: boolean, first vertex, vertex count } — for colour updates. */
    this._surfaces = [];
    /** `priority|page id` → { material, page }: one material per atlas page and render priority. */
    this._materials = new Map();
    this._renderHook = () => this._update();
  }

  get text() { return this._text; }
  set text(v) { this._text = String(v); this._dirtyMesh = true; }
  get font() { return this._font; }
  set font(v) { this._font = v; this._dirtyMesh = true; }
  get font_size() { return this._fontSize; }
  set font_size(v) { this._fontSize = v; this._dirtyMesh = true; }
  get outline_size() { return this._outlineSize; }
  set outline_size(v) { this._outlineSize = v; this._dirtyMesh = true; }
  get pixel_size() { return this._pixelSize; }
  set pixel_size(v) { this._pixelSize = v; this._dirtyMesh = true; }
  get line_spacing() { return this._lineSpacing; }
  set line_spacing(v) { this._lineSpacing = v; this._dirtyMesh = true; }
  /** Material render priority of the text's surfaces (the transparent pass sorts by it first). */
  get render_priority() { return this._renderPriority; }
  set render_priority(v) { this._renderPriority = v; this._dirtyMesh = true; }
  /** Material render priority of the outline's surfaces. */
  get outline_render_priority() { return this._outlineRenderPriority; }
  set outline_render_priority(v) { this._outlineRenderPriority = v; this._dirtyMesh = true; }
  get no_depth_test() { return this._noDepthTest; }
  set no_depth_test(v) {
    this._noDepthTest = Boolean(v);
    this._dropMaterials();
    this._dirtyMesh = true;
  }

  /** BaseMaterial3D.BILLBOARD_ENABLED (1) or DISABLED (0); booleans accepted. */
  get billboard() { return this._billboard; }
  set billboard(v) {
    this._billboard = Boolean(v);
    for (const { material } of this._materials.values()) material.set_shader_parameter('billboard', this._billboard ? 1 : 0);
  }

  get modulate() { return this._modulate.clone(); }
  set modulate(c) {
    this._modulate = c.clone();
    this._dirtyColors = true;
  }
  get outline_modulate() { return this._outlineModulate.clone(); }
  set outline_modulate(c) {
    // An outline that becomes visible or invisible changes which surfaces exist.
    if ((c.a !== 0) !== (this._outlineModulate.a !== 0)) this._dirtyMesh = true;
    this._outlineModulate = c.clone();
    this._dirtyColors = true;
  }

  _enter_tree() {
    SceneTree.current?.renderHooks.add(this._renderHook);
    this._update();
  }

  _exit_tree() {
    SceneTree.current?.renderHooks.delete(this._renderHook);
  }

  _dispose() {
    super._dispose();
    SceneTree.current?.renderHooks.delete(this._renderHook);
    this.object3d.geometry.dispose();
    this._dropMaterials();
  }

  _dropMaterials() {
    for (const { material } of this._materials.values()) material.dispose();
    this._materials.clear();
  }

  /**
   * One material per atlas page and render priority (the engine: per texture, priority and outline
   * size — the outline size only picks glyph bitmaps here). The priority rides on the material, so
   * the transparent pass draws every outline of priority 9 before any text of priority 10, whatever
   * label they belong to, as the engine's sort does.
   */
  _material(page, priority) {
    const key = `${priority}|${page.id}`;
    let slot = this._materials.get(key);
    if (!slot) {
      const material = new SpatialMaterial(LABEL_SHADER(!this._noDepthTest), { billboard: this._billboard ? 1 : 0 });
      material.renderPriority = priority;
      slot = { material, page };
      this._materials.set(key, slot);
    }
    slot.material.uniforms.texture_albedo.value = pageTexture(page);
    return slot.material;
  }

  _update() {
    if (this._dirtyMesh) this._shape();
    else if (this._dirtyColors) this._paint();
    // Glyphs rasterised since the last frame (by this or another label) reach the GPU here.
    for (const { page } of this._materials.values()) pageTexture(page);
  }

  /** Label3D::_shape for a single-line text with centred alignment (what the game uses). */
  _shape() {
    this._dirtyMesh = false;
    this._dirtyColors = false;
    const font = this._font;
    const geometry = this.object3d.geometry;
    this._surfaces = [];
    if (!font || this._text.length === 0) {
      geometry.setIndex([]);
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
      return;
    }
    const shaped = font.shape(this._text, this._fontSize);
    const ps = this._pixelSize;
    const size26 = this._fontSize * FIXED_ONE;
    const lineHeight = shaped.ascent + shaped.descent;
    const totalHeight = (lineHeight + this._lineSpacing) * ps;
    const begin = (totalHeight - this._lineSpacing * ps) / 2.0;
    const startX = -(shaped.width * ps) / 2.0;
    const baseline = begin - shaped.ascent * ps;

    const positions = [];
    const uvs = [];
    const indices = [];
    const groups = [];
    /** Quads of one pass, grouped by atlas page in order of first use (the engine's surface map). */
    const pass = (outlineSize, outline) => {
      const byPage = new Map();
      let pen = startX;
      for (const glyph of shaped.glyphs) {
        const advance = glyph.advance * ps;
        if (glyph.gid !== 0) {
          const entry = atlas.glyph(font, size26, outlineSize, glyph.gid, 0);
          if (!entry.empty) {
            let quads = byPage.get(entry.page);
            if (!quads) byPage.set(entry.page, (quads = []));
            const x = pen + (entry.left + glyph.xOff) * ps;
            const top = baseline - (entry.top + glyph.yOff) * ps;
            quads.push({ x0: x, x1: x + entry.w * ps, top, bottom: top - entry.h * ps, entry });
          }
        }
        pen += advance;
      }
      for (const [page, quads] of byPage) {
        const firstVertex = positions.length / 3;
        const firstIndex = indices.length;
        for (const q of quads) {
          const base = positions.length / 3;
          positions.push(q.x0, q.top, 0, q.x1, q.top, 0, q.x1, q.bottom, 0, q.x0, q.bottom, 0);
          uvs.push(q.entry.u0, q.entry.v0, q.entry.u1, q.entry.v0, q.entry.u1, q.entry.v1, q.entry.u0, q.entry.v1);
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
        groups.push({ start: firstIndex, count: indices.length - firstIndex, page, priority: outline ? this._outlineRenderPriority : this._renderPriority });
        this._surfaces.push({ outline, first: firstVertex, count: quads.length * VERTICES_PER_GLYPH });
      }
    };
    if (this._outlineModulate.a !== 0 && this._outlineSize > 0) pass(this._outlineSize, true);
    pass(0, false);

    const vertexCount = positions.length / 3;
    const normals = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) normals[i * 3 + 2] = 1;
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(vertexCount * 4), 4));
    geometry.setIndex(indices);
    geometry.clearGroups();
    const materials = [];
    groups.forEach((group, i) => {
      geometry.addGroup(group.start, group.count, i);
      materials.push(this._material(group.page, group.priority));
    });
    this.object3d.material = materials;
    this._paint();
  }

  /** Vertex colours: outline_modulate on outline surfaces, modulate on the text's. */
  _paint() {
    this._dirtyColors = false;
    const attribute = this.object3d.geometry.getAttribute('aColor');
    if (!attribute) return;
    const colors = attribute.array;
    for (const surface of this._surfaces) {
      const c = surface.outline ? this._outlineModulate : this._modulate;
      for (let i = surface.first; i < surface.first + surface.count; i++) {
        colors[i * 4] = c.r;
        colors[i * 4 + 1] = c.g;
        colors[i * 4 + 2] = c.b;
        colors[i * 4 + 3] = c.a;
      }
    }
    attribute.needsUpdate = true;
  }
}
