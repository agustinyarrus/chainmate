/**
 * Stage probe — the port's side of _oracle/probe_stages.gd, call for call.
 *
 * It plays the opening of the arena tour at a fixed 1/60 s step and, at each camera stop, freezes
 * time and captures the same stages the original captured of itself: the engine's debug views and
 * the ablation matrix (each light and each environment feature alone over a bare linear image).
 *
 *   index.html?probe=stages                          every shot, every stage
 *   index.html?probe=stages&shots=outpost,crypt      some camera stops
 *   index.html?probe=stages&stages=bare,key,final    some stages
 *   index.html?probe=stages&sync=0                   never copy the oracle's state
 *
 * At each stop the port's own state is recorded first (what e2e/stages.mjs compares with the
 * oracle's: camera, clocks, lights — the measure of how exactly the simulation follows the
 * original); then, unless `sync=0`, the clocks and the camera rig take the oracle's values, so the
 * images that follow differ only by what the renderer does.
 */
import { Node } from '../godot/scene.js';
import { Engine } from '../godot/os.js';
import { Light3D, OmniLight3D, MeshInstance3D, MultiMeshInstance3D } from '../godot/node3d.js';
import { GPUParticles3D } from '../godot/particles.js';
import { Label3D } from '../godot/label3d.js';
import { Vector3 } from '../godot/math.js';
import { DebugDraw } from '../godot/render/pipeline.js';
import { Arena } from '../presentation/arena.js';
import { CameraRig } from '../presentation/camera_rig.js';

const SETTLE_FRAMES = 16;
/** Frames the original's renderer draws before the main loop starts counting (none). */
const ORACLE_FRAME_LEAD = 0;
const SEED = 'TOUR-7';
const LOW_PITCH = 0.68;
const LOW_YAW_OFFSET = -0.7;

/** Stage → the debug view of the pipeline. A release build ignores `lighting` and `pssm`. */
const VIEWS = Object.freeze({
  final: DebugDraw.DISABLED,
  unshaded: DebugDraw.UNSHADED,
  lighting: DebugDraw.DISABLED,
  normal: DebugDraw.NORMAL_BUFFER,
  ssao: DebugDraw.SSAO,
  ssil: DebugDraw.SSIL,
  shadow_atlas: DebugDraw.DIRECTIONAL_SHADOW_ATLAS,
  pssm: DebugDraw.DISABLED,
  internal: DebugDraw.INTERNAL_BUFFER,
});
const LOW_VIEWS = Object.freeze(['final', 'normal', 'ssao', 'ssil', 'pssm']);

/** The bare image: lights, ambient and reflections through a linear tone curve, nothing else. */
const BARE = Object.freeze({
  glow_enabled: false,
  ssao_enabled: false,
  ssil_enabled: false,
  fog_enabled: false,
  volumetric_fog_enabled: false,
  adjustment_enabled: false,
  tonemap_mode: 'linear',
  tonemap_exposure: 1.0,
  tonemap_white: 1.0,
});
const NO_AMBIENT = Object.freeze({ ambient_light_energy: 0.0 });
const NO_REFLECTION = Object.freeze({ reflected_light_source: 'disabled' });

const ABLATIONS = Object.freeze([
  { name: 'bare', keep: [], set: [], lights: 'all', shadow: false },
  { name: 'bare_shadow', keep: [], set: [], lights: 'all', shadow: true },
  { name: 'bare_ssao', keep: ['ssao_enabled'], set: [], lights: 'all', shadow: false },
  { name: 'bare_ssil', keep: ['ssil_enabled'], set: [], lights: 'all', shadow: false },
  { name: 'bare_fog', keep: ['fog_enabled'], set: [], lights: 'all', shadow: false },
  { name: 'bare_volfog', keep: ['volumetric_fog_enabled'], set: [], lights: 'all', shadow: false, needs: 'volumetric_fog_enabled' },
  { name: 'bare_glow', keep: ['glow_enabled'], set: [], lights: 'all', shadow: false },
  { name: 'bare_grade', keep: ['adjustment_enabled', 'tonemap_mode', 'tonemap_exposure', 'tonemap_white'], set: [], lights: 'all', shadow: false },
  { name: 'ambient', keep: [], set: [NO_REFLECTION], lights: 'none', shadow: false },
  { name: 'reflection', keep: [], set: [], lights: 'none', shadow: false },
  { name: 'key', keep: [], set: [NO_AMBIENT, NO_REFLECTION], lights: 'key', shadow: false },
  { name: 'key_shadow', keep: [], set: [NO_AMBIENT, NO_REFLECTION], lights: 'key', shadow: true },
  { name: 'fill', keep: [], set: [NO_AMBIENT, NO_REFLECTION], lights: 'fill', shadow: false },
  { name: 'omni', keep: [], set: [NO_AMBIENT, NO_REFLECTION], lights: 'omni', shadow: false },
]);
const LOW_ABLATIONS = Object.freeze(['bare', 'bare_shadow']);

