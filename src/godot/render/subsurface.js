/**
 * Subsurface scattering — Godot 4.7's screen-space SSS (effects/ss_effects.cpp
 * SSEffects::sub_surface_scattering, shaders/effects/subsurface_scattering.glsl) and the merge of the
 * specular light (copy_effects.cpp merge_specular), with the project's settings: quality Low (11
 * samples), scale 0.05, depth scale 0.01.
 *
 * When a surface in view writes SSS_STRENGTH, the opaque pass keeps its light in two buffers
 * (MODE_SEPARATE_SPECULAR): the diffuse light with the strength in alpha, and the specular light.
 * Once they are resolved:
 *
 *   blur     the diffuse light is blurred along x, then along y, with a separable kernel as wide as
 *            the strength and the distance say; a side stops at the first sample (bilinear, alpha
 *            included) that belongs to a surface without scattering
 *   merge    specular + blurred diffuse is written over every sample of the frame, and the
 *            transparent pass is drawn on top of that
 *
 * Here the merge is a full-screen triangle drawn first in the transparent pass (one resolve instead
 * of two). The depth the blur reads is the alpha of the specular buffer: every sample stores the
 * reversed depth of its surface there (the engine keeps metallic, which nothing reads), so the resolve
 * averages depths exactly as the engine's depth resolve does. The textures keep the engine's rows, so
 * the kernel steps go the same way. O(pixels · kernel) for the surfaces that scatter, O(pixels)
 * elsewhere.
 */
import * as THREE from 'three';
import { fullscreenMaterial, hdrTarget } from './fullscreen.js';
import { frustumExtents } from './volumetric_fog.js';

/** RenderingServer.SubSurfaceScatteringQuality */
export const SubsurfaceQuality = Object.freeze({ DISABLED: 0, LOW: 1, MEDIUM: 2, HIGH: 3 });

/** rendering/environment/subsurface_scattering/* (the engine's defaults, which the game ships). */
export const SubsurfaceSettings = Object.freeze({ quality: SubsurfaceQuality.LOW, scale: 0.05, depthScale: 0.01 });

/** The kernels of subsurface_scattering.glsl, digit for digit: (weight, offset) and the skin profile. */
export const SUBSURFACE_KERNELS = Object.freeze({
  [SubsurfaceQuality.LOW]: {
    kernel: ['0.560479, 0.0', '0.0771802, 0.08', '0.0821904, 0.32', '0.03639, 0.72', '0.0192831, 1.28', '0.00471691, 2.0'],
    skin: [
      '0.560479, 0.669086, 0.784728, 0',
      '0.0771802, 0.113491, 0.0793803, 0.08',
      '0.0821904, 0.0358608, 0.0209261, 0.32',
      '0.03639, 0.0130999, 0.00643685, 0.72',
      '0.0192831, 0.00282018, 0.00084214, 1.28',
      '0.00471691, 0.000184771, 5.07565e-005, 2',
    ],
  },
  [SubsurfaceQuality.MEDIUM]: {
    kernel: ['0.536343, 0.0', '0.0324462, 0.03125', '0.0582416, 0.125', '0.0571056, 0.28125', '0.0347317, 0.5', '0.0216301, 0.78125', '0.0144609, 1.125', '0.0100386, 1.53125', '0.00317394, 2.0'],
    skin: [
      '0.536343, 0.624624, 0.748867, 0',
      '0.0324462, 0.0656718, 0.0532821, 0.03125',
      '0.0582416, 0.0659959, 0.0411329, 0.125',
      '0.0571056, 0.0287432, 0.0172844, 0.28125',
      '0.0347317, 0.0151085, 0.00871983, 0.5',
      '0.0216301, 0.00794618, 0.00376991, 0.78125',
      '0.0144609, 0.00317269, 0.00106399, 1.125',
      '0.0100386, 0.000914679, 0.000275702, 1.53125',
      '0.00317394, 0.000134823, 3.77269e-005, 2',
    ],
  },
  [SubsurfaceQuality.HIGH]: {
    kernel: [
      '0.530605, 0.0', '0.0211412, 0.0208333', '0.0402784, 0.0833333', '0.0493588, 0.1875', '0.0410172, 0.333333', '0.0263642, 0.520833', '0.017924, 0.75',
      '0.0128496, 1.02083', '0.0094389, 1.33333', '0.00700976, 1.6875', '0.00500364, 2.08333', '0.00333804, 2.52083', '0.000973794, 3.0',
    ],
    skin: [
      '0.530605, 0.613514, 0.739601, 0',
      '0.0211412, 0.0459286, 0.0378196, 0.0208333',
      '0.0402784, 0.0657244, 0.04631, 0.0833333',
      '0.0493588, 0.0367726, 0.0219485, 0.1875',
      '0.0410172, 0.0199899, 0.0118481, 0.333333',
      '0.0263642, 0.0119715, 0.00684598, 0.520833',
      '0.017924, 0.00711691, 0.00347194, 0.75',
      '0.0128496, 0.00356329, 0.00132016, 1.02083',
      '0.0094389, 0.00139119, 0.000416598, 1.33333',
      '0.00700976, 0.00049366, 0.000151938, 1.6875',
      '0.00500364, 0.00020094, 5.28848e-005, 2.08333',
      '0.00333804, 7.85443e-005, 1.2945e-005, 2.52083',
      '0.000973794, 1.11862e-005, 9.43437e-007, 3',
    ],
  },
});

