/**
 * RelicModels — port of scripts/presentation/relic_models.gd: the eighteen relic miniatures and the
 * rarity dais they stand on, built from primitives, extruded outlines (`_slab`) and swept tubes
 * (`_tube`) exactly as the original lays them out. Primitive meshes are memoised by their parameters
 * (the original makes a fresh identical mesh per part — same pixels, more memory).
 */
import * as THREE from 'three';
import { Vector2, Vector3, Color, Basis, Quaternion, PI, TAU, lerpf, deg_to_rad } from '../godot/math.js';
import { RandomNumberGenerator, hashString } from '../godot/rng.js';
import { Node3D } from '../godot/node3d.js';
import { StandardMaterial3D } from '../godot/render/material.js';
import { SurfaceTool, sphereMesh, torusMesh } from '../godot/render/primitives.js';
import { Relics } from '../core/relics.js';
import { ArenaProps } from './arena_props.js';
import { PieceMeshes } from './piece_meshes.js';

export const DAIS_TOP = 0.08;
const V3 = (x, y, z) => new Vector3(x, y, z);
const V2 = (x, y) => new Vector2(x, y);
const ROT_ZERO = Vector3.ZERO;

const meshCache = new Map();
const cached = (key, build) => {
  let mesh = meshCache.get(key);
  if (!mesh) {
    mesh = build();
    meshCache.set(key, mesh);
  }
  return mesh;
};
const lensCache = { material: null };

/** SurfaceTool wrapper whose triangles always face along their vertex normals (relic_models.gd _Geo). */
class Geo {
  constructor() {
    this.st = new SurfaceTool();
  }

  tri(a, b, c, na, nb, nc, ca, cb, cc) {
    const face = b.sub(a).cross(c.sub(a));
    if (face.length_squared() < 1e-14) return;
    const corners = face.dot(na.add(nb).add(nc)) > 0.0 ? [[a, na, ca], [c, nc, cc], [b, nb, cb]] : [[a, na, ca], [b, nb, cb], [c, nc, cc]];
    for (const [v, n, color] of corners) {
      this.st.set_color(color);
      this.st.set_normal(n);
      this.st.add_vertex(v);
    }
  }

  flat(a, b, c, n, color = Color.WHITE) {
    this.tri(a, b, c, n, n, n, color, color, color);
  }

  commit() {
    return this.st.commit();
  }
}

export class RelicModels {
  static DAIS_TOP = DAIS_TOP;

  static build(id) {
    if (!Relics.exists(id)) throw new Error(`Unknown relic: ${id}`);
    const root = new Node3D('Model');
    const builder = RelicModels[`_${id}`];
    if (!builder) throw new Error(`No model for relic ${id}`);
    builder(root);
    return root;
  }

  static dais(rarity) {
    const metals = { common: ArenaProps.iron(), uncommon: RelicModels.silver(), rare: ArenaProps.gold() };
    if (!(rarity in metals)) throw new Error(`Unknown rarity: ${rarity}`);
    const root = new Node3D('Dais');
    const turn = V3(0, PI / 8.0, 0);
    RelicModels._part(root, RelicModels._cyl(0.175, 0.19, 0.036, 8), RelicModels._slate(), V3(0, 0.018, 0), turn);
    RelicModels._part(root, RelicModels._cyl(0.172, 0.172, 0.02, 8), metals[rarity], V3(0, 0.046, 0), turn);
    RelicModels._part(root, RelicModels._cyl(0.155, 0.165, 0.024, 8), RelicModels._slate(), V3(0, 0.068, 0), turn);
    return root;
  }

  // ─────────────────────────────────────────────────────────────── materials ─────────────────────

  static _mat(key, albedo, roughness, metallic = 0.0) {
    return ArenaProps.standard(`relic_${key}`, albedo, roughness, metallic);
  }
  static silver() { return RelicModels._mat('silver', new Color(0.8, 0.8, 0.83), 0.24, 1.0); }
  static _slate() { return RelicModels._mat('slate', new Color(0.2, 0.2, 0.23), 0.55); }
  static _keep_stone() { return RelicModels._mat('keep_stone', new Color(0.6, 0.56, 0.5), 0.9); }
  static _ivory() { return RelicModels._mat('ivory', new Color(0.86, 0.78, 0.63), 0.42); }
  static _obsidian() { return RelicModels._mat('obsidian', new Color(0.07, 0.068, 0.08), 0.2); }
  static _crimson() { return RelicModels._mat('crimson', new Color(0.56, 0.05, 0.05), 0.6); }
  static _crimson_dark() { return RelicModels._mat('crimson_dark', new Color(0.34, 0.03, 0.04), 0.65); }
  static _sealing_wax() { return RelicModels._mat('sealing_wax', new Color(0.62, 0.06, 0.04), 0.3); }
  static _porcelain() { return RelicModels._mat('porcelain', new Color(0.94, 0.92, 0.88), 0.18); }
  static _lacquer() { return RelicModels._mat('lacquer', new Color(0.1, 0.06, 0.045), 0.28); }
  static _ink() { return RelicModels._mat('ink', new Color(0.015, 0.015, 0.02), 0.08); }
  static _sepia() { return RelicModels._mat('sepia', new Color(0.3, 0.17, 0.08), 0.8); }
  static _wood() { return RelicModels._mat('wood', new Color(0.36, 0.2, 0.1), 0.66); }
  static _parchment() { return RelicModels._mat('parchment', new Color(0.84, 0.72, 0.5), 0.85); }
  static _card() { return RelicModels._mat('card', new Color(0.9, 0.84, 0.7), 0.6); }
  static _salt() { return RelicModels._mat('salt', new Color(0.96, 0.96, 0.94), 0.35); }
  static _feather() { return RelicModels._mat('feather', new Color(0.93, 0.9, 0.84), 0.75); }
  static _white() { return RelicModels._mat('white', new Color(0.92, 0.9, 0.86), 0.6); }
  static _velvet(color) { return RelicModels._mat(`velvet_${color.to_html()}`, color, 0.95); }
  static _dark_glass() { return RelicModels._mat('dark_glass', new Color(0.05, 0.08, 0.12), 0.05, 0.3); }

  /** The magnifier lens: faint blue glass, alpha blended, both faces, full specular. */
  static _lens() {
    lensCache.material ??= new StandardMaterial3D({
      albedo_color: new Color(0.8, 0.9, 1.0, 0.2),
      roughness: 0.03,
      transparency: 'alpha',
      emission_enabled: true,
      emission: Color.BLACK,
      cull_mode: 'disabled',
      metallic_specular: 1.0,
    });
    return lensCache.material;
  }

