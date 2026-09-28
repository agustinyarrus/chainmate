/**
 * The renderer's arithmetic that needs no GPU: the programs a material compiles for each pass, the
 * size of the fog volume, the frustum the fog fills, the subsurface kernels. What the GPU draws is
 * compared with the original by e2e/stages.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SpatialMaterial, StandardMaterial3D, Pass, writesBuiltin } from '../src/godot/render/material.js';
import { fogVolumeSize, fogFrustum, frustumExtents, FogSettings, TEMPORAL_FRAMES } from '../src/godot/render/volumetric_fog.js';
import { vogelDisk } from '../src/godot/render/lighting.js';
import { SUBSURFACE_KERNELS, SubsurfaceQuality, SubsurfaceSettings, glslLiteral, kernelGlsl } from '../src/godot/render/subsurface.js';
import { RenderingServer, RenderingMethod } from '../src/godot/os.js';

const TEMPLATE_VARYINGS = ['gd_view_pos', 'gd_view_normal', 'gd_uv', 'gd_uv2', 'gd_color'];

const spec = (name, extra = {}) => ({ name, fragment: 'ALBEDO = vec3(1.0);', ...extra });
const count = (text, pattern) => (text.match(pattern) ?? []).length;

test('prepass programs read every varying at the centre of the pixel', () => {
  const material = new SpatialMaterial(
    spec('test-varyings', {
      varyings: `
varying vec3 local_pos; // where the vertex was, a varying among others
/* varying vec2 not_this_one; */
varying highp vec2 wear;
varying   float   sway_amount ;`,
      vertex: 'local_pos = VERTEX; wear = UV; sway_amount = 1.0;',
      fragment: 'ALBEDO = local_pos + vec3(wear, sway_amount);',
    }),
  );
  const prepass = material.forPass(Pass.PREPASS);
  const names = [...TEMPLATE_VARYINGS, 'local_pos', 'wear', 'sway_amount'];
  for (const name of names) {
    assert.match(prepass.fragmentShader, new RegExp(`\\b${name}_at_centre = GD_TO_CENTRE\\(${name}\\);`), `${name} is extrapolated`);
    assert.match(prepass.fragmentShader, new RegExp(`#define ${name} ${name}_at_centre\\b`), `${name} is renamed for the material`);
  }
  assert.doesNotMatch(prepass.fragmentShader, /not_this_one_at_centre/, 'a commented declaration is not a varying');
  assert.equal(count(prepass.fragmentShader, /_at_centre = /g), names.length, 'nothing else is extrapolated');
  // The depth that goes out is the sample's, read before the varyings move.
  assert.match(prepass.fragmentShader, /gd_sample_view_depth = -gd_view_pos\.z;/);
  assert.match(prepass.fragmentShader, /gd_out_depth = vec4\(gd_sample_view_depth,/);
  assert.ok(prepass.fragmentShader.indexOf('void gd_shade_at_pixel_centre()') < prepass.fragmentShader.indexOf('#define gd_view_pos '), 'the move reads the true varyings');

  // The vertex stage links by the true names, and only the prepass moves.
  assert.doesNotMatch(prepass.vertexShader, /_at_centre/);
  assert.match(prepass.vertexShader, /uPrepassShift/);
  assert.doesNotMatch(material.fragmentShader, /_at_centre/, 'the colour pass is shaded by the rasteriser as is');
  assert.doesNotMatch(material.forPass(Pass.SHADOW).fragmentShader, /_at_centre/, 'the shadow pass has no centre to go back to');
  material.dispose();
});