/** Accumulates the scaled frame steps from the first frame: the value shaders read as TIME. */
class Clock extends Node {
  constructor() {
    super('OracleClock');
    this.time = 0;
    this.frames = 0;
  }
  _process(delta) {
    this.time += delta;
    this.frames += 1;
  }
}

const xf = (object3d) => {
  object3d.updateWorldMatrix(true, false);
  const e = object3d.matrixWorld.elements;
  return [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10], e[12], e[13], e[14]];
};
const color = (c) => [c.r, c.g, c.b, c.a];

/** Every node under `root`, depth first in tree order. O(nodes). */
function all(root) {
  const found = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    found.push(node);
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
  }
  return found;
}

const className = (node) => {
  if (node instanceof MultiMeshInstance3D) return 'MultiMeshInstance3D';
  if (node instanceof MeshInstance3D) return 'MeshInstance3D';
  if (node instanceof GPUParticles3D) return 'GPUParticles3D';
  if (node instanceof Label3D) return 'Label3D';
  return node.constructor.name;
};

export class StageProbe {
  /**
   * @param {object} app the application shell (main.js)
   * @param {{entries: object[]}|null} oracle _oracle/stages.json, or null when it is not there
   */
  constructor(app, oracle) {
    this.app = app;
    this.tree = app.tree;
    const params = app.params;
    const list = (name) => (params.get(name) ? new Set(params.get(name).split(',')) : null);
    this.onlyShots = list('shots');
    this.onlyStages = list('stages');
    this.sync = params.get('sync') !== '0';
    /** shot → the oracle's state at that camera stop. */
    this.oracle = new Map((oracle?.entries ?? []).filter((e) => e.k === 'state').map((e) => [e.shot, e]));
    this.clock = new Clock();
    this.images = 0;
    // `lead=n`: frames the original's renderer would have drawn before its first iteration.
    this.frameLead = Number(params.get('lead') ?? ORACLE_FRAME_LEAD);
    // `sample=x,y`: where in each pixel the prepass looks (an experiment's knob).
    const sample = params.get('sample')?.split(',').map(Number);
    if (sample?.length === 2 && sample.every(Number.isFinite)) app.pipeline.setPrepassSample({ x: sample[0], y: sample[1] });
  }

  emit(entry) {
    this.app.probe.entries.push(entry);
  }

  *wait(seconds) {
    yield this.tree.create_timer(seconds);
  }

  *frames(count) {
    for (let i = 0; i < count; i++) yield this.tree.frame_post_draw;
  }

  /** The probe itself: a coroutine started before the first frame. */
  *run() {
    const { app, tree } = this;
    tree.root.add_child(this.clock);
    // The original's probe starts inside an autoload, before the main scene exists: one frame passes.
    yield tree.process_frame;
    const main = app.main;
    this.emit({ k: 'setup', viewport: [app.viewport.size.x, app.viewport.size.y], window: [app.pipeline.width, app.pipeline.height], sync: this.sync });

    yield* this.wait(0.5);
    main.start_run({ seed: SEED, army: 'vanguard', difficulty: 'standard' });
    yield* this.wait(0.8);
    main.gs.skip_relic();
    main._leave_stop();
    yield* this.wait(0.6);
    main._choose_node(0);
    yield* this.wait(2.5);
    main.hud.visible = false;
    for (const variant of Arena.VARIANTS) {
      main.arena.set_variant(variant);
      main.rig.reset_view();
      yield* this.wait(1.8);
      yield* this.stages(variant, Object.keys(VIEWS), ABLATIONS.map((row) => row.name));
      main.rig.target_pitch = LOW_PITCH;
      main.rig.target_yaw = CameraRig.DEFAULT_YAW + LOW_YAW_OFFSET;
      yield* this.wait(1.8);
      yield* this.stages(`${variant}_low`, LOW_VIEWS, LOW_ABLATIONS);
    }
    this.emit({ k: 'done', images: this.images, frames: this.clock.frames, time: this.clock.time });
    app.probe.done = true;
  }

  wanted(shot, stage) {
    return (!this.onlyShots || this.onlyShots.has(shot)) && (!this.onlyStages || this.onlyStages.has(stage));
  }

