/**
 * Inspector — reads any texture of the renderer back as floats, whatever its format, layer or mip.
 * A development tool, loaded on demand from the page under test:
 *
 *   const { Inspector } = await import('/src/dev/inspect.js');
 *   const inspector = new Inspector(window.chainmate.pipeline);
 *   inspector.summary(target.texture, { layer: 2 });          // min / max / mean per channel
 *   inspector.read(target.texture, { x: 10, y: 20, width: 4, height: 4 });
 *
 * The texture is copied texel by texel into a 32-bit float target, which is what gets read: values
 * arrive exactly as stored (no filtering, no conversion). O(texels read).
 */
import * as THREE from 'three';
import { fullscreenMaterial } from '../godot/render/fullscreen.js';

const COPY = (sampler, fetch) => /* glsl */ `
precision highp ${sampler};
uniform ${sampler} source;
uniform ivec2 origin;
uniform int layer;
uniform int level;
layout(location = 0) out vec4 out_value;
void main() {
	ivec2 at = origin + ivec2(gl_FragCoord.xy);
	out_value = ${fetch};
}`;

const CHANNELS = 4;

export class Inspector {
  /** @param {import('../godot/render/pipeline.js').RenderPipeline} pipeline */
  constructor(pipeline) {
    this.renderer = pipeline.renderer;
    this.quad = pipeline.quad;
    const uniforms = () => ({ source: { value: null }, origin: { value: new THREE.Vector2() }, layer: { value: 0 }, level: { value: 0 } });
    this.flat = fullscreenMaterial(COPY('sampler2D', 'texelFetch(source, at, level)'), uniforms());
    this.array = fullscreenMaterial(COPY('sampler2DArray', 'texelFetch(source, ivec3(at, layer), level)'), uniforms());
    this.volume = fullscreenMaterial(COPY('sampler3D', 'texelFetch(source, ivec3(at, layer), level)'), uniforms());
    this.target = null;
  }

  _target(width, height) {
    if (this.target && this.target.width === width && this.target.height === height) return this.target;
    this.target?.dispose();
    this.target = new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    return this.target;
  }

  /** Size of `texture` at mip `level`. */
  sizeOf(texture, level = 0) {
    const image = texture.image ?? {};
    return { width: Math.max(1, (image.width ?? 1) >> level), height: Math.max(1, (image.height ?? 1) >> level), depth: image.depth ?? 1 };
  }

  /**
   * The texels of a rectangle, as RGBA floats in rows (first row = row 0 of the texture).
   * @returns {{width: number, height: number, data: Float32Array}}
   */
  read(texture, { x = 0, y = 0, width = null, height = null, layer = 0, level = 0 } = {}) {
    const size = this.sizeOf(texture, level);
    const w = Math.min(width ?? size.width, size.width - x);
    const h = Math.min(height ?? size.height, size.height - y);
    const material = texture.isData3DTexture || texture.is3DTexture ? this.volume : texture.isDataArrayTexture || texture.isArrayTexture ? this.array : this.flat;
    const u = material.uniforms;
    u.source.value = texture;
    u.origin.value.set(x, y);
    u.layer.value = layer;
    u.level.value = level;
    const target = this._target(w, h);
    const previous = this.renderer.getRenderTarget();
    this.quad.draw(material, target);
    const data = new Float32Array(w * h * CHANNELS);
    this.renderer.readRenderTargetPixels(target, 0, 0, w, h, data);
    this.renderer.setRenderTarget(previous);
    u.source.value = null;
    return { width: w, height: h, data };
  }

  /** Minimum, maximum and mean of every channel, and how many values are not finite. O(texels). */
  summary(texture, options = {}) {
    const { width, height, data } = this.read(texture, options);
    const min = new Array(CHANNELS).fill(Infinity);
    const max = new Array(CHANNELS).fill(-Infinity);
    const sum = new Array(CHANNELS).fill(0);
    let notFinite = 0;
    for (let i = 0; i < data.length; i++) {
      const value = data[i];
      if (!Number.isFinite(value)) {
        notFinite += 1;
        continue;
      }
      const c = i % CHANNELS;
      if (value < min[c]) min[c] = value;
      if (value > max[c]) max[c] = value;
      sum[c] += value;
    }
    const count = width * height;
    return { width, height, min, max, mean: sum.map((s) => s / count), notFinite };
  }
}
