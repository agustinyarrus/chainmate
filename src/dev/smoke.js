/**
 * Render smoke test: arena + board + live PieceViews + relics on the rim under the menu or board
 * camera, with every VFX callable from the console / CDP (`smoke.fx('capture')`).
 *   ?variant=crypt&yaw=0.42&pitch=0.93&safe=menu|board&relics=6&pieces=rows|battle
 */
import { SceneTree } from '../godot/scene.js';
import { Node3D, Camera3D } from '../godot/node3d.js';
import { Vector2, Vector2i, Vector3 } from '../godot/math.js';
import { RenderPipeline } from '../godot/render/pipeline.js';
import { SkyRenderer } from '../godot/render/sky.js';
import { lighting, sharedUniforms } from '../godot/render/lighting.js';
import { Settings } from '../autoload/settings.js';
import { Relics } from '../core/relics.js';
import { Arena } from '../presentation/arena.js';
import { BoardView } from '../presentation/board_view.js';
import { CameraRig } from '../presentation/camera_rig.js';
import { PieceView } from '../presentation/piece_view.js';
import { RelicView } from '../presentation/relic_view.js';
import { Vfx } from '../presentation/vfx.js';
import { Palette } from '../presentation/palette.js';
import { loadFonts } from '../presentation/ui/fonts.js';

await loadFonts();

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const stats = document.getElementById('stats');
const pipeline = new RenderPipeline(canvas);
const sky = new SkyRenderer(pipeline);
const tree = new SceneTree();
Settings._ready();
Camera3D.viewportSize = () => ({ x: innerWidth, y: innerHeight });

const world = new Node3D('World');
pipeline.scene.add(world.object3d);
tree.root.add_child(world);

const arena = new Arena();
world.add_child(arena);
arena.set_variant(params.get('variant') ?? 'court');
arena.set_mood(0.9, 0.25, 0.0);
// The pipeline draws the key light's shadow atlas, the sky and the lights itself (pipeline.render).
lighting.environment = arena.environment;

const board = new BoardView();
world.add_child(board);
const vfx = new Vfx();
world.add_child(vfx);

const kinds = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'];
const views = [];
let serial = 0;
function spawn(kind, cell, friendly, level) {
  const view = new PieceView();
  world.add_child(view);
  view.setup({ id: `p${serial++}`, kind, friendly, level, cell });
  view.position = BoardView.cell_to_world(cell);
  views.push(view);
  return view;
}
kinds.forEach((kind, x) => {
  spawn(kind, new Vector2i(x, 5), true, 0);
  spawn(kind, new Vector2i(x, 4), true, 3);
  spawn(kind, new Vector2i(x, 0), false, 1);
});

const relicIds = Object.keys(Relics.CATALOGUE).slice(0, Number(params.get('relics') ?? 6));
const relics = relicIds.map((id, i) => {
  const view = new RelicView();
  world.add_child(view);
  view.setup(id);
  view.place(arena.relic_spot(i));
  view.rotation = new Vector3(0, CameraRig.DEFAULT_YAW, 0);
  return view;
});

const rig = new CameraRig();
rig.viewportSize = () => new Vector2(innerWidth, innerHeight);
world.add_child(rig);
if ((params.get('safe') ?? 'menu') === 'menu') rig.set_safe_area(-0.04, 0.86, -0.72, 0.72);
else rig.frame_board();
if (params.has('yaw')) rig.yaw = rig.target_yaw = Number(params.get('yaw'));
if (params.has('pitch')) rig.pitch = rig.target_pitch = Number(params.get('pitch'));

/** Every effect the battle plays, by name (for visual checks). */
const effects = {
  capture() {
    const victim = views.find((v) => !v.friendly && !v.is_queued_for_deletion());
    if (!victim) return;
    const origin = victim.global_position;
    victim.shatter(vfx, 1.0);
    vfx.burst(origin.add(Vector3.UP.mul(0.35)), Palette.CAPTURE, 26, 3.0);
    vfx.flash(origin.add(Vector3.UP.mul(0.5)), Palette.CAPTURE, 2.2, 0.2, 2.2);
    vfx.float_text(origin.add(Vector3.UP.mul(victim.top_height() + 0.35)), '+1 XP', Palette.GOLD_BRIGHT, 60);
    rig.add_trauma(0.32);
  },
  promote() {
    const pawn = views.find((v) => v.friendly && v.kind === 'pawn');
    pawn.promote(vfx);
    vfx.float_text(pawn.global_position.add(Vector3.UP.mul(1.6)), 'Promoted', Palette.GOLD_BRIGHT, 60);
  },
  evolve() {
    const piece = views.find((v) => v.friendly && v.level === 0 && v.kind === 'rook');
    piece.evolve(vfx, 2);
  },
  ring() {
    vfx.ring(new Vector3(0, 0.05, 0), Palette.CHAIN, 0.9, 0.5);
  },
  select() {
    views.forEach((v) => v.clear_marks());
    const piece = views.find((v) => v.friendly && v.kind === 'queen');
    piece.set_selected(true);
    views.find((v) => !v.friendly && v.kind === 'queen')?.set_targeted(true);
    views.find((v) => v.friendly && v.kind === 'king')?.set_threatened(true);
  },
  relic() {
    relics[0]?.trigger(vfx, Palette.RARITY_COLORS[Relics.info(relics[0].id).rarity]);
  },
  drop() {
    relics.forEach((r, i) => r.drop_in(vfx, i * 0.25));
  },
  topple() {
    views.filter((v) => v.friendly).forEach((v, i) => v.topple(0.1 + i * 0.07));
  },
};

let last = performance.now();
let frames = 0;
let fpsClock = last;
function frame(now) {
  const delta = Math.min((now - last) / 1000, 0.1);
  last = now;
  sharedUniforms.TIME.value = (now / 1000) % 3600;
  pipeline.resize(innerWidth, innerHeight, devicePixelRatio);
  tree.step(delta);
  tree.preRender(delta);
  const camera = rig.camera.camera;
  camera.aspect = pipeline.width / pipeline.height;
  camera.updateProjectionMatrix();
  world.object3d.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  pipeline.render(camera, arena.environment);
  pipeline.present();
  tree.afterDraw();
  frames += 1;
  if (now - fpsClock > 1000) {
    stats.textContent = `${frames} fps · ${pipeline.stats.drawCalls} draws · ${(pipeline.stats.triangles / 1000).toFixed(0)}k tris · ${pipeline.width}×${pipeline.height}${pipeline.stats.subsurface ? ' · sss' : ''}`;
    frames = 0;
    fpsClock = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.smoke = { pipeline, arena, rig, tree, vfx, views, relics, fx: (name) => effects[name](), effects: Object.keys(effects), ready: true };