test('prepass programs: edge cases of the varyings', () => {
  const none = new SpatialMaterial(spec('test-no-varyings'));
  assert.equal(count(none.forPass(Pass.PREPASS).fragmentShader, /_at_centre = /g), TEMPLATE_VARYINGS.length, 'a material without varyings moves the template\'s');

  const flat = new SpatialMaterial(spec('test-flat', { varyings: 'varying flat float id;\nvarying flat highp vec2 cell;' }));
  const program = flat.forPass(Pass.PREPASS).fragmentShader;
  assert.match(program, /\bid_at_centre = id;/, 'a flat varying has no slope to follow');
  assert.match(program, /\bcell_at_centre = cell;/);
  assert.match(program, /varying flat float id;/, 'the declaration stays as written');

  for (const [what, varyings] of [
    ['an array', 'varying vec3 joints[4];'],
    ['two names in one declaration', 'varying vec2 a, b;'],
  ]) {
    const material = new SpatialMaterial(spec(`test-bad-${what}`, { varyings }));
    assert.throws(() => material.forPass(Pass.PREPASS), /not understood/, `${what} is refused loudly`);
  }

  // The variants share the uniforms (one set of values per material) and are built once.
  const standard = new StandardMaterial3D({ roughness: 0.4 });
  assert.equal(standard.forPass(Pass.PREPASS), standard.forPass(Pass.PREPASS));
  assert.equal(standard.forPass(Pass.PREPASS).uniforms, standard.uniforms);
  assert.equal(standard.forPass(Pass.COLOR), standard);
});

test('fog volume: 64 froxels across on average, shared out by the aspect', () => {
  const cases = [
    // [width, height] → [froxels across, froxels down]
    [[1600, 900], [81, 50]],
    [[1920, 1080], [81, 50]],
    [[1280, 720], [81, 50]],
    [[1000, 1000], [64, 64]],
    [[900, 1600], [46, 88]],
    [[1080, 2400], [39, 103]],
    [[2400, 1080], [88, 46]],
    // The mean of the sides is an integer division.
    [[1601, 900], [81, 49]],
    [[1, 1], [64, 64]],
    [[2, 1], [128, 32]],
  ];
  for (const [[width, height], [across, down]] of cases) {
    assert.deepEqual(fogVolumeSize(width, height), { width: across, height: down, depth: FogSettings.volumeDepth }, `${width}×${height}`);
  }
  assert.deepEqual(fogVolumeSize(1600, 900, { volumeSize: 16, volumeDepth: 32 }), { width: 20, height: 12, depth: 32 }, 'other project settings');
  assert.equal(TEMPORAL_FRAMES, 16);
});

test('fog frustum: near and far planes read back from the projection', () => {
  const FLOAT = 2e-6;
  for (const [fov, aspect, near, far] of [
    [38, 16 / 9, 0.2, 120],
    [75, 1, 0.05, 4000],
    [20, 9 / 16, 1, 50],
    [120, 2.5, 0.001, 10],
  ]) {
    const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    camera.updateProjectionMatrix();
    const extents = frustumExtents(camera.projectionMatrix);
    const tan = Math.tan((fov * Math.PI) / 360);
    const close = (value, wanted, what) => assert.ok(Math.abs(value - wanted) <= FLOAT * Math.max(1, Math.abs(wanted)) * 8, `${what}: ${value} vs ${wanted} (fov ${fov})`);
    close(extents.zNear, near, 'near');
    // The far plane comes out of a difference of nearly equal numbers: single precision leaves it
    // one part in (far − near) / 2·near · 2²⁴ away. The engine lives with the same error.
    const farError = (2 ** -23 * (far - near)) / (2 * near);
    assert.ok(Math.abs(extents.zFar - far) / far <= farError, `far: ${extents.zFar} vs ${far} (allowed ${farError})`);
    close(extents.near.y, near * tan, 'near half height');
    close(extents.near.x, near * tan * aspect, 'near half width');
    assert.ok(Math.abs(extents.far.y - far * tan) / (far * tan) <= farError, 'far half height');
    assert.ok(Math.abs(extents.far.x / extents.far.y - aspect) < 1e-4, 'the far plane keeps the aspect');
    for (const value of [extents.zNear, extents.zFar, extents.near.x, extents.near.y, extents.far.x, extents.far.y]) assert.equal(value, Math.fround(value), 'single precision');

    // The error of the far plane cancels in the volume: its far face is where the fog ends.
    for (const length of [near * 2, 48, far]) {
      const frustum = fogFrustum(camera.projectionMatrix, length);
      close(frustum.begin.y, Math.max(near * tan, 0.001), 'the volume starts with the near plane');
      assert.ok(Math.abs(frustum.end.y - length * tan) <= 1e-5 * length * tan + 1e-6, `far face of a fog ${length} long: ${frustum.end.y} vs ${length * tan}`);
      assert.ok(Math.abs(frustum.end.x / frustum.end.y - aspect) < 1e-4, 'the far face keeps the aspect');
    }
  }
  // A near plane smaller than a millimetre is widened to one.
  const tiny = new THREE.PerspectiveCamera(10, 1, 0.0001, 10);
  tiny.updateProjectionMatrix();
  assert.deepEqual(fogFrustum(tiny.projectionMatrix, 5).begin, { x: 0.001, y: 0.001 });
});