/** The engine's literals as GLSL ES reads them the same: exponents without leading zeros (5.07565e-5). */
export const glslLiteral = (text) => text.replace(/e([-+]?)0+(\d)/g, 'e$1$2');
const literal = glslLiteral;

/** The kernel constants of a quality, as the shader declares them. */
export function kernelGlsl(quality) {
  const entry = SUBSURFACE_KERNELS[quality];
  if (!entry) throw new Error(`SubsurfaceScattering: no kernel for quality ${quality}`);
  const { kernel, skin } = entry;
  return /* glsl */ `
const int kernel_size = ${kernel.length};
const vec2 kernel[${kernel.length}] = vec2[${kernel.length}](
${kernel.map((k) => `\t\tvec2(${literal(k)})`).join(',\n')});
const vec4 skin_kernel[${skin.length}] = vec4[${skin.length}](
${skin.map((k) => `\t\tvec4(${literal(k)})`).join(',\n')});`;
}

const BLUR = (quality) => /* glsl */ `
${kernelGlsl(quality)}
uniform sampler2D source_image;
// The resolved specular buffer: its alpha is the resolved depth.
uniform sampler2D source_depth;
uniform ivec2 screen_size;
uniform float camera_z_far;
uniform float camera_z_near;
uniform int vertical;
uniform float unit_size;
uniform float scale;
uniform float depth_scale;
layout(location = 0) out vec4 out_color;

void do_filter(inout vec3 color_accum, inout vec3 divisor, vec2 uv, vec2 step, bool p_skin) {
	// Accumulate the other samples:
	for (int i = 1; i < kernel_size; i++) {
		// Fetch color and depth for current sample:
		vec2 offset = uv + kernel[i].y * step;
		vec4 color = texture(source_image, offset);
		if (abs(color.a) < 0.001) {
			break; // mix no more
		}
		vec3 w;
		if (p_skin) {
			w = skin_kernel[i].rgb;
		} else {
			w = vec3(kernel[i].x);
		}
		color_accum += color.rgb * w;
		divisor += w;
	}
}

void main() {
	// Pixel being shaded
	ivec2 ssC = ivec2(gl_FragCoord.xy);
	vec2 uv = (vec2(ssC) + 0.5) / vec2(screen_size);
	// Fetch color of current pixel:
	vec4 base_color = texture(source_image, uv);
	float strength = abs(base_color.a);
	if (strength > 0.0) {
		vec2 dir = vertical == 1 ? vec2(0.0, 1.0) : vec2(1.0, 0.0);
		// Fetch linear depth of current pixel:
		float depth = texture(source_depth, uv).a * 2.0 - 1.0;
		depth = 2.0 * camera_z_near * camera_z_far / (camera_z_far + camera_z_near + depth * (camera_z_far - camera_z_near));
		float depth_scale_here = unit_size / depth;
		float scale_here = mix(scale, depth_scale_here, depth_scale);
		// Calculate the final step to fetch the surrounding pixels:
		vec2 step = scale_here * dir;
		step *= strength;
		step /= 3.0;
		// Accumulate the center sample:
		vec3 divisor;
		bool skin = bool(base_color.a < 0.0);
		if (skin) {
			divisor = skin_kernel[0].rgb;
		} else {
			divisor = vec3(kernel[0].x);
		}
		vec3 color = base_color.rgb * divisor;
		do_filter(color, divisor, uv, step, skin);
		do_filter(color, divisor, uv, -step, skin);
		base_color.rgb = color / divisor;
	}
	out_color = base_color;
}`;

/** Before everything else of the transparent pass (a finite number: three.js subtracts orders). */
const MERGE_RENDER_ORDER = -1e9;

/** specular_merge.glsl, MODE_MERGE: the samples are overwritten, no blending. */
const MERGE_VERTEX = /* glsl */ `
void main() {
	gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const MERGE_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D specular;
uniform sampler2D diffuse;
layout(location = 0) out vec4 frag_color;
layout(location = 1) out vec4 frag_specular;
void main() {
	ivec2 pos = ivec2(gl_FragCoord.xy);
	frag_color.rgb = texelFetch(specular, pos, 0).rgb;
	frag_color.a = 0.0;
	frag_color += texelFetch(diffuse, pos, 0);
	// The specular buffer has been read: what lands there now is never used.
	frag_specular = vec4(0.0);
}`;

/** A texel-exact copy (the specular buffer, when the frame has no samples apart from its textures). */
const COPY_FRAGMENT = /* glsl */ `
uniform sampler2D source;
layout(location = 0) out vec4 frag_color;
void main() {
	frag_color = texelFetch(source, ivec2(gl_FragCoord.xy), 0);
}`;

