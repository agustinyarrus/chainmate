/**
 * ArenaProps — port of scripts/presentation/arena_props.gd: banners, cloths, runners, lanterns,
 * candles, candelabra, books, crates and the leaf instances, with their shared materials.
 */
import { Vector2, Vector3, Color, Basis, Transform3D, TAU, PI } from '../godot/math.js';
import { randf } from '../godot/rng.js';
import { Node3D, MeshInstance3D, OmniLight3D, MultiMeshInstance3D } from '../godot/node3d.js';
import { SpatialMaterial, StandardMaterial3D } from '../godot/render/material.js';
import { SurfaceTool, boxMesh, cylinderMesh, sphereMesh, torusMesh, quadMesh } from '../godot/render/primitives.js';
import { CLOTH_SHADER, FLAME_SHADER, FOLIAGE_SHADER, WOOD_SHADER } from './shaders.js';

const V3 = (x, y, z) => new Vector3(x, y, z);
const FLAME_COLOR = new Color(1.0, 0.62, 0.3);
const materials = new Map();

export class ArenaProps {
  static FLAME_COLOR = FLAME_COLOR;

  static standard(key, albedo, roughness, metallic = 0.0) {
    if (!materials.has(key)) materials.set(key, new StandardMaterial3D({ albedo_color: albedo, roughness, metallic }));
    return materials.get(key);
  }

  static iron() {
    return ArenaProps.standard('iron', new Color(0.11, 0.1, 0.1), 0.48, 0.75);
  }

  static gold() {
    return ArenaProps.standard('gold', new Color(0.86, 0.62, 0.28), 0.32, 1.0);
  }

  /** Candle wax: rim light (Forward+ also adds screen-space subsurface scattering, not reproduced). */
  static wax() {
    if (!materials.has('wax')) {
      materials.set('wax', new StandardMaterial3D({ albedo_color: new Color(0.93, 0.86, 0.7), roughness: 0.55, rim_enabled: true, rim: 0.3 }));
    }
    return materials.get('wax');
  }

  static pages() {
    return ArenaProps.standard('pages', new Color(0.86, 0.8, 0.66), 0.9);
  }

  static leather(color) {
    return ArenaProps.standard(`leather_${color.to_html()}`, color, 0.62);
  }

  static glass() {
    if (!materials.has('glass')) {
      materials.set('glass', new StandardMaterial3D({
        albedo_color: new Color(1.0, 0.78, 0.45, 0.42),
        roughness: 0.15,
        transparency: 'alpha',
        emission_enabled: true,
        emission: new Color(1.0, 0.6, 0.28),
        emission_energy_multiplier: 1.6,
        cull_mode: 'disabled',
      }));
    }
    return materials.get('glass');
  }

  static cloth(base, trim, emblem, swallowtail, wave) {
    return new SpatialMaterial(CLOTH_SHADER, { base_color: base, trim_color: trim, emblem, swallowtail, wave, phase: randf() * 10.0 });
  }

  static wood(halfSize, planks, framed) {
    return new SpatialMaterial(WOOD_SHADER, { half_size: halfSize, planks, framed });
  }

  static part(parent, mesh, material, at, rotation = Vector3.ZERO) {
    const node = new MeshInstance3D();
    node.mesh = mesh;
    node.material_override = material;
    node.position = at;
    node.rotation = rotation;
    parent.add_child(node);
    return node;
  }

  static box_mesh(size) {
    return boxMesh(size);
  }

  static cylinder_mesh(top, bottom, height, segments = 12) {
    return cylinderMesh(top, bottom, height, segments, 1);
  }

  /** A candle/lantern flame billboard plus its flickering omni light. */
  static flame(parent, at, size, energy, reach) {
    const node = new MeshInstance3D();
    node.mesh = quadMesh(new Vector2(size * 0.55, size), V3(0, size * 0.5, 0));
    node.material_override = new SpatialMaterial(FLAME_SHADER, { seed: randf() * 20.0 });
    node.cast_shadow = false;
    node.position = at;
    parent.add_child(node);
    const light = new OmniLight3D();
    light.position = at.add(V3(0, size * 0.6, 0));
    light.light_color = FLAME_COLOR;
    light.light_energy = energy;
    light.omni_range = reach;
    light.omni_attenuation = 1.6;
    light.shadow_enabled = false;
    light.light_volumetric_fog_energy = 0.6;
    parent.add_child(light);
    return light;
  }

