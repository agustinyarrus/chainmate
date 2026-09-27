/**
 * Label3D — text in the 3D scene exactly as Godot lays it out:
 *   - glyphs shaped by the port's TextServer (same advances as the original, integer at these sizes);
 *   - HORIZONTAL/VERTICAL_ALIGNMENT_CENTER: pen starts at −width/2, baseline at (descent − ascent)/2;
 *   - one pixel of text = pixel_size world units;
 *   - outline: FreeType stroker ring of outline_size/4 px drawn under the fill (outline_render_priority)
 *     in outline_modulate; fill in modulate — both vertex colours Godot converts from sRGB;
 *   - unshaded, double sided, alpha blended, optional billboard / no depth test, render priority.
 *
 * The two layers are rasterised once into one mask texture (R = fill, G = outline) and composited
 * in the shader as "fill over outline", so tweening modulate or its alpha never re-rasterises.
 * Masks are cached per (font, size, outline, text). Rebuilds happen at render time, like Godot's
 * deferred _im_update.
 */
import * as THREE from 'three';
import { Color } from './math.js';
import { Node3D } from './node3d.js';
import { SceneTree } from './scene.js';
import { SpatialMaterial } from './render/material.js';
import { drawGlyphs, outlineRadius } from './text/raster.js';

/** Extra texels around the text so outline anti-aliasing never touches the edge. */
const PAD = 2;
const MASK_CACHE_LIMIT = 64;

const LABEL_SHADER = (depthTest) => ({
  name: depthTest ? 'label3d' : 'label3d_nodepth',
  renderMode: { unshaded: true, blend: 'premul', depthDraw: 'never', depthTest, cull: 'disabled', shadowsDisabled: true, fogDisabled: true },
  uniforms: {
    mask: { type: 'sampler2D', value: null },
    fill_color: { type: 'vec4', value: new Color(1, 1, 1, 1), source: true },
    outline_color: { type: 'vec4', value: new Color(0, 0, 0, 1), source: true },
    billboard: { type: 'float', value: 0 },
  },
  vertex: /* glsl */ `
	if (billboard > 0.5) {
		// BILLBOARD_ENABLED: face the camera plane, keep the node's scale.
		vec3 s = vec3(length(MODEL_MATRIX[0].xyz), length(MODEL_MATRIX[1].xyz), length(MODEL_MATRIX[2].xyz));
		MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
		MODELVIEW_MATRIX = MODELVIEW_MATRIX * mat4(vec4(s.x, 0.0, 0.0, 0.0), vec4(0.0, s.y, 0.0, 0.0), vec4(0.0, 0.0, s.z, 0.0), vec4(0.0, 0.0, 0.0, 1.0));
	}`,
  fragment: /* glsl */ `
	vec4 m = texture(mask, UV);
	float fa = m.r * fill_color.a;
	float oa = m.g * outline_color.a;
	// Outline surface first, fill surface over it (premultiplied).
	ALBEDO = fill_color.rgb * fa + outline_color.rgb * oa * (1.0 - fa);
	ALPHA = fa + oa * (1.0 - fa);`,
});

const maskCache = new Map();

/** Rasterises fill and outline masks of one line of text. Cached, LRU. */
function textMask(font, size, outlineSize, text) {
  const key = `${font.name}|${size}|${outlineSize}|${text}`;
  const hit = maskCache.get(key);
  if (hit) {
    maskCache.delete(key);
    maskCache.set(key, hit);
    return hit;
  }
  const shaped = font.shape(text, size);
  const radius = outlineSize > 0 ? outlineRadius(outlineSize) : 0;
  const margin = Math.ceil(radius) + PAD;
  // Glyph ink may overhang the advance box (italics, bearings): measure generously.
  const width = Math.max(1, Math.ceil(shaped.width) + margin * 2 + Math.ceil(size * 0.25));
  const height = Math.ceil(shaped.ascent + shaped.descent) + margin * 2;
  const originX = margin + Math.ceil(size * 0.125);
  const baseline = margin + shaped.ascent;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const layer = (mode) => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    drawGlyphs(ctx, shaped, originX, baseline, { mode, radius });
    return ctx.getImageData(0, 0, width, height).data;
  };
  const fill = layer('fill');
  const ring = radius > 0 ? layer('stroke') : null;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill[i * 4 + 3];
    data[i * 4 + 1] = ring ? ring[i * 4 + 3] : 0;
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const mask = { texture, width, height, originX, baseline, lineWidth: shaped.width, ascent: shaped.ascent, descent: shaped.descent, users: 0 };
  maskCache.set(key, mask);
  if (maskCache.size > MASK_CACHE_LIMIT) {
    for (const [k, m] of maskCache) {
      if (m.users > 0) continue;
      m.texture.dispose();
      maskCache.delete(k);
      if (maskCache.size <= MASK_CACHE_LIMIT) break;
    }
  }
  return mask;
}