  /** One camera stop: freeze, record, take the oracle's clocks, capture every stage, thaw. */
  *stages(shot, views, ablations) {
    const { app } = this;
    const main = app.main;
    yield this.tree.frame_post_draw;
    Engine.time_scale = 0.0;
    const hidden = all(main).filter((node) => node instanceof GPUParticles3D && node.visible);
    for (const node of hidden) node.visible = false;
    const overlayVisible = main.overlay.visible;
    main.overlay.visible = false;
    this.emit(this.state(shot));
    if (this.sync) this.takeOracleState(shot);

    const pipeline = app.pipeline;
    for (const view of views) {
      pipeline.debugDraw = VIEWS[view];
      yield* this.capture(shot, view);
    }
    pipeline.debugDraw = DebugDraw.DISABLED;

    const environment = main.arena.environment;
    const key = main.arena.key_light;
    const lights = all(main).filter((node) => node instanceof Light3D);
    for (const row of ABLATIONS) {
      if (!ablations.includes(row.name)) continue;
      if (row.needs && !environment[row.needs]) continue;
      const saved = new Map();
      const override = (property, value) => {
        if (!saved.has(property)) saved.set(property, environment[property]);
        environment[property] = value;
      };
      for (const [property, value] of Object.entries(BARE)) if (!row.keep.includes(property)) override(property, value);
      for (const group of row.set) for (const [property, value] of Object.entries(group)) override(property, value);
      const shadowWas = key.shadow_enabled;
      key.shadow_enabled = row.shadow;
      const hiddenLights = this.showLights(lights, row.lights);
      yield* this.capture(shot, row.name);
      for (const [property, value] of saved) environment[property] = value;
      key.shadow_enabled = shadowWas;
      for (const light of hiddenLights) light.visible = true;
    }

    for (const node of hidden) node.visible = true;
    main.overlay.visible = overlayVisible;
    // Let the temporal effects forget the ablations before time runs again.
    yield* this.frames(SETTLE_FRAMES);
    Engine.time_scale = 1.0;
  }

  /** Leaves visible only the lights of `group`; returns the ones it hid. */
  showLights(lights, group) {
    const arena = this.app.main.arena;
    const keep = {
      all: () => true,
      none: () => false,
      key: (light) => light === arena.key_light,
      fill: (light) => light === arena._fill,
      omni: (light) => light instanceof OmniLight3D,
    }[group];
    const hidden = [];
    for (const light of lights) {
      if (keep(light) || !light.visible) continue;
      light.visible = false;
      hidden.push(light);
    }
    return hidden;
  }

  *capture(shot, stage) {
    // The frames always pass (the temporal effects of the next stage depend on them); the image is
    // kept only when asked for.
    yield* this.frames(SETTLE_FRAMES);
    this.images += 1;
    if (!this.wanted(shot, stage)) return;
    const { app } = this;
    app.probe.shots.push({ name: `${shot}.${stage}`, shot, stage, width: app.pipeline.width, height: app.pipeline.height, url: app.canvas.toDataURL('image/png') });
    this.emit({ k: 'image', shot, stage, file: `${shot}.${stage}.png`, frames: this.clock.frames, time: this.clock.time });
  }

  // ─────────────────────────────────────────────────────────────── state ─────────────────────────

  state(shot) {
    const { app } = this;
    const main = app.main;
    const rig = main.rig;
    const arena = main.arena;
    const camera = rig.camera.camera;
    const lights = [];
    const geometry = [];
    for (const node of all(main)) {
      if (node instanceof Light3D) lights.push(this.light(node));
      else if (node instanceof MeshInstance3D || node instanceof MultiMeshInstance3D || node instanceof GPUParticles3D || node instanceof Label3D) geometry.push(this.geometry(node));
    }
    const pieces = [];
    for (const [id, view] of main.piece_views) {
      pieces.push({ id, kind: view.kind, friendly: view.friendly, level: view.level, xf: xf(view.object3d), body: xf(view.body.object3d), glow: view._glow, lift: view._lift, time: view._time });
    }
    return {
      k: 'state',
      shot,
      frames: this.clock.frames,
      time: this.clock.time,
      shader_time: app.shaderTime,
      viewport: [app.viewport.size.x, app.viewport.size.y],
      camera: { xf: xf(camera), fov: camera.fov, near: camera.near, far: camera.far, projection: Array.from(camera.projectionMatrix.elements) },
      rig: { yaw: rig.yaw, pitch: rig.pitch, zoom: rig.zoom, focus: [rig.focus.x, rig.focus.y, rig.focus.z], trauma: rig.trauma, time: rig._time },
      arena: {
        variant: arena.variant,
        flicker_time: arena._flickerTime,
        mood: [arena._mood.x, arena._mood.y],
        flames: arena._flames.map((flame) => ({ energy: flame.energy, speed: flame.speed, phase: flame.phase, flicker: flame.flicker, now: flame.light.light_energy })),
      },
      hover_cell: [main.hover_cell.x, main.hover_cell.y],
      screen: main.screen,
      busy: main.busy,
      lights,
      geometry,
      pieces,
    };
  }

