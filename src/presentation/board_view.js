/**
 * BoardView — port of scripts/presentation/board_view.gd: the 36 stone tiles (tile shader with
 * terrain states), a marking quad and a cursor quad per tile (highlight shader), and the move arc.
 */
import { Vector2, Vector2i, Vector3, fposmod } from '../godot/math.js';
import { GDict } from '../godot/gdscript.js';
import { Node3D, MeshInstance3D } from '../godot/node3d.js';
import { SpatialMaterial } from '../godot/render/material.js';
import { planeMesh } from '../godot/render/primitives.js';
import { EASE } from '../godot/tween.js';
import { Board } from '../core/board.js';
import { Settings } from '../autoload/settings.js';
import { Arena } from './arena.js';
import { MeshKit } from './mesh_kit.js';
import { Palette } from './palette.js';
import { TILE_SHADER, HIGHLIGHT_SHADER, ROUTE_SHADER } from './shaders.js';

export const Mark = Object.freeze({ NONE: 0, MOVE: 1, CAPTURE: 2, CHAIN: 3, SELECTED: 4, HOVER: 5, HINT: 6, CURSOR: 7, REACH: 8, DANGER: 9 });

const TILE_TOP = 0.06;
const TILE_SIZE = 0.965;
const TILE_HEIGHT = 0.16;
const STATE_INDEX = { '': 0, enchanted: 1, corrupted: 2, frozen: 3 };

export class BoardView extends Node3D {
  static Mark = Mark;
  static TILE_TOP = TILE_TOP;
  static TILE_SIZE = TILE_SIZE;
  static TILE_HEIGHT = TILE_HEIGHT;

  constructor() {
    super('BoardView');
    this._tile_materials = new GDict();
    this._marks = new GDict();
    this._cursors = new GDict();
    this._arc_mesh = null;
    this._arc_material = null;
    this._tint_tweens = new GDict();
  }

  static cell_to_world(cell, height = TILE_TOP) {
    return new Vector3(cell.x - (Board.SIZE - 1) * 0.5, height, cell.y - (Board.SIZE - 1) * 0.5);
  }

  static world_to_cell(point) {
    return new Vector2i(Math.floor(point.x + Board.SIZE * 0.5), Math.floor(point.z + Board.SIZE * 0.5));
  }

  _ready() {
    const tileMesh = Arena.tile_mesh();
    const quad = planeMesh(new Vector2(TILE_SIZE, TILE_SIZE));
    for (let y = 0; y < Board.SIZE; y++) {
      for (let x = 0; x < Board.SIZE; x++) {
        const cell = new Vector2i(x, y);
        const light = (x + y) % 2 === 0;
        const tile = new MeshInstance3D(`Tile_${x}_${y}`);
        tile.mesh = tileMesh;
        tile.position = BoardView.cell_to_world(cell, TILE_TOP - TILE_HEIGHT * 0.5);
        const material = new SpatialMaterial(TILE_SHADER, {
          base_color: light ? Palette.TILE_LIGHT : Palette.TILE_DARK,
          roughness_base: light ? 0.78 : 0.62,
          variation: fposmod(Math.sin((x * 13 + y * 7) * 12.9898) * 43758.5453, 1.0),
          tile_state: 0,
        });
        tile.material_override = material;
        this.add_child(tile);
        this._tile_materials.set(cell, material);
        this._marks.set(cell, this._overlay(quad, cell, 0.004, (x * 7 + y * 3) * 0.37));
        this._cursors.set(cell, this._overlay(quad, cell, 0.007, 0.0));
      }
    }
    this._arc_mesh = new MeshInstance3D('Arc');
    this._arc_mesh.cast_shadow = false;
    this._arc_material = new SpatialMaterial(ROUTE_SHADER);
    this._arc_mesh.material_override = this._arc_material;
    this._arc_mesh.visible = false;
    this.add_child(this._arc_mesh);
  }

  _overlay(quad, cell, lift, phase) {
    const node = new MeshInstance3D();
    node.mesh = quad;
    node.position = BoardView.cell_to_world(cell, TILE_TOP + lift);
    node.cast_shadow = false;
    const material = new SpatialMaterial(HIGHLIGHT_SHADER, { mode: Mark.NONE, phase });
    node.material_override = material;
    this.add_child(node);
    return material;
  }

  /** Board cell under a ray (intersected with the tile tops), or (-1, -1). */
  cell_from_ray(origin, direction) {
    if (Math.abs(direction.y) < 0.0001) return new Vector2i(-1, -1);
    const distance = (TILE_TOP - origin.y) / direction.y;
    if (distance < 0.0) return new Vector2i(-1, -1);
    const cell = BoardView.world_to_cell(origin.add(direction.mul(distance)));
    return Board.in_bounds(cell) ? cell : new Vector2i(-1, -1);
  }

  show_terrain(board) {
    for (const [cell, material] of this._tile_materials.entries()) material.set_shader_parameter('tile_state', STATE_INDEX[board.tile(cell)]);
  }

  clear_marks() {
    for (const material of this._marks.values()) material.set_shader_parameter('mode', Mark.NONE);
  }

  mark(cell, mode, color, strength = 1.0) {
    const material = this._marks.get(cell);
    const contrast = Boolean(Settings.get_value('high_contrast'));
    material.set_shader_parameter('mode', mode);
    material.set_shader_parameter('color', color);
    material.set_shader_parameter('accent', Palette.THREAT);
    material.set_shader_parameter('strength', strength * (contrast ? 1.35 : 1.0));
    material.set_shader_parameter('glow', contrast ? 2.1 : 1.6);
  }

  set_cursor(cell, mode, color) {
    this.clear_cursor();
    if (Board.in_bounds(cell)) {
      const material = this._cursors.get(cell);
      material.set_shader_parameter('mode', mode);
      material.set_shader_parameter('color', color);
      material.set_shader_parameter('strength', 1.0);
    }
  }

  clear_cursor() {
    for (const material of this._cursors.values()) material.set_shader_parameter('mode', Mark.NONE);
  }

  /** The dashed ribbon from a piece to the hovered destination (a high arc for jumps). */
  show_arc(from, to, jump, color) {
    const start = BoardView.cell_to_world(from, TILE_TOP + 0.03);
    const end = BoardView.cell_to_world(to, TILE_TOP + 0.03);
    const height = jump ? 0.7 : 0.18;
    const samples = 18;
    const points = [];
    for (let s = 0; s <= samples; s++) {
      const t = s / samples;
      const point = start.lerp(end, t);
      points.push(new Vector3(point.x, point.y + Math.sin(Math.PI * t) * height, point.z));
    }
    this._arc_mesh.setOwnedMesh(MeshKit.ribbon(points, 0.12));
    this._arc_material.set_shader_parameter('color', color);
    this._arc_mesh.visible = true;
  }

  hide_arc() {
    this._arc_mesh.visible = false;
  }

  pulse_tile(cell, color, strength = 0.55, duration = 0.6) {
    const material = this._tile_materials.get(cell);
    const previous = this._tint_tweens.get(cell);
    if (previous && previous.is_valid()) previous.kill();
    material.set_shader_parameter('tint_color', color);
    const tween = this.create_tween();
    tween.tween_method((v) => material.set_shader_parameter('tint_strength', v), strength, 0.0, duration).set_ease(EASE.OUT);
    this._tint_tweens.set(cell, tween);
  }
}
