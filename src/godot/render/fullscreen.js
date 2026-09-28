/**
 * Full-screen passes — the shared plumbing of every post effect: one triangle-pair quad, one
 * orthographic camera, and ShaderMaterials written in GLSL ES 3.0 with `vUv` (0..1, y up) as input.
 */
import * as THREE from 'three';

const FULLSCREEN_VERTEX = /* glsl */ `
out vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** A ShaderMaterial for a full-screen pass; `fragment` declares its own uniforms and outputs. */
export function fullscreenMaterial(fragment, uniforms, defines = {}) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: `precision highp float;\nprecision highp int;\nprecision highp sampler2D;\nin vec2 vUv;\n${fragment}`,
    uniforms,
    defines,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

export class FullscreenQuad {
  /** @param {THREE.WebGLRenderer} renderer */
  constructor(renderer) {
    this.renderer = renderer;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  /** Draws `material` over the whole `target` (null = the canvas). */
  draw(material, target) {
    this.mesh.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }
}

/**
 * Gives `target` a mip chain of `levels` levels that the passes draw themselves.
 *
 * three.js allocates one level per entry of `texture.mipmaps` but leaves the texture's level range
 * open; a chain that stops before the 1×1 level is then incomplete for WebGL, which samples it as
 * black and refuses to draw into its levels. Closing the range (TEXTURE_MAX_LEVEL) makes the short
 * chain the whole texture, as the engine's textures with explicit mip counts are.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.WebGLRenderTarget} target a 2D, array or 3D target, not yet used
 */
export function withMipChain(renderer, target, levels) {
  target.texture.mipmaps = Array.from({ length: levels }, () => ({}));
  target.texture.generateMipmaps = false;
  renderer.initRenderTarget(target);
  const gl = renderer.getContext();
  const kind = target.isWebGLArrayRenderTarget ? gl.TEXTURE_2D_ARRAY : target.isWebGL3DRenderTarget ? gl.TEXTURE_3D : gl.TEXTURE_2D;
  renderer.state.bindTexture(kind, renderer.properties.get(target.texture).__webglTexture);
  gl.texParameteri(kind, gl.TEXTURE_MAX_LEVEL, levels - 1);
  renderer.state.unbindTexture();
  return target;
}

/** HDR colour target of the post chain (RGBA16F, no depth), linear or nearest filtered. */
export function hdrTarget(width, height, filter = THREE.LinearFilter) {
  return new THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    minFilter: filter,
    magFilter: filter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  });
}