  static _jewel(key, color) {
    return RelicModels._mat(key, color, 0.18);
  }

  // ─────────────────────────────────────────────────────────────── builders ──────────────────────

  static _part(parent, mesh, material, at, rotation = ROT_ZERO, scale = Vector3.ONE) {
    const node = ArenaProps.part(parent, mesh, material, at, rotation);
    node.scale = scale;
    return node;
  }

  static _group(parent, at, rotation = ROT_ZERO, scale = 1.0) {
    const node = new Node3D();
    node.position = at;
    node.rotation = rotation;
    node.scale = Vector3.ONE.mul(scale);
    parent.add_child(node);
    return node;
  }

  static _box(size) {
    return cached(`box|${size.x}|${size.y}|${size.z}`, () => ArenaProps.box_mesh(size));
  }

  static _cyl(top, bottom, height, segments = 16) {
    return cached(`cyl|${top}|${bottom}|${height}|${segments}`, () => ArenaProps.cylinder_mesh(top, bottom, height, segments));
  }

  static _sphere(radius, segments = 16) {
    return cached(`sphere|${radius}|${segments}`, () => sphereMesh(radius, radius * 2.0, segments, Math.max(4, Math.trunc(segments / 2))));
  }

  static _torus(radius, thickness, rings = 24) {
    return cached(`torus|${radius}|${thickness}|${rings}`, () => torusMesh(radius - thickness, radius + thickness, rings, 8));
  }

  /** A level-0 piece mesh scaled to `height` (and flattened in z for reliefs). */
  static _piece(parent, kind, material, at, height, rotation = ROT_ZERO, flatten = 1.0) {
    const s = height / PieceMeshes.height(kind);
    return RelicModels._part(parent, PieceMeshes.get_mesh(kind, 0), material, at, rotation, V3(s, s, s * flatten));
  }

  /** A hairline ink stroke on a flat sheet, from a to b. */
  static _strip(parent, a, b, width, material) {
    const delta = b.sub(a);
    const length = V2(delta.x, delta.z).length();
    RelicModels._part(parent, RelicModels._box(V3(length, 0.0014, width)), material, a.add(b).mul(0.5), V3(0, Math.atan2(-delta.z, delta.x), 0));
  }

  static _rng(key) {
    const rng = new RandomNumberGenerator();
    rng.seed = hashString(`relic-${key}`);
    return rng;
  }

  /** A polygon extruded to `depth` along Z (caps from a triangulation, sides facing outward). */
  static _slab(outline, depth) {
    const geo = new Geo();
    const h = depth * 0.5;
    const triangles = THREE.ShapeUtils.triangulateShape(outline.map((p) => new THREE.Vector2(p.x, p.y)), []);
    if (triangles.length === 0) throw new Error('relic outline does not triangulate');
    for (const [ia, ib, ic] of triangles) {
      const a = outline[ia];
      const b = outline[ib];
      const c = outline[ic];
      for (const side of [1.0, -1.0]) geo.flat(V3(a.x, a.y, h * side), V3(b.x, b.y, h * side), V3(c.x, c.y, h * side), V3(0, 0, side));
    }
    let area = 0.0;
    const count = outline.length;
    for (let i = 0; i < count; i++) {
      const p = outline[i];
      const q = outline[(i + 1) % count];
      area += p.x * q.y - q.x * p.y;
    }
    for (let i = 0; i < count; i++) {
      const p = outline[i];
      const q = outline[(i + 1) % count];
      const edge = q.sub(p);
      const out = V2(edge.y, -edge.x).normalized().mul(Math.sign(area));
      const n = V3(out.x, out.y, 0.0);
      geo.flat(V3(p.x, p.y, h), V3(q.x, q.y, h), V3(q.x, q.y, -h), n);
      geo.flat(V3(p.x, p.y, h), V3(q.x, q.y, -h), V3(p.x, p.y, -h), n);
    }
    return geo.commit();
  }

