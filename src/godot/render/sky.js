/**
 * Sky — Godot's `shader_type sky` for the arena: drawn as the background (a far-plane triangle that
 * reconstructs EYEDIR per pixel) and baked into a small mipmapped cubemap that feeds reflections
 * (Environment.reflected_light_source = BG, radiance size 64 like the original).
 */
import * as THREE from 'three';
import { SKY_FUNCTION } from '../../presentation/shaders.js';
import { SMOOTHSTEP_GLSL, portGlsl } from './material.js';
import { sharedUniforms } from './lighting.js';

const RADIANCE_SIZE = 64;

function skyUniforms() {
  return {
    top_color: { value: new THREE.Vector3() },
    horizon_color: { value: new THREE.Vector3() },
    bottom_color: { value: new THREE.Vector3() },
    glow_color: { value: new THREE.Vector3() },
    glow_dir: { value: new THREE.Vector3(-0.8, 0, -0.6) },
    uInvView: sharedUniforms.uInvView,
  };
}

// The view ray is unprojected per vertex (homogeneous, so it interpolates exactly) and divided per pixel.
const BACKGROUND_VERTEX = /* glsl */ `
out vec4 vViewH;
void main() {
	vViewH = inverse(projectionMatrix) * vec4(position.xy, 1.0, 1.0);
	gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

const BACKGROUND_FRAGMENT = /* glsl */ `
precision highp float;
uniform mat4 uInvView;
in vec4 vViewH;
layout(location = 0) out vec4 out_color;
layout(location = 1) out vec4 out_indirect;
${SMOOTHSTEP_GLSL}
${portGlsl(SKY_FUNCTION)}
void main() {
	vec3 eyedir = normalize((uInvView * vec4(vViewH.xyz / vViewH.w, 0.0)).xyz);
	out_color = vec4(gd_sky(eyedir), 1.0);
	out_indirect = vec4(0.0);
}`;

const CUBE_VERTEX = /* glsl */ `
out vec3 vDir;
void main() {
	vDir = position;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const CUBE_FRAGMENT = /* glsl */ `
precision highp float;
in vec3 vDir;
layout(location = 0) out vec4 out_color;
${SMOOTHSTEP_GLSL}
${portGlsl(SKY_FUNCTION)}
void main() {
	out_color = vec4(gd_sky(normalize(vDir)), 1.0);
}`;

export class SkyRenderer {
  /** @param {import('./pipeline.js').RenderPipeline} pipeline */
  constructor(pipeline) {
    this.pipeline = pipeline;
    this.uniforms = skyUniforms();
    const background = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: BACKGROUND_VERTEX,
      fragmentShader: BACKGROUND_FRAGMENT,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const triangle = new THREE.BufferGeometry();
    triangle.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.background = new THREE.Mesh(triangle, background);
    this.background.frustumCulled = false;
    this.background.renderOrder = -1e9;
    pipeline.scene.add(this.background);

    this.cubeTarget = new THREE.WebGLCubeRenderTarget(RADIANCE_SIZE, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.cubeCamera = new THREE.CubeCamera(0.1, 10, this.cubeTarget);
    this.cubeScene = new THREE.Scene();
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: CUBE_VERTEX,
      fragmentShader: CUBE_FRAGMENT,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }));
    this.cubeScene.add(box);
    this.cubeScene.add(this.cubeCamera);
    this._version = -1;
    sharedUniforms.uRadiance.value = this.cubeTarget.texture;
    sharedUniforms.uUseRadiance.value = 1;
  }

  /** @param {object} sky the arena's sky parameters (Godot colours, sRGB) */
  update(sky) {
    if (sky.version === this._version) return;
    this._version = sky.version;
    const lin = (color, out) => {
      const c = color.srgb_to_linear();
      out.set(c.r, c.g, c.b);
    };
    lin(sky.top_color, this.uniforms.top_color.value);
    lin(sky.horizon_color, this.uniforms.horizon_color.value);
    lin(sky.bottom_color, this.uniforms.bottom_color.value);
    lin(sky.glow_color, this.uniforms.glow_color.value);
    this.uniforms.glow_dir.value.set(sky.glow_dir.x, sky.glow_dir.y, sky.glow_dir.z);
    const renderer = this.pipeline.renderer;
    const previous = renderer.getRenderTarget();
    this.cubeCamera.update(renderer, this.cubeScene);
    renderer.setRenderTarget(previous);
  }
}