  /** Grid sheet hanging from its top edge: UV.y = 0 at the rod, 1 at the free edge. */
  static _hanging_sheet(width, height, columns, rows) {
    const st = new SurfaceTool();
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < columns; i++) {
        const corners = [new Vector2(i, j), new Vector2(i + 1, j), new Vector2(i + 1, j + 1), new Vector2(i, j + 1)];
        for (const index of [0, 1, 2, 0, 2, 3]) {
          const c = corners[index];
          const uv = new Vector2(c.x / columns, c.y / rows);
          st.set_normal(Vector3.BACK);
          st.set_uv(uv);
          st.add_vertex(V3((uv.x - 0.5) * width, -uv.y * height, 0.0));
        }
      }
    }
    return st.commit();
  }

  static banner(height, base, trim) {
    const root = new Node3D('Banner');
    ArenaProps.part(root, ArenaProps.cylinder_mesh(0.03, 0.036, height, 8), ArenaProps.iron(), V3(0, height * 0.5, 0));
    ArenaProps.part(root, ArenaProps.cylinder_mesh(0.07, 0.085, 0.07, 8), ArenaProps.iron(), V3(0, 0.035, 0));
    ArenaProps.part(root, sphereMesh(0.045, 0.09), ArenaProps.gold(), V3(0, height + 0.04, 0));
    ArenaProps.part(root, ArenaProps.cylinder_mesh(0.0, 0.026, 0.12, 6), ArenaProps.gold(), V3(0, height + 0.13, 0));
    const barY = height - 0.08;
    ArenaProps.part(root, ArenaProps.cylinder_mesh(0.016, 0.016, 0.72, 6), ArenaProps.iron(), V3(0, barY, 0.03), V3(0, 0, PI * 0.5));
    for (const side of [-1.0, 1.0]) ArenaProps.part(root, sphereMesh(0.028, 0.056), ArenaProps.gold(), V3(side * 0.36, barY, 0.03));
    const sheet = new MeshInstance3D();
    sheet.mesh = ArenaProps._hanging_sheet(0.64, height * 0.62, 6, 16);
    sheet.material_override = ArenaProps.cloth(base, trim, true, true, 1.0);
    sheet.position = V3(0, barY - 0.015, 0.035);
    root.add_child(sheet);
    return root;
  }

  static hanging_cloth(width, height, base, trim, emblem) {
    const sheet = new MeshInstance3D();
    sheet.mesh = ArenaProps._hanging_sheet(width, height, 5, 12);
    sheet.material_override = ArenaProps.cloth(base, trim, emblem, true, 0.35);
    return sheet;
  }

  /** A cloth runner draped along `path` (e.g. over a wall top and down its face). */
  static runner(path, across, width, base, trim) {
    const st = new SurfaceTool();
    const lengths = [0.0];
    for (let i = 1; i < path.length; i++) lengths.push(Math.fround(lengths[i - 1] + path[i].distance_to(path[i - 1])));
    const total = lengths[lengths.length - 1];
    const half = across.normalized().mul(width).mul(0.5);
    for (let i = 0; i < path.length - 1; i++) {
      const a0 = path[i].sub(half);
      const a1 = path[i].add(half);
      const b0 = path[i + 1].sub(half);
      const b1 = path[i + 1].add(half);
      const v0 = lengths[i] / total;
      const v1 = lengths[i + 1] / total;
      const normal = b0.sub(a0).cross(a1.sub(a0)).normalized();
      for (const [vertex, uv] of [[a0, new Vector2(0, v0)], [a1, new Vector2(1, v0)], [b1, new Vector2(1, v1)], [a0, new Vector2(0, v0)], [b1, new Vector2(1, v1)], [b0, new Vector2(0, v1)]]) {
        st.set_normal(normal);
        st.set_uv(uv);
        st.add_vertex(vertex);
      }
    }
    const node = new MeshInstance3D();
    node.mesh = st.commit();
    const material = ArenaProps.cloth(base, trim, false, false, 0.0);
    material.set_shader_parameter('trim_width', 0.1);
    node.material_override = material;
    return node;
  }

  static lantern() {
    const root = new Node3D('Lantern');
    const body = new Node3D();
    body.scale = Vector3.ONE.mul(1.6);
    root.add_child(body);
    const w = 0.2;
    ArenaProps.part(body, boxMesh(V3(w + 0.03, 0.035, w + 0.03)), ArenaProps.iron(), V3(0, 0.0175, 0));
    ArenaProps.part(body, boxMesh(V3(w + 0.02, 0.03, w + 0.02)), ArenaProps.iron(), V3(0, 0.3, 0));
    for (const x of [-1.0, 1.0]) {
      for (const z of [-1.0, 1.0]) ArenaProps.part(body, boxMesh(V3(0.022, 0.29, 0.022)), ArenaProps.iron(), V3(x * w * 0.5, 0.16, z * w * 0.5));
    }
    ArenaProps.part(body, boxMesh(V3(w - 0.01, 0.26, w - 0.01)), ArenaProps.glass(), V3(0, 0.165, 0));
    ArenaProps.part(body, ArenaProps.cylinder_mesh(0.018, w * 0.78, 0.12, 4), ArenaProps.iron(), V3(0, 0.375, 0), V3(0, PI * 0.25, 0));
    ArenaProps.part(body, torusMesh(0.028, 0.042), ArenaProps.iron(), V3(0, 0.46, 0), V3(PI * 0.5, 0, 0));
    ArenaProps.part(body, ArenaProps.cylinder_mesh(0.028, 0.03, 0.08, 10), ArenaProps.wax(), V3(0, 0.075, 0));
    const light = ArenaProps.flame(root, V3(0, 0.19, 0), 0.13, 2.4, 3.6);
    return { node: root, lights: [light] };
  }

  static candle(height, lit = true) {
    const root = new Node3D('Candle');
    ArenaProps.part(root, ArenaProps.cylinder_mesh(0.042, 0.046, height, 12), ArenaProps.wax(), V3(0, height * 0.5, 0));
    ArenaProps.part(root, ArenaProps.cylinder_mesh(0.052, 0.058, 0.014, 12), ArenaProps.wax(), V3(0, 0.007, 0));
    ArenaProps.part(root, ArenaProps.cylinder_mesh(0.003, 0.003, 0.025, 4), ArenaProps.iron(), V3(0, height + 0.012, 0));
    const lights = [];
    const light = ArenaProps.flame(root, V3(0, height + 0.012, 0), 0.085, 0.8, 2.0);
    if (lit) {
      lights.push(light);
    } else {
      // The unlit candle's flame quad stays (as in the original); only the light goes.
      light.queue_free();
    }
    return { node: root, lights };
  }

  static candles(rng) {
    const root = new Node3D('Candles');
    const lights = [];
    const n = rng.randi_range(2, 3);
    for (let i = 0; i < n; i++) {
      const lit = ArenaProps.candle(rng.randf_range(0.1, 0.24), i === 0);
      const angle = (TAU * i) / n + rng.randf_range(-0.3, 0.3);
      lit.node.position = V3(Math.cos(angle), 0, Math.sin(angle)).mul(i > 0 ? 0.07 : 0.0);
      root.add_child(lit.node);
      lights.push(...lit.lights);
    }
    return { node: root, lights };
  }

  static candelabra() {
    const root = new Node3D('Candelabra');
    ArenaProps.part(root, ArenaProps.cylinder_mesh(0.05, 0.1, 0.05, 12), ArenaProps.gold(), V3(0, 0.025, 0));
    ArenaProps.part(root, ArenaProps.cylinder_mesh(0.016, 0.022, 0.42, 8), ArenaProps.gold(), V3(0, 0.26, 0));
    ArenaProps.part(root, ArenaProps.cylinder_mesh(0.012, 0.012, 0.3, 6), ArenaProps.gold(), V3(0, 0.42, 0), V3(0, 0, PI * 0.5));
    const lights = [];
    for (const x of [-0.15, 0.0, 0.15]) {
      const centre = x === 0.0;
      const cup = centre ? 0.47 : 0.42;
      ArenaProps.part(root, ArenaProps.cylinder_mesh(0.035, 0.018, 0.04, 10), ArenaProps.gold(), V3(x, cup, 0));
      const lit = ArenaProps.candle(centre ? 0.16 : 0.12, centre);
      lit.node.position = V3(x, cup + 0.02, 0);
      root.add_child(lit.node);
      for (const light of lit.lights) {
        light.light_energy = 1.8;
        light.omni_range = 3.0;
        lights.push(light);
      }
    }
    return { node: root, lights };
  }

  static books(rng) {
    const root = new Node3D('Books');
    const covers = [new Color(0.45, 0.08, 0.07), new Color(0.3, 0.16, 0.08), new Color(0.12, 0.2, 0.14), new Color(0.38, 0.1, 0.12)];
    let y = 0.0;
    const n = rng.randi_range(2, 3);
    for (let i = 0; i < n; i++) {
      const sx = rng.randf_range(0.3, 0.38);
      const sy = rng.randf_range(0.07, 0.1);
      const sz = rng.randf_range(0.22, 0.28);
      const size = V3(sx, sy, sz);
      const book = new Node3D('Book');
      const px = rng.randf_range(-0.02, 0.02);
      const pz = rng.randf_range(-0.02, 0.02);
      book.position = V3(px, y, pz);
      book.rotation = V3(0, rng.randf_range(-0.35, 0.35), 0);
      root.add_child(book);
      const cover = covers[rng.randi_range(0, covers.length - 1)];
      ArenaProps.part(book, boxMesh(V3(size.x, 0.016, size.z)), ArenaProps.leather(cover), V3(0, 0.008, 0));
      ArenaProps.part(book, boxMesh(V3(size.x, 0.016, size.z)), ArenaProps.leather(cover), V3(0, size.y - 0.008, 0));
      ArenaProps.part(book, boxMesh(V3(0.02, size.y, size.z)), ArenaProps.leather(cover), V3(-size.x * 0.5 + 0.01, size.y * 0.5, 0));
      ArenaProps.part(book, boxMesh(V3(size.x - 0.028, size.y - 0.03, size.z - 0.02)), ArenaProps.pages(), V3(0.008, size.y * 0.5, 0));
      ArenaProps.part(book, boxMesh(V3(0.022, size.y * 0.7, 0.016)), ArenaProps.gold(), V3(-size.x * 0.5 + 0.006, size.y * 0.5, size.z * 0.3));
      y += size.y;
    }
    return root;
  }

  static crate(size) {
    const root = new Node3D('Crate');
    ArenaProps.part(root, boxMesh(Vector3.ONE.mul(size)), ArenaProps.wood(Vector3.ONE.mul(size * 0.5), 4.0, true), V3(0, size * 0.5, 0));
    return root;
  }

  /** One MultiMesh of leaf cards (QuadMesh hanging below its origin) for one leaf shape. */
  static foliage(entries, shape) {
    const quad = quadMesh(new Vector2(1, 1), V3(0, -0.5, 0));
    const material = new SpatialMaterial(FOLIAGE_SHADER, { shape });
    return new MultiMeshInstance3D(quad, material, entries.map((e) => e[0]), entries.map((e) => e[1]));
  }

  static leaf(rng, at, facing, size, color, sway) {
    let basis = Basis.looking_at(facing.normalized().neg(), Vector3.UP);
    const roll = rng.randf_range(-0.9, 0.9);
    basis = basis.mul(Basis.from_axis_angle(Vector3.FORWARD, roll));
    const pitch = rng.randf_range(-0.5, 0.3);
    basis = basis.mul(Basis.from_axis_angle(Vector3.RIGHT, pitch));
    basis = basis.scaled(Vector3.ONE.mul(size));
    return [new Transform3D(basis, at), new Color(color, sway)];
  }

  static fallen_leaf(rng, at, size, color) {
    const yaw = rng.randf_range(0.0, TAU);
    let basis = Basis.from_axis_angle(Vector3.UP, yaw);
    const tilt = -PI * 0.5 + rng.randf_range(-0.2, 0.2);
    basis = basis.mul(Basis.from_axis_angle(Vector3.RIGHT, tilt));
    basis = basis.scaled(Vector3.ONE.mul(size));
    return [new Transform3D(basis, at.add(V3(0, 0.004, 0))), new Color(color, 0.0)];
  }
}