export class Label3D extends Node3D {
  constructor() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    geometry.setIndex([0, 3, 2, 0, 2, 1]);
    super('Label3D', new THREE.Mesh(geometry));
    this.object3d.castShadow = false;
    this.object3d.receiveShadow = false;
    this.object3d.frustumCulled = false;
    this._text = '';
    this._font = null;
    this._fontSize = 32;
    this._outlineSize = 12;
    this._pixelSize = 0.005;
    this._modulate = new Color(1, 1, 1, 1);
    this._outlineModulate = new Color(0, 0, 0, 1);
    this._billboard = false;
    this._noDepthTest = false;
    this.render_priority = 0;
    this.outline_render_priority = -1;
    this._mask = null;
    this._dirty = true;
    this._material = null;
    this._renderHook = () => this._update();
  }

  get text() { return this._text; }
  set text(v) { this._text = String(v); this._dirty = true; }
  get font() { return this._font; }
  set font(v) { this._font = v; this._dirty = true; }
  get font_size() { return this._fontSize; }
  set font_size(v) { this._fontSize = v; this._dirty = true; }
  get outline_size() { return this._outlineSize; }
  set outline_size(v) { this._outlineSize = v; this._dirty = true; }
  get pixel_size() { return this._pixelSize; }
  set pixel_size(v) { this._pixelSize = v; this._dirty = true; }
  get no_depth_test() { return this._noDepthTest; }
  set no_depth_test(v) { this._noDepthTest = Boolean(v); this._material = null; this._dirty = true; }

  /** BaseMaterial3D.BILLBOARD_ENABLED (1) or DISABLED (0); booleans accepted. */
  get billboard() { return this._billboard; }
  set billboard(v) {
    this._billboard = Boolean(v);
    this._material?.set_shader_parameter('billboard', this._billboard ? 1 : 0);
  }

  get modulate() { return this._modulate.clone(); }
  set modulate(c) {
    this._modulate = c.clone();
    this._material?.set_shader_parameter('fill_color', this._modulate);
  }
  get outline_modulate() { return this._outlineModulate.clone(); }
  set outline_modulate(c) {
    this._outlineModulate = c.clone();
    this._material?.set_shader_parameter('outline_color', this._outlineModulate);
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
    if (this._mask) this._mask.users -= 1;
    this.object3d.geometry.dispose();
    this._material?.dispose();
  }

  _ensureMaterial() {
    if (this._material) return;
    this._material = new SpatialMaterial(LABEL_SHADER(!this._noDepthTest), {
      fill_color: this._modulate,
      outline_color: this._outlineModulate,
      billboard: this._billboard ? 1 : 0,
    });
    this.object3d.material = this._material;
    this.object3d.renderOrder = Math.max(this.render_priority, this.outline_render_priority);
    if (this._mask) this._material.uniforms.mask.value = this._mask.texture;
  }

  /** Label3D::_shape — mask texture and quad placed on Godot's glyph layout. */
  _update() {
    this._ensureMaterial();
    this.object3d.renderOrder = Math.max(this.render_priority, this.outline_render_priority);
    if (!this._dirty || !this._font) return;
    this._dirty = false;
    const drawOutline = this._outlineSize > 0 && this._outlineModulate.a !== 0;
    const mask = textMask(this._font, this._fontSize, drawOutline ? this._outlineSize : 0, this._text);
    if (this._mask) this._mask.users -= 1;
    mask.users += 1;
    this._mask = mask;
    this._material.uniforms.mask.value = mask.texture;
    const ps = this._pixelSize;
    // Pen origin of the (single) line and its baseline, in local units (y up).
    const penX = (-mask.lineWidth / 2) * ps;
    const baselineY = ((mask.descent - mask.ascent) / 2) * ps;
    const left = penX - mask.originX * ps;
    const right = penX + (mask.width - mask.originX) * ps;
    const top = baselineY + mask.baseline * ps;
    const bottom = baselineY + (mask.baseline - mask.height) * ps;
    const position = this.object3d.geometry.getAttribute('position');
    position.array.set([left, top, 0, right, top, 0, right, bottom, 0, left, bottom, 0]);
    position.needsUpdate = true;
    // DataTexture rows run top-down with v growing downward (flipY off).
    const uv = this.object3d.geometry.getAttribute('uv');
    uv.array.set([0, 0, 1, 0, 1, 1, 0, 1]);
    uv.needsUpdate = true;
    this.object3d.geometry.computeBoundingSphere();
  }
}