  light(light) {
    const directional = !(light instanceof OmniLight3D);
    return {
      class: directional ? 'DirectionalLight3D' : 'OmniLight3D',
      visible: light.isVisibleInTree(),
      xf: xf(light.object3d),
      color: color(light.light_color),
      negative: light.light_negative,
      shadow: light.shadow_enabled,
      params: {
        energy: light.light_energy,
        volumetric_fog_energy: light.light_volumetric_fog_energy,
        specular: light.light_specular,
        range: directional ? 5 : light.omni_range,
        size: light.light_angular_distance,
        attenuation: directional ? 1 : light.omni_attenuation,
        shadow_normal_bias: light.shadow_normal_bias,
        shadow_bias: light.shadow_bias,
        shadow_opacity: light.shadow_opacity,
        shadow_blur: light.shadow_blur,
        ...(directional
          ? {
              shadow_max_distance: light.directional_shadow_max_distance,
              split_1: light.directional_shadow_split_1,
              split_2: light.directional_shadow_split_2,
              split_3: light.directional_shadow_split_3,
              shadow_fade_start: light.directional_shadow_fade_start,
              shadow_pancake_size: light.directional_shadow_pancake_size,
            }
          : {}),
      },
    };
  }

  geometry(node) {
    const entry = { class: className(node), name: node.name, visible: node.isVisibleInTree(), xf: xf(node.object3d), cast_shadow: node.object3d.userData.castShadow !== false };
    if (node instanceof MultiMeshInstance3D) entry.instances = node.transforms.length;
    if (node instanceof Label3D) entry.text = node.text;
    const material = node.object3d.material;
    entry.material = Array.isArray(material) ? material.map((m) => m?.name ?? null) : material?.name ?? null;
    return entry;
  }

  /** The clocks and the rig take the oracle's values: from here on only the renderer differs. */
  takeOracleState(shot) {
    const oracle = this.oracle.get(shot);
    if (!oracle) return;
    const { app } = this;
    const main = app.main;
    app.shaderTime = oracle.time;
    // The renderer numbers its frames from 1 and the clock from 0; the fog's jitter follows the number.
    app.pipeline.frameNumber = this.clock.frames + 1 + this.frameLead;
    main.arena._flickerTime = oracle.arena.flicker_time;
    const rig = main.rig;
    rig.yaw = oracle.rig.yaw;
    rig.pitch = oracle.rig.pitch;
    rig.zoom = oracle.rig.zoom;
    rig.focus = new Vector3(...oracle.rig.focus);
    rig.trauma = oracle.rig.trauma;
    rig._time = oracle.rig.time;
    const byId = new Map(oracle.pieces.map((piece) => [piece.id, piece]));
    for (const [id, view] of main.piece_views) {
      const piece = byId.get(id);
      if (!piece) continue;
      view._time = piece.time;
      view._glow = piece.glow;
      view._lift = piece.lift;
    }
    this.takeRandomParameters(oracle);
  }

  /**
   * Cloth phases and flame seeds come from the engine's global random generator, seeded from the
   * clock at start-up: no two runs of the original share them. The port's take the oracle's, paired
   * in tree order (and checked by position). O(meshes).
   */
  takeRandomParameters(oracle) {
    const meshes = all(this.app.main).filter((node) => node instanceof MeshInstance3D);
    for (const { shader, uniform } of RANDOM_PARAMETERS) {
      const theirs = oracle.geometry.filter((g) => g.class === 'MeshInstance3D' && materialOf(g)?.shader?.endsWith(`/${shader}.gdshader`));
      const ours = meshes.filter((node) => node.object3d.material?.spec?.name === shader);
      if (theirs.length !== ours.length) {
        this.emit({ k: 'warning', text: `${shader}: the original has ${theirs.length} meshes, the port ${ours.length}; ${uniform} not synchronised` });
        continue;
      }
      theirs.forEach((entry, i) => {
        const place = xf(ours[i].object3d).slice(9);
        const apart = Math.max(...place.map((value, axis) => Math.abs(value - entry.xf[9 + axis])));
        if (apart > SAME_PLACE) this.emit({ k: 'warning', text: `${shader} #${i}: ${apart.toFixed(4)} away from the original's` });
        ours[i].object3d.material.set_shader_parameter(uniform, materialOf(entry).parameters[uniform]);
      });
    }
  }
}

/** Shader parameters the game draws from the global random generator. */
const RANDOM_PARAMETERS = Object.freeze([
  { shader: 'cloth', uniform: 'phase' },
  { shader: 'flame', uniform: 'seed' },
]);
const SAME_PLACE = 1e-3;
const materialOf = (entry) => entry.override ?? entry.surfaces?.find((surface) => surface !== null) ?? null;