test('soft shadow kernel: a Vogel disk inside the unit circle', () => {
  for (const samples of [1, 4, 8, 16, 64]) {
    const kernel = vogelDisk(samples);
    assert.equal(kernel.length, samples);
    for (const tap of kernel) assert.ok(tap.length() < 1, `${samples} taps stay inside the disk`);
    const radii = kernel.map((tap) => tap.length());
    assert.deepEqual(radii, [...radii].sort((a, b) => a - b), 'the radius grows with the index');
  }
  // get_vogel_disk(4): r = sqrt(i + 0.5) / sqrt(4), theta = i · 2.4.
  const [first, second] = vogelDisk(4);
  assert.ok(Math.abs(first.x - Math.fround(Math.sqrt(0.5) / 2)) < 1e-7 && first.y === 0);
  assert.ok(Math.abs(second.x - Math.cos(2.4) * (Math.sqrt(1.5) / 2)) < 1e-6);
  assert.deepEqual(vogelDisk(0), [], 'no taps, no kernel');
});

test('SSS_STRENGTH turns scattering on only when fragment() assigns it', () => {
  const cases = [
    ['SSS_STRENGTH = 0.6;', true],
    ['SSS_STRENGTH=x;', true],
    ['SSS_STRENGTH *= 2.0;', true],
    ['\tSSS_STRENGTH\n\t\t= strength * tex;', true],
    ['if (SSS_STRENGTH == 1.0) {}', false],
    ['// SSS_STRENGTH = 1.0;', false],
    ['/* SSS_STRENGTH = 1.0;\n still a comment */', false],
    ['float MY_SSS_STRENGTH = 1.0;', false],
    ['ALBEDO = vec3(1.0);', false],
    ['', false],
    [undefined, false],
  ];
  for (const [code, wanted] of cases) assert.equal(writesBuiltin(code, 'SSS_STRENGTH'), wanted, JSON.stringify(code));

  const wax = new StandardMaterial3D({ albedo_color: undefined, roughness: 0.55, subsurf_scatter_enabled: true, subsurf_scatter_strength: 0.6, rim_enabled: true, rim: 0.3 });
  const plain = new StandardMaterial3D({ roughness: 0.55, subsurf_scatter_strength: 0.6 });
  assert.equal(wax.usesSss, true);
  assert.equal(plain.usesSss, false, 'a strength without the feature scatters nothing (like BaseMaterial3D)');
  assert.equal(wax.uniforms.subsurface_scattering_strength.value, 0.6);
  assert.notEqual(wax.spec.name, plain.spec.name, 'the two compile different programs');

  // The opaque pass of a scattering frame: the same state, two outputs.
  const separate = wax.forPass(Pass.COLOR_SEPARATE);
  assert.equal(separate.uniforms, wax.uniforms);
  assert.equal(separate.side, wax.side);
  assert.equal(separate.depthWrite, wax.depthWrite);
  assert.equal(separate.depthTest, wax.depthTest);
  assert.equal(separate.blending, wax.blending);
  assert.match(separate.fragmentShader, /#define GD_SEPARATE_SPECULAR/);
  assert.doesNotMatch(wax.fragmentShader, /#define GD_SEPARATE_SPECULAR/);
  wax.dispose();
  plain.dispose();
});

test('subsurface kernels: the engine\'s numbers, each profile weighing 1', () => {
  const expectedSizes = { [SubsurfaceQuality.LOW]: 6, [SubsurfaceQuality.MEDIUM]: 9, [SubsurfaceQuality.HIGH]: 13 };
  const numbers = (text) => text.split(',').map((part) => Number(part.trim()));
  for (const [quality, size] of Object.entries(expectedSizes)) {
    const { kernel, skin } = SUBSURFACE_KERNELS[quality];
    assert.equal(kernel.length, size);
    assert.equal(skin.length, size);
    // A symmetric kernel: the centre once, every other tap on both sides.
    const weight = (rows, channel) => rows.reduce((sum, row, i) => sum + numbers(row)[channel] * (i === 0 ? 1 : 2), 0);
    assert.ok(Math.abs(weight(kernel, 0) - 1) < 2e-5, `quality ${quality}: weights sum to ${weight(kernel, 0)}`);
    for (const channel of [0, 1, 2]) assert.ok(Math.abs(weight(skin, channel) - 1) < 2e-5, `quality ${quality}: skin channel ${channel} sums to ${weight(skin, channel)}`);
    // Offsets grow from the centre, and the skin profile shares them.
    const offsets = kernel.map((row) => numbers(row)[1]);
    assert.equal(offsets[0], 0);
    assert.deepEqual(offsets, [...offsets].sort((a, b) => a - b));
    assert.deepEqual(skin.map((row) => numbers(row)[3]), offsets.map((o) => Number(o.toPrecision(6))));
    // The red channel of the skin profile is the plain kernel.
    assert.deepEqual(skin.map((row) => numbers(row)[0]), kernel.map((row) => numbers(row)[0]));

    const glsl = kernelGlsl(Number(quality));
    assert.match(glsl, new RegExp(`const int kernel_size = ${size};`));
    assert.doesNotMatch(glsl, /e-?0\d/, 'no exponent with a leading zero (GLSL ES rejects none, but reads them the same only without)');
  }
  assert.throws(() => kernelGlsl(SubsurfaceQuality.DISABLED), /no kernel/);
  assert.equal(glslLiteral('5.07565e-005'), '5.07565e-5');
  assert.equal(glslLiteral('9.43437e-007, 3'), '9.43437e-7, 3');
  assert.equal(glslLiteral('1e+010'), '1e+10');
  assert.equal(glslLiteral('0.00471691, 2.0'), '0.00471691, 2.0', 'plain decimals stay as written');
  assert.equal(Number(glslLiteral('5.07565e-005')), 5.07565e-5);
  assert.deepEqual(SubsurfaceSettings, { quality: SubsurfaceQuality.LOW, scale: 0.05, depthScale: 0.01 });
});

test('RenderingServer: the method the game asks for before enabling Forward+ features', () => {
  const before = RenderingServer.get_current_rendering_method();
  try {
    RenderingServer.set_rendering_method(RenderingMethod.MOBILE);
    assert.equal(RenderingServer.get_current_rendering_method(), 'mobile');
    assert.equal(new StandardMaterial3D({ subsurf_scatter_enabled: RenderingServer.get_current_rendering_method() === RenderingMethod.FORWARD_PLUS }).usesSss, false);
    assert.throws(() => RenderingServer.set_rendering_method('gl_compatibility_typo'), /unknown rendering method/);
    assert.equal(RenderingServer.get_current_rendering_method(), 'mobile', 'a refused method changes nothing');
  } finally {
    RenderingServer.set_rendering_method(before);
  }
  assert.equal(RenderingServer.get_current_rendering_method(), 'forward_plus');
});