  /** A tube swept along `path` with a parallel-transported frame, capped at both ends. */
  static _tube(path, radii, colors, sides = 10) {
    const count = path.length;
    if (count < 2 || radii.length !== count || colors.length !== count) throw new Error('tube needs matching points, radii and colours');
    const geo = new Geo();
    const rings = [];
    const normals = [];
    let normal = Vector3.ZERO;
    for (let i = 0; i < count; i++) {
      const tangent = path[Math.min(i + 1, count - 1)].sub(path[Math.max(i - 1, 0)]).normalized();
      if (i === 0) normal = tangent.cross(Math.abs(tangent.z) < 0.9 ? Vector3.FORWARD : Vector3.RIGHT).normalized();
      else normal = normal.sub(tangent.mul(tangent.dot(normal))).normalized();
      const binormal = tangent.cross(normal);
      const ring = [];
      const ringNormals = [];
      for (let k = 0; k < sides; k++) {
        const angle = (TAU * k) / sides;
        const direction = normal.mul(Math.cos(angle)).add(binormal.mul(Math.sin(angle)));
        ring.push(path[i].add(direction.mul(radii[i])));
        ringNormals.push(direction);
      }
      rings.push(ring);
      normals.push(ringNormals);
    }
    for (let i = 0; i < count - 1; i++) {
      for (let k = 0; k < sides; k++) {
        const k2 = (k + 1) % sides;
        geo.tri(rings[i][k], rings[i][k2], rings[i + 1][k2], normals[i][k], normals[i][k2], normals[i + 1][k2], colors[i], colors[i], colors[i + 1]);
        geo.tri(rings[i][k], rings[i + 1][k2], rings[i + 1][k], normals[i][k], normals[i + 1][k2], normals[i + 1][k], colors[i], colors[i + 1], colors[i + 1]);
      }
    }
    const startOut = path[0].sub(path[1]).normalized();
    const endOut = path[count - 1].sub(path[count - 2]).normalized();
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      geo.flat(path[0], rings[0][k], rings[0][k2], startOut, colors[0]);
      geo.flat(path[count - 1], rings[count - 1][k], rings[count - 1][k2], endOut, colors[count - 1]);
    }
    return geo.commit();
  }

  static _rod(parent, a, b, radius, material) {
    const colors = [Color.WHITE, Color.WHITE];
    RelicModels._part(parent, RelicModels._tube([a, b], [radius, radius], colors, 8), material, Vector3.ZERO);
  }

  static _leaf_outline(length, width, steps = 6) {
    const points = [];
    for (let i = 0; i < steps + 1; i++) {
      const t = i / steps;
      points.push(V2(Math.sin(PI * t) * width * 0.5 * (1.0 - t * 0.3), t * length));
    }
    for (let i = steps - 1; i > 0; i--) {
      const t = i / steps;
      points.push(V2(-Math.sin(PI * t) * width * 0.5 * (1.0 - t * 0.3), t * length));
    }
    return points;
  }

  static _star_outline(points, outer, inner) {
    const out = [];
    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? outer : inner;
      const angle = PI * 0.5 + (PI * i) / points;
      out.push(V2(Math.cos(angle), Math.sin(angle)).mul(radius));
    }
    return out;
  }

  static _tail_outline(width, length, notch) {
    const w = width * 0.5;
    return [V2(-w, 0), V2(w, 0), V2(w, -length), V2(0, -length + notch), V2(-w, -length)];
  }

  static _shield_outline(width, height) {
    const w = width * 0.5;
    const shoulder = height * 0.1;
    const points = [V2(-w, height * 0.5), V2(w, height * 0.5)];
    for (let i = 0; i < 7; i++) {
      const angle = (PI * 0.5 * i) / 6.0;
      points.push(V2(w * Math.cos(angle), shoulder - height * 0.6 * Math.sin(angle)));
    }
    for (let i = 5; i > -1; i--) {
      const angle = (PI * 0.5 * i) / 6.0;
      points.push(V2(-w * Math.cos(angle), shoulder - height * 0.6 * Math.sin(angle)));
    }
    return points;
  }

  static _face_disc(parent, radius, thickness, material, at, segments = 24) {
    RelicModels._part(parent, RelicModels._cyl(radius, radius, thickness, segments), material, at, V3(PI * 0.5, 0, 0));
  }

  static _face_ring(parent, radius, thickness, material, at) {
    RelicModels._part(parent, RelicModels._torus(radius, thickness, 32), material, at, V3(PI * 0.5, 0, 0));
  }

  // ─────────────────────────────────────────────────────────────── the relics ────────────────────

  static _desperado_ribbon(root) {
    const M = RelicModels;
    M._part(root, M._cyl(0.035, 0.045, 0.016, 12), ArenaProps.iron(), V3(0, 0.008, -0.04));
    M._rod(root, V3(0, 0.0, -0.04), V3(0, 0.25, -0.03), 0.007, ArenaProps.iron());
    const rosette = M._group(root, V3(0, 0.25, -0.012), V3(-0.45, 0, 0));
    for (const side of [-1.0, 1.0]) {
      M._part(rosette, M._slab(M._tail_outline(0.05, 0.21, 0.026), 0.006), M._crimson(), V3(side * 0.022, -0.02, -0.014), V3(0, 0, side * 0.3));
    }
    const outer = M._slab([V2(-0.014, 0.036), V2(0.014, 0.036), V2(0.026, 0.1), V2(-0.026, 0.1)], 0.006);
    const inner = M._slab([V2(-0.011, 0.03), V2(0.011, 0.03), V2(0.018, 0.064), V2(-0.018, 0.064)], 0.005);
    for (let i = 0; i < 16; i++) {
      const angle = (TAU * i) / 16.0;
      const lifted = 0.005 * (i % 2);
      M._part(rosette, outer, i % 2 === 0 ? M._crimson() : M._crimson_dark(), V3(0, 0, lifted), V3(0, 0, angle));
      M._part(rosette, inner, M._white(), V3(0, 0, 0.008 + lifted * 0.6), V3(0, 0, angle + PI / 16.0));
    }
    M._face_disc(rosette, 0.036, 0.014, ArenaProps.gold(), V3(0, 0, 0.016));
    M._face_ring(rosette, 0.034, 0.004, ArenaProps.gold(), V3(0, 0, 0.023));
    M._part(rosette, M._slab(M._star_outline(5, 0.022, 0.009), 0.005), ArenaProps.gold(), V3(0, 0, 0.025));
  }

  static _kibitzers_whisper(root) {
    const M = RelicModels;
    const gold = ArenaProps.gold();
    M._part(root, M._cyl(0.05, 0.075, 0.022, 20), gold, V3(0, 0.011, 0));
    M._part(root, M._cyl(0.012, 0.018, 0.13, 10), gold, V3(0, 0.085, 0));
    M._part(root, M._sphere(0.02), gold, V3(0, 0.1, 0));
    M._part(root, M._cyl(0.045, 0.02, 0.03, 16), gold, V3(0, 0.165, 0));
    const eye = M._group(root, V3(0, 0.245, 0), V3(-0.55, 0, 0));
    M._part(eye, M._sphere(0.085, 24), M._porcelain(), Vector3.ZERO);
    M._part(eye, M._sphere(0.042, 20), M._jewel('iris', new Color(0.3, 0.58, 1.0)), V3(0, 0, 0.07), ROT_ZERO, V3(1, 1, 0.45));
    M._part(eye, M._sphere(0.02, 12), M._ink(), V3(0, 0, 0.085), ROT_ZERO, V3(1, 1, 0.4));
    M._face_ring(eye, 0.093, 0.007, gold, Vector3.ZERO);
    for (const side of [-1.0, 1.0]) M._part(eye, M._sphere(0.012), gold, V3(side * 0.093, 0, 0));
  }

  static _appearance_fee(root) {
    const M = RelicModels;
    const rng = M._rng('appearance_fee');
    const gold = ArenaProps.gold();
    const coin = M._cyl(0.046, 0.046, 0.012, 24);
    for (const [base, height] of [[V2(-0.075, -0.05), 7], [V2(0.005, -0.08), 4], [V2(0.08, 0.04), 2]]) {
      for (let i = 0; i < height; i++) {
        const at = V3(base.x + rng.randf_range(-0.004, 0.004), 0.006 + i * 0.0125, base.y + rng.randf_range(-0.004, 0.004));
        M._part(root, coin, gold, at);
      }
      M._part(root, M._torus(0.04, 0.003), gold, V3(base.x, height * 0.0125 + 0.001, base.y));
    }
    M._part(root, coin, gold, V3(0.02, 0.006, 0.09), V3(0.12, 0, 0.1));
    const face = M._group(root, V3(-0.07, 0.047, 0.03), V3(-0.4, 0.15, 0));
    M._face_disc(face, 0.046, 0.012, gold, Vector3.ZERO);
    M._face_ring(face, 0.041, 0.003, gold, V3(0, 0, 0.006));
    M._part(face, M._slab(M._star_outline(5, 0.024, 0.01), 0.004), gold, V3(0, 0, 0.007));
    const leather = ArenaProps.leather(new Color(0.33, 0.18, 0.09));
    M._part(root, M._sphere(0.058, 20), leather, V3(0.09, 0.05, -0.07), ROT_ZERO, V3(1.0, 0.85, 1.0));
    M._part(root, M._cyl(0.02, 0.034, 0.03, 12), leather, V3(0.09, 0.105, -0.07));
    M._part(root, M._torus(0.022, 0.005), gold, V3(0.09, 0.106, -0.07));
    M._part(root, M._cyl(0.036, 0.018, 0.024, 12), leather, V3(0.09, 0.13, -0.07));
  }

  static _brilliancy_prize(root) {
    const M = RelicModels;
    const gold = ArenaProps.gold();
    M._rod(root, V3(0, 0.0, -0.09), V3(0, 0.2, -0.03), 0.005, gold);
    M._part(root, M._cyl(0.025, 0.03, 0.01, 12), gold, V3(0, 0.005, -0.09));
    const wreath = M._group(root, V3(0, 0.19, 0), V3(-0.4, 0, 0));
    const radius = 0.115;
    const leaf = M._slab(M._leaf_outline(0.068, 0.032), 0.005);
    for (const side of [-1.0, 1.0]) {
      const path = [];
      const radii = [];
      const colors = [];
      for (let i = 0; i < 12; i++) {
        const t = i / 11.0;
        const angle = -PI * 0.5 + side * (0.06 + t * 2.62);
        path.push(V3(Math.cos(angle), Math.sin(angle), 0).mul(radius));
        radii.push(lerpf(0.0065, 0.003, t));
        colors.push(Color.WHITE);
      }
      M._part(wreath, M._tube(path, radii, colors, 6), gold, Vector3.ZERO);
      for (let i = 0; i < 12; i++) {
        const t = (i + 0.5) / 12.0;
        const angle = -PI * 0.5 + side * (0.12 + t * 2.5);
        const at = V3(Math.cos(angle), Math.sin(angle), 0).mul(radius);
        const travel = V2(-Math.sin(angle), Math.cos(angle)).mul(side);
        const heading = Math.atan2(travel.y, travel.x) - PI * 0.5;
        const size = lerpf(1.0, 0.62, t);
        M._part(wreath, leaf, gold, at.add(V3(0, 0, 0.003)), V3(0, 0, heading - side * 0.6), Vector3.ONE.mul(size));
        M._part(wreath, leaf, gold, at.sub(V3(0, 0, 0.003)), V3(0, 0, heading + side * 0.55), Vector3.ONE.mul(size).mul(0.9));
      }
      const tipAngle = -PI * 0.5 + side * 2.72;
      M._part(wreath, M._sphere(0.007), gold, V3(Math.cos(tipAngle), Math.sin(tipAngle), 0).mul(radius));
    }
    const knot = V3(0, -radius, 0.012);
    for (const side of [-1.0, 1.0]) {
      M._part(wreath, M._torus(0.02, 0.006), M._crimson(), knot.add(V3(side * 0.022, 0.004, 0)), V3(PI * 0.5, 0, side * 0.3), V3(1.2, 1, 0.6));
      M._part(wreath, M._slab(M._tail_outline(0.022, 0.07, 0.012), 0.004), M._crimson(), knot.add(V3(side * 0.006, 0, -0.002)), V3(0, 0, side * 0.35));
    }
    M._part(wreath, M._sphere(0.012), M._crimson(), knot.add(V3(0, 0, 0.004)));
  }

  static _fortress_stone(root) {
    const M = RelicModels;
    const stone = M._keep_stone();
    const turn = V3(0, PI / 8.0, 0);
    const at = V3(-0.03, 0, -0.04);
    M._part(root, M._cyl(0.088, 0.098, 0.03, 8), stone, at.add(V3(0, 0.015, 0)), turn);
    M._part(root, M._cyl(0.074, 0.08, 0.2, 8), stone, at.add(V3(0, 0.13, 0)), turn);
    M._part(root, M._cyl(0.09, 0.078, 0.026, 8), stone, at.add(V3(0, 0.243, 0)), turn);
    for (let i = 0; i < 8; i++) {
      const angle = (TAU * i) / 8.0 + PI / 8.0;
      const spot = at.add(V3(Math.sin(angle) * 0.075, 0.272, Math.cos(angle) * 0.075));
      M._part(root, M._box(V3(0.032, 0.034, 0.024)), stone, spot, V3(0, angle, 0));
    }
    M._part(root, M._box(V3(0.04, 0.06, 0.02)), M._lacquer(), at.add(V3(0, 0.06, 0.07)));
    M._part(root, M._cyl(0.02, 0.02, 0.02, 12), M._lacquer(), at.add(V3(0, 0.09, 0.07)), V3(PI * 0.5, 0, 0));
    M._part(root, M._box(V3(0.012, 0.036, 0.02)), M._lacquer(), at.add(V3(0, 0.175, 0.068)));
    const shield = M._group(root, V3(0.07, 0.085, 0.07), V3(-0.3, 0.35, 0.06));
    M._part(shield, M._slab(M._shield_outline(0.142, 0.172), 0.008), ArenaProps.gold(), V3(0, 0, -0.004));
    M._part(shield, M._slab(M._shield_outline(0.128, 0.158), 0.012), M.silver(), Vector3.ZERO);
    M._piece(shield, 'rook', ArenaProps.gold(), V3(0, -0.05, 0.006), 0.1, ROT_ZERO, 0.12);
  }

  static _clockmakers_key(root) {
    const M = RelicModels;
    const gold = ArenaProps.gold();
    const body = V3(0, 0.058, -0.04);
    M._part(root, M._box(V3(0.25, 0.1, 0.09)), M._lacquer(), body);
    M._part(root, M._box(V3(0.26, 0.012, 0.1)), M._lacquer(), body.add(V3(0, 0.054, 0)));
    for (const x of [-0.11, 0.11]) {
      for (const z of [-0.035, 0.035]) M._part(root, M._sphere(0.01), gold, V3(x, 0.008, body.z + z));
    }
    M._part(root, M._box(V3(0.03, 0.012, 0.003)), gold, body.add(V3(0, -0.035, 0.046)));
    for (const side of [-1.0, 1.0]) {
      const face = M._group(root, body.add(V3(side * 0.058, 0.004, 0.046)), V3(-0.15, 0, 0));
      M._face_disc(face, 0.038, 0.006, M._porcelain(), Vector3.ZERO);
      M._face_ring(face, 0.04, 0.005, gold, V3(0, 0, 0.002));
      const minute = side < 0.0 ? 0.4 : -1.2;
      const hour = side < 0.0 ? 2.2 : 0.9;
      for (const [angle, length, width] of [[minute, 0.03, 0.003], [hour, 0.02, 0.004]]) {
        M._part(face, M._box(V3(width, length, 0.002)), M._ink(), V3(Math.sin(angle), Math.cos(angle), 0).mul(length * 0.5).add(V3(0, 0, 0.005)), V3(0, 0, -angle));
      }
      M._part(face, M._sphere(0.004), gold, V3(0, 0, 0.005));
      const pressed = side < 0.0 ? 0.008 : 0.0;
      M._part(root, M._cyl(0.013, 0.015, 0.024, 12), gold, body.add(V3(side * 0.07, 0.072 - pressed, 0)));
    }
    const flag = [V2(0, 0), V2(0.018, 0.008), V2(0, 0.016)];
    M._part(root, M._slab(flag, 0.002), M._crimson(), body.add(V3(-0.058, 0.044, 0.05)));
    const key = M._group(root, V3(0.0, 0.012, 0.1), V3(0, 0.18, 0));
    M._part(key, M._torus(0.038, 0.012), gold, V3(-0.13, 0, 0));
    M._part(key, M._sphere(0.016), gold, V3(-0.085, 0, 0));
    M._part(key, M._cyl(0.01, 0.01, 0.2, 10), gold, V3(0.01, 0, 0), V3(0, 0, PI * 0.5));
    M._part(key, M._torus(0.014, 0.004), gold, V3(-0.065, 0, 0), V3(0, 0, PI * 0.5));
    M._part(key, M._box(V3(0.044, 0.011, 0.046)), gold, V3(0.085, 0, 0.028));
    M._part(key, M._box(V3(0.013, 0.012, 0.018)), M._lacquer(), V3(0.085, 0, 0.043));
  }

  static _ransom_ledger(root) {
    const M = RelicModels;
    const gold = ArenaProps.gold();
    const green = ArenaProps.leather(new Color(0.1, 0.24, 0.14));
    const book = M._group(root, V3(0, 0, 0), V3(0, 0.22, 0));
    M._part(book, M._box(V3(0.24, 0.012, 0.18)), green, V3(0, 0.006, 0));
    M._part(book, M._box(V3(0.24, 0.012, 0.18)), green, V3(0, 0.058, 0));
    M._part(book, M._box(V3(0.014, 0.064, 0.18)), green, V3(-0.117, 0.032, 0));
    M._part(book, M._box(V3(0.226, 0.04, 0.17)), ArenaProps.pages(), V3(0.004, 0.032, 0));
    M._part(book, M._box(V3(0.016, 0.02, 0.07)), M._parchment(), V3(-0.125, 0.034, 0));
    for (const z of [-0.084, 0.084]) {
      M._part(book, M._box(V3(0.03, 0.015, 0.014)), gold, V3(0.107, 0.058, z));
      M._part(book, M._box(V3(0.014, 0.015, 0.03)), gold, V3(0.115, 0.058, z - Math.sign(z) * 0.008));
    }
    const crown = M._group(root, V3(0.02, 0.064, 0.0), V3(0, 0.3, 0));
    M._crown(crown, 1.0);
  }

  /** The little velvet-lined crown (ledger, queening charter). */
  static _crown(parent, scale) {
    const M = RelicModels;
    const gold = ArenaProps.gold();
    const crown = M._group(parent, Vector3.ZERO, ROT_ZERO, scale);
    M._part(crown, M._sphere(0.05, 16), M._velvet(new Color(0.5, 0.05, 0.07)), V3(0, 0.03, 0), ROT_ZERO, V3(1, 0.75, 1));
    M._part(crown, M._cyl(0.056, 0.054, 0.034, 20), gold, V3(0, 0.017, 0));
    M._part(crown, M._torus(0.056, 0.004), gold, V3(0, 0.002, 0));
    M._part(crown, M._torus(0.057, 0.003), gold, V3(0, 0.033, 0));
    for (let i = 0; i < 6; i++) {
      const angle = (TAU * i) / 6.0;
      const at = V3(Math.sin(angle) * 0.052, 0.054, Math.cos(angle) * 0.052);
      M._part(crown, M._cyl(0.0, 0.013, 0.04, 6), gold, at);
      M._part(crown, M._sphere(0.0065), M._porcelain(), at.add(V3(0, 0.022, 0)));
      const gem = V3(Math.sin(angle + PI / 6.0) * 0.057, 0.018, Math.cos(angle + PI / 6.0) * 0.057);
      M._part(crown, M._sphere(0.007), M._jewel('ruby', new Color(0.95, 0.1, 0.12)), gem);
    }
    M._part(crown, M._sphere(0.01), gold, V3(0, 0.07, 0));
    M._part(crown, M._box(V3(0.005, 0.026, 0.005)), gold, V3(0, 0.086, 0));
    M._part(crown, M._box(V3(0.018, 0.005, 0.005)), gold, V3(0, 0.09, 0));
  }

  static _knights_tour_chart(root) {
    const M = RelicModels;
    const chart = M._group(root, V3(0, 0, 0.015), V3(0, -0.12, 0));
    M._part(chart, M._box(V3(0.27, 0.004, 0.19)), M._parchment(), V3(0, 0.002, 0));
    M._part(chart, M._cyl(0.026, 0.026, 0.28, 16), M._parchment(), V3(0, 0.026, -0.105), V3(0, 0, PI * 0.5));
    M._part(chart, M._torus(0.027, 0.004), M._crimson(), V3(0.09, 0.026, -0.105), V3(0, 0, PI * 0.5));
    const cell = 0.032;
    const origin = V3(-0.07, 0.0045, 0.012);
    for (let x = 0; x < 5; x++) {
      for (let z = 0; z < 5; z++) {
        if ((x + z) % 2 === 1) M._part(chart, M._box(V3(cell, 0.0012, cell)), M._sepia(), origin.add(V3((x - 2) * cell, 0, (z - 2) * cell)));
      }
    }
    const tour = [[0, 4], [1, 2], [3, 1], [4, 3], [2, 4], [0, 3]];
    const ink = M._crimson();
    const lift = V3(0, 0.0012, 0);
    for (let i = 0; i < tour.length; i++) {
      const at = origin.add(lift).add(V3((tour[i][0] - 2) * cell, 0, (tour[i][1] - 2) * cell));
      M._part(chart, M._cyl(0.005, 0.005, 0.0016, 10), ink, at);
      if (i > 0) {
        const from = origin.add(lift).add(V3((tour[i - 1][0] - 2) * cell, 0, (tour[i - 1][1] - 2) * cell));
        M._strip(chart, from, at, 0.0035, ink);
      }
    }
    M._piece(chart, 'knight', M.silver(), V3(0.085, 0.004, 0.015), 0.2, V3(0, -0.9, 0));
  }

  static _fianchetto_glass(root) {
    const M = RelicModels;
    const gold = ArenaProps.gold();
    const board = M._group(root, V3(0.045, 0, -0.05), V3(0, -0.2, 0));
    const cell = 0.042;
    for (let x = 0; x < 3; x++) {
      for (let z = 0; z < 3; z++) {
        const diagonal = x === z;
        const material = diagonal ? gold : (x + z) % 2 === 0 ? M._ivory() : M._lacquer();
        M._part(board, M._box(V3(cell, 0.012, cell)), material, V3((x - 1) * cell, 0.006, (z - 1) * cell));
      }
    }
    M._piece(board, 'bishop', M._ivory(), V3(-cell, 0.012, -cell), 0.2);
    const glass = M._group(root, V3(-0.005, 0.14, 0.085), V3(-0.4, 0, -0.9));
    M._face_disc(glass, 0.064, 0.004, M._lens(), Vector3.ZERO, 32);
    M._face_ring(glass, 0.068, 0.008, gold, Vector3.ZERO);
    M._part(glass, M._cyl(0.011, 0.013, 0.026, 12), gold, V3(0, -0.086, 0));
    M._part(glass, M._cyl(0.012, 0.015, 0.11, 12), M._lacquer(), V3(0, -0.154, 0));
    M._part(glass, M._sphere(0.014), gold, V3(0, -0.212, 0));
  }

  static _castling_deed(root) {
    const M = RelicModels;
    const gold = ArenaProps.gold();
    const deed = M._group(root, V3(0, 0, 0.02), V3(0, -0.15, 0));
    M._part(deed, M._box(V3(0.2, 0.004, 0.15)), M._parchment(), V3(0, 0.002, 0));
    for (const side of [-1.0, 1.0]) {
      M._part(deed, M._cyl(0.02, 0.02, 0.16, 14), M._parchment(), V3(side * 0.105, 0.02, 0), V3(PI * 0.5, 0, 0));
      for (const end of [-1.0, 1.0]) M._part(deed, M._sphere(0.009), gold, V3(side * 0.105, 0.02, end * 0.085));
    }
    for (let i = 0; i < 5; i++) {
      const length = [0.13, 0.12, 0.13, 0.09, 0.06][i];
      M._part(deed, M._box(V3(length, 0.0012, 0.004)), M._sepia(), V3(-0.08 + length * 0.5, 0.0045, -0.05 + i * 0.019));
    }
    const seal = V3(0.05, 0.009, 0.045);
    for (const side of [-1.0, 1.0]) {
      M._part(deed, M._slab(M._tail_outline(0.018, 0.075, 0.01), 0.003), M._crimson(), seal.add(V3(side * 0.01, -0.004, 0)), V3(-PI * 0.5, side * 0.35, 0));
    }
    M._part(deed, M._cyl(0.028, 0.03, 0.01, 18), M._sealing_wax(), seal);
    M._part(deed, M._torus(0.02, 0.003), M._sealing_wax(), seal.add(V3(0, 0.005, 0)));
    M._piece(deed, 'rook', M._ivory(), V3(-0.045, 0.004, -0.01), 0.2);
  }

  static _queening_charter(root) {
    const M = RelicModels;
    const banner = ArenaProps.banner(1.0, new Color(0.12, 0.2, 0.45), new Color(0.86, 0.63, 0.27));
    banner.scale = Vector3.ONE.mul(0.32);
    banner.position = V3(-0.04, 0, -0.05);
    root.add_child(banner);
    M._piece(root, 'pawn', M._ivory(), V3(0.1, 0, 0.06), 0.15);
    const crown = M._group(root, V3(0.1, 0.143, 0.06));
    M._crown(crown, 0.36);
  }

  static _salt_horn(root) {
    const M = RelicModels;
    const gold = ArenaProps.gold();
    const path = [];
    const radii = [];
    const colors = [];
    const centre = V2(0.0, 0.18);
    const bend = 0.15;
    const steps = 16;
    for (let i = 0; i < steps + 1; i++) {
      const t = i / steps;
      const angle = deg_to_rad(lerpf(205.0, 338.0, t));
      path.push(V3(centre.x + Math.cos(angle) * bend, centre.y + Math.sin(angle) * bend, Math.sin(t * PI) * 0.02));
      radii.push(Math.fround(lerpf(0.046, 0.006, Math.pow(t, 0.85))));
      colors.push(Color.WHITE);
    }
    let lowest = Infinity;
    for (let i = 0; i < path.length; i++) lowest = Math.min(lowest, path[i].y - radii[i]);
    const horn = M._group(root, V3(0.02, 0.003 - lowest, -0.03), V3(0, 0.25, 0));
    const split = 11;
    M._part(horn, M._tube(path.slice(0, split + 1), radii.slice(0, split + 1), colors.slice(0, split + 1), 14), M._mat('horn', new Color(0.84, 0.75, 0.57), 0.4), Vector3.ZERO);
    M._part(horn, M._tube(path.slice(split), radii.slice(split), colors.slice(split), 14), M._mat('horn_tip', new Color(0.27, 0.18, 0.11), 0.35), Vector3.ZERO);
    for (const index of [0, 9]) {
      const tangent = path[index + 1].sub(path[index]).normalized();
      const band = M._part(horn, M._torus(radii[index] + 0.001, index === 0 ? 0.005 : 0.003), gold, path[index]);
      band.basis = Basis.from_quaternion(Quaternion.from_arc(Vector3.UP, tangent)).mul(Basis.from_scale(band.scale));
    }
    const mouthOut = path[0].sub(path[1]).normalized();
    const fill = M._part(horn, M._cyl(0.04, 0.04, 0.006, 16), M._salt(), path[0].add(mouthOut.mul(0.001)));
    fill.basis = Basis.from_quaternion(Quaternion.from_arc(Vector3.UP, mouthOut));
    M._part(horn, M._sphere(0.009), gold, path[steps]);
    const mouth = horn.position.add(path[0].rotated(Vector3.UP, 0.25));
    const pile = V3(mouth.x - 0.01, 0.0, mouth.z + 0.06);
    M._part(root, M._cyl(0.006, 0.058, 0.034, 14), M._salt(), pile.add(V3(0, 0.017, 0)));
    const rng = M._rng('salt_horn');
    for (let i = 0; i < 14; i++) {
      const spread = V3(rng.randf_range(-0.07, 0.07), 0, rng.randf_range(-0.05, 0.07));
      const size = rng.randf_range(0.007, 0.013);
      const crystal = pile.add(spread).add(V3(0, size * 0.5, 0));
      M._part(root, M._box(Vector3.ONE.mul(size)), M._salt(), crystal, V3(rng.randf() * TAU, rng.randf() * TAU, rng.randf() * TAU));
    }
  }

  static _forfeit_slip(root) {
    const M = RelicModels;
    const slip = M._group(root, V3(0.0, 0.0, 0.01), V3(0, -0.2, 0));
    M._part(slip, M._box(V3(0.25, 0.004, 0.17)), M._card(), V3(0, 0.002, 0));
    const face = M._group(slip, V3(-0.06, 0.004, 0.0), V3(-PI * 0.5, 0, 0));
    const stamp = M._crimson();
    M._face_ring(face, 0.05, 0.005, stamp, Vector3.ZERO);
    M._piece(face, 'pawn', stamp, V3(0, -0.036, 0.0), 0.07, ROT_ZERO, 0.04);
    M._part(face, M._box(V3(0.1, 0.008, 0.002)), stamp, V3(0, 0, 0.001), V3(0, 0, -0.75));
    for (let i = 0; i < 4; i++) {
      const length = i % 2 === 0 ? 0.06 : 0.045;
      M._part(slip, M._box(V3(length, 0.0012, 0.005)), M._sepia(), V3(0.045 + length * 0.5, 0.0045, -0.05 + i * 0.022));
    }
    M._piece(root, 'pawn', M._obsidian(), V3(0.03, 0.068, 0.05), 0.14, V3(0, 0.15, -PI * 0.5 - 0.2));
  }

  static _opening_book(root) {
    const M = RelicModels;
    const wedge = [V2(-0.09, 0.0), V2(0.08, 0.0), V2(0.08, 0.075), V2(-0.09, 0.008)];
    M._part(root, M._slab(wedge, 0.2), M._wood(), V3(0, 0, 0), V3(0, PI * 0.5, 0));
    const book = M._group(root, V3(0, 0.05, -0.002), V3(0.41, 0, 0));
    const brown = ArenaProps.leather(new Color(0.36, 0.14, 0.07));
    for (const side of [-1.0, 1.0]) {
      const half = M._group(book, V3(side * 0.066, 0, 0), V3(0, 0, side * 0.07));
      M._part(half, M._box(V3(0.13, 0.008, 0.18)), brown, V3(side * 0.002, 0, 0));
      M._part(half, M._box(V3(0.122, 0.016, 0.17)), ArenaProps.pages(), V3(0, 0.012, 0));
      for (let i = 0; i < 7; i++) {
        if (side > 0.0 && i >= 2 && i <= 5) continue;
        const length = i % 3 !== 2 ? 0.09 : 0.06;
        M._part(half, M._box(V3(length, 0.0012, 0.0035)), M._sepia(), V3(-side * 0.004 + (length - 0.09) * 0.5, 0.0205, -0.066 + i * 0.022));
      }
      if (side > 0.0) {
        const cell = 0.017;
        for (let x = 0; x < 4; x++) {
          for (let z = 0; z < 4; z++) {
            const dark = (x + z) % 2 === 1;
            M._part(half, M._box(V3(cell, 0.0012, cell)), dark ? M._sepia() : M._card(), V3((x - 1.5) * cell, 0.0205, (z - 1.5) * cell + 0.012));
          }
        }
      }
    }
    M._part(book, M._box(V3(0.012, 0.004, 0.064)), M._crimson(), V3(0, 0.021, 0.056));
    M._part(book, M._slab(M._tail_outline(0.012, 0.03, 0.006), 0.003), M._crimson(), V3(0, 0.02, 0.089), V3(-0.41, 0, 0));
  }

  static _annotators_quill(root) {
    const M = RelicModels;
    const gold = ArenaProps.gold();
    const sheet = M._group(root, V3(0.03, 0, 0.03), V3(0, 0.3, 0));
    M._part(sheet, M._box(V3(0.2, 0.003, 0.15)), ArenaProps.pages(), V3(0, 0.0015, 0));
    for (let i = 0; i < 5; i++) {
      const length = i % 2 === 0 ? 0.14 : 0.11;
      M._part(sheet, M._box(V3(length, 0.0012, 0.0035)), M._sepia(), V3(-0.07 + length * 0.5, 0.0035, -0.05 + i * 0.024));
    }
    const well = V3(-0.06, 0.003, -0.04);
    M._part(root, M._cyl(0.046, 0.05, 0.05, 18), M._dark_glass(), well.add(V3(0, 0.025, 0)));
    M._part(root, M._cyl(0.024, 0.046, 0.018, 18), M._dark_glass(), well.add(V3(0, 0.059, 0)));
    M._part(root, M._cyl(0.022, 0.022, 0.014, 16), M._dark_glass(), well.add(V3(0, 0.075, 0)));
    M._part(root, M._torus(0.023, 0.004), gold, well.add(V3(0, 0.082, 0)));
    M._part(root, M._cyl(0.018, 0.018, 0.002, 16), M._ink(), well.add(V3(0, 0.081, 0)));
    const quill = M._group(root, well.add(V3(0, 0.07, 0)), V3(-0.2, 0, -0.38));
    const shaft = [];
    const radii = [];
    const colors = [];
    for (let i = 0; i < 9; i++) {
      const t = i / 8.0;
      shaft.push(V3(0.022 * t * t, -0.03 + 0.33 * t, 0));
      radii.push(Math.fround(lerpf(0.0035, 0.0012, t)));
      colors.push(Color.WHITE);
    }
    M._part(quill, M._tube(shaft, radii, colors, 8), M._feather(), Vector3.ZERO);
    M._part(quill, M._cyl(0.0, 0.004, 0.02, 8), gold, V3(0, -0.04, 0), V3(PI, 0, 0));
    const vane = [V2(0.0, 0.06), V2(0.012, 0.08), V2(0.02, 0.11), V2(0.025, 0.14), V2(0.017, 0.152), V2(0.027, 0.168), V2(0.029, 0.2), V2(0.025, 0.24), V2(0.016, 0.27), V2(0.004, 0.296)];
    const bendVane = (points, width) => {
      const out = [];
      for (const point of points) {
        const t = Math.min(Math.max((point.y + 0.03) / 0.33, 0.0), 1.0);
        out.push(V2(point.x * width + 0.022 * t * t, point.y));
      }
      const spine = [];
      for (let i = points.length - 1; i > -1; i--) {
        const t = Math.min(Math.max((points[i].y + 0.03) / 0.33, 0.0), 1.0);
        spine.push(V2(0.022 * t * t, points[i].y));
      }
      out.push(...spine.slice(1, spine.length - 1));
      return out;
    };
    M._part(quill, M._slab(bendVane(vane, 1.0), 0.0025), M._feather(), V3(0, 0, 0.0), V3(0, -0.25, 0));
    M._part(quill, M._slab(bendVane(vane, -0.7), 0.0025), M._feather(), V3(0, 0, 0.0), V3(0, 0.25, 0));
  }

  static _patrons_chit(root) {
    const M = RelicModels;
    const gold = ArenaProps.gold();
    M._part(root, M._box(V3(0.19, 0.035, 0.06)), M._wood(), V3(0, 0.0175, -0.04));
    M._part(root, M._box(V3(0.17, 0.002, 0.012)), M._ink(), V3(0, 0.0355, -0.04));
    const card = M._group(root, V3(0, 0.09, -0.04), V3(-0.22, 0, 0));
    M._part(card, M._box(V3(0.16, 0.11, 0.006)), M._card(), Vector3.ZERO);
    for (const y of [-0.048, 0.048]) M._part(card, M._box(V3(0.148, 0.005, 0.002)), gold, V3(0, y, 0.0035));
    for (const x of [-0.072, 0.072]) M._part(card, M._box(V3(0.005, 0.1, 0.002)), gold, V3(x, 0, 0.0035));
    M._piece(card, 'pawn', gold, V3(0, -0.034, 0.003), 0.066, ROT_ZERO, 0.08);
    for (const side of [-1.0, 1.0]) M._part(card, M._slab(M._star_outline(5, 0.012, 0.005), 0.002), M._crimson(), V3(side * 0.045, 0.01, 0.004));
    for (const [at, turn] of [[V3(0.05, 0.0, 0.07), 0.3], [V3(-0.04, 0.0, 0.085), -0.5]]) {
      const coin = M._group(root, at, V3(0, turn, 0));
      M._part(coin, M._cyl(0.034, 0.034, 0.008, 24), gold, V3(0, 0.004, 0));
      M._part(coin, M._torus(0.029, 0.0025), gold, V3(0, 0.008, 0));
      M._part(coin, M._box(V3(0.012, 0.0024, 0.012)), M._ink(), V3(0, 0.0078, 0), V3(0, PI * 0.25, 0));
    }
  }

  static _sealed_move(root) {
    const M = RelicModels;
    M._part(root, M._box(V3(0.21, 0.025, 0.055)), M._wood(), V3(0, 0.0125, -0.04));
    const envelope = M._group(root, V3(0, 0.083, -0.035), V3(-0.32, 0, 0));
    M._part(envelope, M._box(V3(0.2, 0.13, 0.007)), ArenaProps.pages(), Vector3.ZERO);
    const flap = [V2(-0.1, 0.065), V2(0.1, 0.065), V2(0.0, -0.012)];
    M._part(envelope, M._slab(flap, 0.003), M._card(), V3(0, 0, 0.005));
    for (const side of [-1.0, 1.0]) {
      const fold = [V2(side * 0.1, -0.065), V2(side * 0.1, -0.058), V2(side * 0.02, 0.0), V2(side * 0.012, -0.002)];
      M._part(envelope, M._slab(fold, 0.002), M._card(), V3(0, 0, 0.004));
    }
    M._face_disc(envelope, 0.026, 0.008, M._sealing_wax(), V3(0, -0.006, 0.009));
    M._face_ring(envelope, 0.018, 0.0025, M._sealing_wax(), V3(0, -0.006, 0.013));
    M._piece(envelope, 'king', M._sealing_wax(), V3(0, -0.018, 0.013), 0.026, ROT_ZERO, 0.15);
  }

  static _grandmaster_norm(root) {
    const M = RelicModels;
    const gold = ArenaProps.gold();
    const outside = ArenaProps.leather(new Color(0.06, 0.06, 0.08));
    const velvet = M._velvet(new Color(0.1, 0.16, 0.42));
    const box = M._group(root, V3(0, 0, 0.0), V3(0, -0.1, 0));
    M._part(box, M._box(V3(0.2, 0.04, 0.15)), outside, V3(0, 0.02, 0));
    M._part(box, M._box(V3(0.184, 0.004, 0.134)), velvet, V3(0, 0.041, 0));
    const lid = M._group(box, V3(0, 0.04, -0.075), V3(-1.85, 0, 0));
    M._part(lid, M._box(V3(0.2, 0.02, 0.15)), outside, V3(0, 0.01, 0.075));
    M._part(lid, M._box(V3(0.184, 0.003, 0.134)), velvet, V3(0, -0.001, 0.075));
    M._part(lid, M._box(V3(0.05, 0.003, 0.008)), gold, V3(0, -0.003, 0.14));
    const medal = M._group(box, V3(0, 0.06, 0.012), V3(-0.95, 0, 0));
    for (const side of [-1.0, 1.0]) {
      const ribbon = M._group(medal, V3(side * 0.012, 0.04, -0.004), V3(0, 0, side * -0.28));
      M._part(ribbon, M._box(V3(0.026, 0.07, 0.003)), M._crimson(), V3(0, 0.035, 0));
      M._part(ribbon, M._box(V3(0.007, 0.07, 0.0034)), M._white(), V3(0, 0.035, 0));
    }
    M._part(medal, M._torus(0.008, 0.0025), gold, V3(0, 0.052, 0), V3(PI * 0.5, 0, 0));
    M._face_disc(medal, 0.05, 0.01, gold, Vector3.ZERO, 28);
    M._face_ring(medal, 0.046, 0.004, gold, V3(0, 0, 0.005));
    M._part(medal, M._slab(M._star_outline(5, 0.032, 0.014), 0.006), gold, V3(0, 0, 0.006));
  }
}