export class SubsurfaceScattering {
  /**
   * @param {import('./pipeline.js').RenderPipeline} pipeline
   * @param {number} transparentLayer the layer of the transparent pass (the merge is drawn in it)
   */
  constructor(pipeline, transparentLayer, settings = SubsurfaceSettings) {
    this.pipeline = pipeline;
    this.quad = pipeline.quad;
    this.settings = settings;
    /** Tools and quality settings may switch the effect off; the frame then keeps its light together. */
    this.active = true;
    this.transparentLayer = transparentLayer;
    this.width = 0;
    this.height = 0;
    this.targets = null;
    this.blur =
      settings.quality === SubsurfaceQuality.DISABLED
        ? null
        : fullscreenMaterial(BLUR(settings.quality), {
            source_image: { value: null },
            source_depth: { value: null },
            screen_size: { value: new THREE.Vector2() },
            camera_z_far: { value: 1 },
            camera_z_near: { value: 0.1 },
            vertical: { value: 0 },
            unit_size: { value: 1 },
            scale: { value: settings.scale },
            depth_scale: { value: settings.depthScale },
          });
    this.copy = fullscreenMaterial(COPY_FRAGMENT, { source: { value: null } });
    const triangle = new THREE.BufferGeometry();
    triangle.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.merge = new THREE.Mesh(
      triangle,
      new THREE.ShaderMaterial({
        name: 'specular_merge',
        glslVersion: THREE.GLSL3,
        vertexShader: MERGE_VERTEX,
        fragmentShader: MERGE_FRAGMENT,
        uniforms: { specular: { value: null }, diffuse: { value: null } },
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    this.merge.name = 'SpecularMerge';
    this.merge.frustumCulled = false;
    this.merge.renderOrder = MERGE_RENDER_ORDER;
    // The pipeline gives every mesh its layers each frame; this one says which it wants.
    this.merge.userData.passLayers = 0;
    pipeline.scene.add(this.merge);
    pipeline.subsurface = this;
    if (pipeline.width > 0) this.resize(pipeline.width, pipeline.height);
  }

  /** Whether the effect runs: the project's settings allow it and nothing has switched it off. */
  get enabled() {
    return this.blur !== null && this.active;
  }

  resize(width, height) {
    if (width === this.width && height === this.height) return;
    this.dispose();
    this.width = width;
    this.height = height;
    // The intermediate image is read through a bilinear sampler; the result only texel by texel.
    // `specular` is made only for frames without multisampling (see scatter).
    this.targets = { intermediate: hdrTarget(width, height, THREE.LinearFilter), result: hdrTarget(width, height, THREE.NearestFilter), specular: null };
  }

  dispose() {
    if (!this.targets) return;
    this.targets.intermediate.dispose();
    this.targets.result.dispose();
    this.targets.specular?.dispose();
    this.targets = null;
  }

  /**
   * Blurs the diffuse light of `color` (resolved: attachment 0 diffuse with the strength in alpha,
   * attachment 1 specular with the depth in alpha) and arms the merge for the transparent pass.
   * @param {THREE.WebGLRenderTarget} color
   * @param {THREE.PerspectiveCamera} camera the scene camera
   */
  scatter(color, camera) {
    const u = this.blur.uniforms;
    const extents = frustumExtents(camera.projectionMatrix);
    u.screen_size.value.set(this.width, this.height);
    u.camera_z_near.value = extents.zNear;
    u.camera_z_far.value = extents.zFar;
    // Projection::xform4(Plane(1, 0, -1, 1)).normal.x / d: how wide a unit is at unit distance.
    u.unit_size.value = Math.fround(camera.projectionMatrix.elements[0]);
    u.source_depth.value = color.textures[1];

    u.vertical.value = 0;
    u.source_image.value = color.textures[0];
    this.quad.draw(this.blur, this.targets.intermediate);
    u.vertical.value = 1;
    u.source_image.value = this.targets.intermediate.texture;
    this.quad.draw(this.blur, this.targets.result);
    u.source_image.value = null;
    u.source_depth.value = null;

    const merge = this.merge.material.uniforms;
    merge.specular.value = this._readableSpecular(color);
    merge.diffuse.value = this.targets.result.texture;
    this.merge.userData.passLayers = 1 << this.transparentLayer;
    this.merge.layers.mask = this.merge.userData.passLayers;
  }

  /**
   * The specular buffer as the merge may read it. Multisampled, the merge draws into the samples and
   * reads the resolved texture. Without samples the texture IS what the merge draws into — a feedback
   * loop WebGL refuses — so it is read from a copy. O(pixels) in that case, O(1) otherwise.
   */
  _readableSpecular(color) {
    if (color.samples > 0) return color.textures[1];
    this.targets.specular ??= hdrTarget(this.width, this.height, THREE.NearestFilter);
    this.copy.uniforms.source.value = color.textures[1];
    this.quad.draw(this.copy, this.targets.specular);
    this.copy.uniforms.source.value = null;
    return this.targets.specular.texture;
  }

  /** After the transparent pass: the merge stays out of the frames that do not scatter. */
  disarm() {
    this.merge.userData.passLayers = 0;
    this.merge.layers.mask = 0;
    const merge = this.merge.material.uniforms;
    merge.specular.value = null;
    merge.diffuse.value = null;
  }
}
