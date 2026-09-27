/**
 * PieceMeshes — port of scripts/presentation/piece_meshes.gd: the six chess pieces × four tiers,
 * built from lathed profiles (12 facets with bevels), lofted knight neck/head, pyramids, blades, gems.
 * Vertex colours encode material regions for the piece shader (R trim, G cloth, B emission, A cavity).
 *
 * Arithmetic follows GDScript exactly: vector expressions evaluate left to right in float32
 * (`start * u * u * u` is three float32 multiplies), scalar ones in double.
 */
import { Vector2, Vector3, Color, Basis, Transform3D, TAU, fposmod, lerpf, clampf, deg_to_rad, F } from '../godot/math.js';
import { fromGodotArrays } from '../godot/render/primitives.js';

const V2 = (x, y) => new Vector2(x, y);
const V3 = (x, y, z) => new Vector3(x, y, z);
const UP = Vector3.UP;

const KINDS = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const MAX_TIER = 3;
const SIDES = 12;
const BEVEL = 0.16;
const ROUND = 24;
const CREVICE = 0.6;
const HEIGHT = { pawn: 0.74, knight: 1.03, bishop: 1.05, rook: 0.9, queen: 1.13, king: 1.24 };
const RADIUS = { pawn: 0.34, knight: 0.36, bishop: 0.35, rook: 0.36, queen: 0.37, king: 0.38 };

const STONE = new Color(0.0, 0.0, 0.0, 1.0);
const TRIM = new Color(1.0, 0.0, 0.0, 1.0);
const CLOTH = new Color(0.0, 1.0, 0.0, 1.0);
const GEM = new Color(0.0, 0.0, 1.0, 1.0);
const GEM_DIM = new Color(0.0, 0.0, 0.35, 1.0);
const GLOW_TRIM = new Color(1.0, 0.0, 0.8, 1.0);
const CARVED = new Color(0.0, 0.0, 0.0, 0.1);

// Vector4 constants are float32 in Godot: round them like the engine does.
const NECK = [
  [0.27, 0.0, 0.16, 0.2], [0.36, -0.015, 0.155, 0.195], [0.46, -0.005, 0.14, 0.165],
  [0.56, 0.015, 0.13, 0.125], [0.65, 0.03, 0.125, 0.1], [0.74, 0.04, 0.118, 0.077],
  [0.82, 0.03, 0.105, 0.062], [0.88, 0.02, 0.08, 0.042],
].map((v) => v.map(F));
const HEAD = [
  [0.05, 0.855, 0.07, 0.05, 0.05], [0.02, 0.855, 0.1, 0.08, 0.09], [-0.03, 0.845, 0.118, 0.085, 0.125],
  [-0.09, 0.825, 0.112, 0.075, 0.11], [-0.15, 0.795, 0.098, 0.066, 0.078], [-0.21, 0.76, 0.088, 0.06, 0.058],
  [-0.26, 0.73, 0.084, 0.058, 0.052], [-0.3, 0.71, 0.08, 0.055, 0.048], [-0.325, 0.7, 0.062, 0.044, 0.038],
];
const LOFT_POINTS = 12;
const LOFT_POWER = 2.3;

const meshes = new Map();

/** Lathe profile in (radius, height), with per-segment paint and smooth-joint flags. */
class Profile {
  constructor(start) {
    this.points = [start];
    this.colors = [];
    this.smooth = [false];
    this.pen = new Color(0, 0, 0, 1);
  }
  paint(color) {
    this.pen = color;
  }
  to(p) {
    this.colors.push(this.pen);
    this.points.push(p);
    this.smooth.push(false);
  }
  curve(c1, c2, end, steps = 10) {
    const start = this.points[this.points.length - 1];
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const u = 1.0 - t;
      const p = start.mul(u).mul(u).mul(u)
        .add(c1.mul(3.0).mul(u).mul(u).mul(t))
        .add(c2.mul(3.0).mul(u).mul(t).mul(t))
        .add(end.mul(t).mul(t).mul(t));
      this.to(p);
      this.smooth[this.smooth.length - 1] = k < steps;
    }
  }
  arc(centre, radius, fromDeg, toDeg, steps = 12) {
    for (let k = 1; k <= steps; k++) {
      const a = deg_to_rad(lerpf(fromDeg, toDeg, k / steps));
      this.to(centre.add(V2(Math.cos(a), Math.sin(a)).mul(radius)));
      this.smooth[this.smooth.length - 1] = k < steps;
    }
  }
}

/** Triangle soup with Godot's winding rule (CW relative to the supplied normals). */
class MeshBuilder {
  constructor() {
    this.verts = [];
    this.normals = [];
    this.colors = [];
  }
  tri(a, b, c, na, nb, nc, ca, cb, cc) {
    const face = b.sub(a).cross(c.sub(a));
    if (face.length_squared() < 1e-14) return;
    if (face.dot(na.add(nb).add(nc)) > 0.0) {
      this._add(a, na, ca);
      this._add(c, nc, cc);
      this._add(b, nb, cb);
    } else {
      this._add(a, na, ca);
      this._add(b, nb, cb);
      this._add(c, nc, cc);
    }
  }
  _add(v, n, c) {
    this.verts.push(v);
    this.normals.push(n);
    this.colors.push(c);
  }
  quad(v, n, c) {
    this.tri(v[0], v[1], v[2], n[0], n[1], n[2], c[0], c[1], c[2]);
    this.tri(v[0], v[2], v[3], n[0], n[2], n[3], c[0], c[2], c[3]);
  }
  /** UV.x = azimuth, UV.y = height / piece height (the shader's foot shade and promotion glint). */
  commit(height) {
    const count = this.verts.length;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const colors = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const v = this.verts[i];
      const n = this.normals[i];
      const c = this.colors[i];
      positions.set([v.x, v.y, v.z], i * 3);
      normals.set([n.x, n.y, n.z], i * 3);
      uvs.set([fposmod(Math.atan2(v.x, -v.z) / TAU, 1.0), clampf(v.y / height, 0.0, 1.0)], i * 2);
      colors.set([c.r, c.g, c.b, c.a], i * 4);
    }
    return fromGodotArrays({ positions, normals, uvs, colors });
  }
}

export class PieceMeshes {
  static KINDS = KINDS;
  static MAX_TIER = MAX_TIER;

  /** Cached geometry per kind and tier (0..3). */
  static get_mesh(kind, tier) {
    if (!KINDS.includes(kind) || tier < 0 || tier > MAX_TIER) throw new Error(`no piece mesh for ${kind} tier ${tier}`);
    const key = `${kind}:${tier}`;
    if (!meshes.has(key)) {
      const m = new MeshBuilder();
      PieceMeshes[`_${kind}`](m, tier);
      meshes.set(key, m.commit(HEIGHT[kind]));
    }
    return meshes.get(key);
  }

  static height(kind) {
    return HEIGHT[kind];
  }

  static base_radius(kind) {
    return RADIUS[kind];
  }

  static _foot(r, tier) {
    const line = tier >= 2 ? TRIM : STONE;
    const p = new Profile(V2(0.0, 0.0));
    p.to(V2(r - 0.014, 0.0));
    p.to(V2(r, 0.014));
    p.to(V2(r, 0.05));
    p.paint(line);
    p.to(V2(r - 0.016, 0.066));
    p.paint(STONE);
    p.to(V2(r - 0.046, 0.066));
    p.to(V2(r - 0.046, 0.097));
    p.paint(line);
    p.to(V2(r - 0.06, 0.111));
    p.paint(STONE);
    p.to(V2(r - 0.084, 0.111));
    p.paint(tier >= 1 ? TRIM : STONE);
    p.arc(V2(r - 0.084, 0.1295), 0.0185, -90.0, 90.0);
    p.paint(STONE);
    p.to(V2(r - 0.11, 0.148));
    return p;
  }

  static _collar(p, r, y, tier) {
    p.paint(tier >= 3 ? GLOW_TRIM : tier >= 1 ? TRIM : STONE);
    p.to(V2(r, y));
    p.to(V2(r + 0.012, y + 0.012));
    p.to(V2(r + 0.012, y + 0.027));
    p.to(V2(r - 0.002, y + 0.039));
    p.paint(STONE);
  }

  static _studs(m, r, color) {
    for (let i = 0; i < 4; i++) {
      const a = (TAU * (i + 0.5)) / 4.0;
      const out = V3(Math.sin(a), 0.0, -Math.cos(a));
      PieceMeshes._gem(m, out.mul(r * 0.99).add(UP.mul(0.032)), out, 0.022, color);
    }
  }

  static _pawn(m, tier) {
    const r = RADIUS.pawn;
    const p = PieceMeshes._foot(r, tier);
    p.curve(V2(0.205, 0.2), V2(0.112, 0.31), V2(0.096, 0.42));
    PieceMeshes._collar(p, 0.15, 0.428, tier);
    p.to(V2(0.086, 0.472));
    p.to(V2(0.08, 0.5));
    p.to(V2(0.0, 0.5));
    PieceMeshes._lathe(m, p, SIDES);
    PieceMeshes._ball(m, V3(0.0, 0.615, 0.0), 0.125, tier >= 3 ? GLOW_TRIM : STONE);
    if (tier >= 3) PieceMeshes._studs(m, r, TRIM);
  }

  static _rook(m, tier) {
    const r = RADIUS.rook;
    const p = PieceMeshes._foot(r, tier);
    p.to(V2(0.245, 0.16));
    p.paint(tier >= 2 ? TRIM : STONE);
    p.to(V2(0.244, 0.198));
    p.paint(STONE);
    p.curve(V2(0.236, 0.32), V2(0.212, 0.5), V2(0.206, 0.598));
    PieceMeshes._collar(p, 0.212, 0.598, tier);
    p.curve(V2(0.24, 0.66), V2(0.27, 0.69), V2(0.276, 0.74));
    p.paint(tier >= 3 ? TRIM : STONE);
    p.to(V2(0.276, 0.8));
    p.paint(STONE);
    p.to(V2(0.2, 0.8));
    p.to(V2(0.2, 0.772));
    p.to(V2(0.0, 0.772));
    let tabard = null;
    if (tier >= 2) tabard = { facets: [0, 6], y0: 0.22, y1: 0.57, color: CLOTH, edge: TRIM };
    PieceMeshes._lathe(m, p, SIDES, Transform3D.IDENTITY, tabard);
    for (let i = 0; i < 6; i++) {
      const a = (TAU * i) / 6.0;
      const basis = Basis.from_axis_angle(UP, -a);
      const centre = basis.xform(V3(0.0, 0.85, -0.238));
      PieceMeshes._block(m, centre, V3(0.066, 0.05, 0.037), tier >= 3 ? TRIM : STONE, basis);
    }
    if (tier >= 3) PieceMeshes._studs(m, r, TRIM);
  }

  static _bishop(m, tier) {
    const r = RADIUS.bishop;
    const p = PieceMeshes._foot(r, tier);
    p.curve(V2(0.222, 0.26), V2(0.116, 0.42), V2(0.1, 0.56));
    PieceMeshes._collar(p, 0.15, 0.566, tier);
    p.to(V2(0.09, 0.612));
    p.to(V2(0.086, 0.64));
    p.to(V2(0.0, 0.64));
    let tabard = null;
    if (tier >= 2) tabard = { facets: [0, 6], y0: 0.17, y1: 0.54, color: CLOTH, edge: TRIM };
    PieceMeshes._lathe(m, p, SIDES, Transform3D.IDENTITY, tabard);
    const crystal = tier >= 3;
    const mitre = new Profile(V2(0.0, 0.636));
    mitre.paint(tier >= 2 ? TRIM : STONE);
    mitre.to(V2(0.09, 0.636));
    mitre.to(V2(0.106, 0.652));
    mitre.paint(crystal ? GEM : STONE);
    mitre.curve(V2(0.126, 0.672), V2(0.136, 0.73), V2(0.124, 0.79));
    mitre.curve(V2(0.11, 0.87), V2(0.05, 0.96), V2(0.0, 1.05));
    const ribs = crystal ? { ribs: [0.652, 1.05], color: TRIM } : null;
    PieceMeshes._lathe(m, mitre, SIDES, Transform3D.IDENTITY, ribs);
    for (const side of [-1.0, 1.0]) {
      const face = PieceMeshes._facet_distance(0.118, SIDES) + 0.003;
      PieceMeshes._decal(m, V3(0.0, 0.83, face * side), V3(0.0, 0.22, side), 0.024, 0.052, crystal ? TRIM : CARVED);
    }
    if (tier >= 3) PieceMeshes._studs(m, r, TRIM);
  }

  static _queen(m, tier) {
    const r = RADIUS.queen;
    const p = PieceMeshes._foot(r, tier);
    p.curve(V2(0.24, 0.3), V2(0.126, 0.48), V2(0.11, 0.62));
    PieceMeshes._collar(p, 0.165, 0.626, tier);
    p.to(V2(0.118, 0.672));
    p.curve(V2(0.12, 0.75), V2(0.15, 0.81), V2(0.19, 0.84));
    p.paint(tier >= 2 ? TRIM : STONE);
    p.to(V2(0.2, 0.85));
    p.to(V2(0.2, 0.9));
    p.to(V2(0.186, 0.912));
    p.paint(STONE);
    p.to(V2(0.15, 0.912));
    p.curve(V2(0.14, 0.96), V2(0.08, 0.99), V2(0.0, 0.995));
    let tabard = null;
    if (tier >= 2) tabard = { facets: [0, 6], y0: 0.18, y1: 0.6, color: CLOTH, edge: TRIM };
    PieceMeshes._lathe(m, p, SIDES, Transform3D.IDENTITY, tabard);
    const spikeColor = tier >= 3 ? TRIM : STONE;
    const pearlColor = tier >= 2 ? TRIM : STONE;
    for (let i = 0; i < 8; i++) {
      const a = (TAU * (i + 0.5)) / 8.0;
      const out = V3(Math.sin(a), 0.0, -Math.cos(a));
      const side = out.cross(UP);
      const root = out.mul(0.183).add(UP.mul(0.9));
      const tip = out.mul(0.2).add(UP.mul(i % 2 === 0 ? 1.0 : 0.975));
      PieceMeshes._pyramid(m, [
        root.add(side.mul(0.034)).sub(out.mul(0.018)),
        root.add(side.mul(0.034)).add(out.mul(0.02)),
        root.sub(side.mul(0.034)).add(out.mul(0.02)),
        root.sub(side.mul(0.034)).sub(out.mul(0.018)),
      ], tip, spikeColor);
      PieceMeshes._ball(m, tip.add(UP.mul(0.012)), 0.021, pearlColor);
    }
    PieceMeshes._ball(m, V3(0.0, 1.03, 0.0), 0.046, tier >= 3 ? GLOW_TRIM : pearlColor);
    const finial = V3(0.0, 1.07, 0.0);
    PieceMeshes._pyramid(m, [finial.add(V3(0.02, 0, 0)), finial.add(V3(0, 0, 0.02)), finial.add(V3(-0.02, 0, 0)), finial.add(V3(0, 0, -0.02))], V3(0.0, 1.13, 0.0), pearlColor);
    const gemColor = tier >= 2 ? GEM : TRIM;
    for (const side of [-1.0, 1.0]) {
      PieceMeshes._gem(m, V3(0.0, 0.875, 0.197 * side), V3(0.0, 0.0, side), tier >= 3 ? 0.034 : 0.026, gemColor);
    }
    if (tier >= 3) PieceMeshes._studs(m, r, TRIM);
  }

  static _king(m, tier) {
    const r = RADIUS.king;
    const p = PieceMeshes._foot(r, tier);
    p.curve(V2(0.25, 0.32), V2(0.132, 0.52), V2(0.12, 0.66));
    PieceMeshes._collar(p, 0.175, 0.666, tier);
    p.to(V2(0.126, 0.712));
    p.curve(V2(0.13, 0.8), V2(0.17, 0.88), V2(0.2, 0.92));
    p.paint(tier >= 2 ? TRIM : STONE);
    p.to(V2(0.21, 0.93));
    p.to(V2(0.21, 0.965));
    p.to(V2(0.19, 0.98));
    p.paint(STONE);
    p.to(V2(0.07, 0.98));
    p.to(V2(0.07, 1.0));
    p.to(V2(0.0, 1.0));
    let tabard = null;
    if (tier >= 2) tabard = { facets: [0, 3, 6, 9], y0: 0.18, y1: 0.63, color: CLOTH, edge: TRIM };
    PieceMeshes._lathe(m, p, SIDES, Transform3D.IDENTITY, tabard);
    const cross = tier >= 2 ? TRIM : STONE;
    PieceMeshes._block(m, V3(0.0, 1.115, 0.0), V3(0.03, 0.125, 0.03), cross);
    PieceMeshes._block(m, V3(0.0, 1.16, 0.0), V3(0.088, 0.03, 0.03), cross);
    if (tier >= 2) {
      for (const side of [-1.0, 1.0]) {
        PieceMeshes._gem(m, V3(0.0, 0.86, PieceMeshes._facet_distance(0.172, SIDES) * side + 0.004 * side), V3(0.0, 0.25, side), tier >= 3 ? 0.036 : 0.028, GEM);
      }
    }
    if (tier >= 3) PieceMeshes._studs(m, r, TRIM);
  }

  static _knight(m, tier) {
    const r = RADIUS.knight;
    const p = PieceMeshes._foot(r, tier);
    p.curve(V2(0.24, 0.18), V2(0.21, 0.22), V2(0.2, 0.238));
    PieceMeshes._collar(p, 0.206, 0.238, tier);
    p.to(V2(0.0, 0.277));
    PieceMeshes._lathe(m, p, SIDES);

    const neck = NECK.map((s) => PieceMeshes._ring_xz(s[0], s[1], s[2], s[3]));
    PieceMeshes._loft(m, neck, STONE, true, true);
    const head = HEAD.map((s) => PieceMeshes._ring_xy(s[0], s[1], s[2], s[3], s[4]));
    PieceMeshes._loft(m, head, STONE, true, true);

    // Ears.
    for (const side of [-1.0, 1.0]) {
      const base = V3(0.052 * side, 0.924, 0.004);
      PieceMeshes._pyramid(m, [base.add(V3(0, 0, -0.028)), base.add(V3(0.022 * side, 0, 0)), base.add(V3(0, 0, 0.028)), base.add(V3(-0.022 * side, 0, 0))],
        V3(0.066 * side, 1.03, 0.04), STONE);
    }

    // Mane: blades along the crest of the neck.
    const mane = tier >= 3 ? GEM : tier >= 2 ? CLOTH : STONE;
    const crest = [];
    for (const s of NECK.slice(0, 7)) crest.push(V3(0.0, s[0], s[1] + s[3] - 0.012));
    crest.push(V3(0.0, 0.915, 0.055));
    for (let k = 0; k < crest.length - 1; k++) {
      const a = crest[k];
      const b = crest[k + 1];
      const along = b.sub(a).normalized();
      let outward = along.y > 0.0 ? V3(0.0, -along.z, along.y) : V3(0.0, along.z, -along.y);
      if (outward.z < 0.0) outward = outward.neg();
      const reach = (k % 2 === 0 ? 0.05 : 0.038) + (tier >= 3 ? 0.012 : 0.0);
      PieceMeshes._blade(m, a, b.add(along.mul(0.03)), b.add(outward.mul(reach)), 0.03, mane);
    }

    // Eyes and carved details.
    const eye = tier >= 3 ? GEM : tier >= 2 ? GEM_DIM : CARVED;
    for (const side of [-1.0, 1.0]) {
      PieceMeshes._decal(m, V3(0.11 * side, 0.862, -0.08), V3(side, 0.15, -0.12), 0.024, 0.013, eye);
      PieceMeshes._decal(m, V3(0.046 * side, 0.705, -0.321), V3(side * 0.6, 0.0, -1.0), 0.01, 0.015, CARVED);
      PieceMeshes._decal(m, V3(0.076 * side, 0.69, -0.285), V3(side, -0.2, -0.1), 0.032, 0.004, CARVED);
    }

    // Bridle bands and gems.
    if (tier >= 1) PieceMeshes._band(m, -0.245, -0.215, 1.07, tier === 1 ? TRIM : CLOTH);
    if (tier >= 2) {
      PieceMeshes._band(m, -0.035, -0.012, 1.05, TRIM);
      for (const side of [-1.0, 1.0]) PieceMeshes._gem(m, V3(0.097 * side, 0.785, -0.17), V3(side, 0.0, 0.0), 0.016, TRIM);
    }
    if (tier >= 3) {
      PieceMeshes._gem(m, V3(0.0, 0.888, -0.12), V3(0.0, 1.0, -0.5), 0.03, GEM);
      PieceMeshes._studs(m, r, TRIM);
    }
  }

  static _ring_xz(y, zc, halfW, halfD) {
    const out = [];
    for (let i = 0; i < LOFT_POINTS; i++) {
      const t = (TAU * i) / LOFT_POINTS;
      out.push(V3(halfW * PieceMeshes._super(Math.cos(t)), y, zc + halfD * PieceMeshes._super(Math.sin(t))));
    }
    return out;
  }

  static _ring_xy(z, yc, halfW, above, below) {
    const out = [];
    for (let i = 0; i < LOFT_POINTS; i++) {
      const t = (TAU * i) / LOFT_POINTS;
      const s = PieceMeshes._super(Math.sin(t));
      out.push(V3(halfW * PieceMeshes._super(Math.cos(t)), yc + s * (s > 0.0 ? above : below), z));
    }
    return out;
  }

  static _super(v) {
    const sign = v > 0 ? 1 : v < 0 ? -1 : 0;
    return sign * Math.pow(Math.abs(v), 2.0 / LOFT_POWER);
  }

  static _band(m, z0, z1, grow, color) {
    const rings = [];
    for (const z of [z0, z1]) {
      const s = PieceMeshes._head_at(z);
      rings.push(PieceMeshes._ring_xy(z, s[0], s[1] * grow, s[2] * grow, s[3] * grow));
    }
    PieceMeshes._loft(m, rings, color, false);
  }

  static _head_at(z) {
    for (let i = 0; i < HEAD.length - 1; i++) {
      const a = HEAD[i];
      const b = HEAD[i + 1];
      if (z <= a[0] && z >= b[0]) {
        const t = (a[0] - z) / (a[0] - b[0]);
        return [lerpf(a[1], b[1], t), lerpf(a[2], b[2], t), lerpf(a[3], b[3], t), lerpf(a[4], b[4], t)];
      }
    }
    throw new Error(`z ${z} is outside the knight's head`);
  }

  static _facet_distance(r, sides) {
    return r * Math.cos(Math.PI / sides);
  }

  /** Revolves a profile around Y with `sides` facets (0 = round), optional region paint. */
  static _lathe(m, prof, sides, xform = Transform3D.IDENTITY, paint = null) {
    const stations = PieceMeshes._stations(sides);
    const pts = prof.points;
    const normalXform = xform.basis.inverse().transposed();
    const segNormals = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const d = pts[i + 1].sub(pts[i]);
      segNormals.push(V2(d.y, -d.x).normalized());
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      if (p0.x < 1e-5 && p1.x < 1e-5) continue;
      const n0 = PieceMeshes._joint_normal(prof, segNormals, i, true);
      const n1 = PieceMeshes._joint_normal(prof, segNormals, i + 1, false);
      const a0 = PieceMeshes._joint_cavity(prof, i);
      const a1 = PieceMeshes._joint_cavity(prof, i + 1);
      const color = prof.colors[i];
      const yMid = (p0.y + p1.y) * 0.5;
      for (let j = 0; j < stations.length; j++) {
        const s0 = stations[j];
        const s1 = stations[(j + 1) % stations.length];
        const c = PieceMeshes._station_color(paint, s0, stations, j, yMid, color);
        const q0 = s0[0];
        const q1 = s1[0];
        const h0 = s0[1];
        const h1 = s1[1];
        const v = [
          V3(q0.x * p0.x, p0.y, q0.y * p0.x), V3(q1.x * p0.x, p0.y, q1.y * p0.x),
          V3(q1.x * p1.x, p1.y, q1.y * p1.x), V3(q0.x * p1.x, p1.y, q0.y * p1.x),
        ];
        const n = [
          V3(h0.x * n0.x, n0.y, h0.y * n0.x), V3(h1.x * n0.x, n0.y, h1.y * n0.x),
          V3(h1.x * n1.x, n1.y, h1.y * n1.x), V3(h0.x * n1.x, n1.y, h0.y * n1.x),
        ];
        const colors = [new Color(c, a0), new Color(c, a0), new Color(c, a1), new Color(c, a1)];
        for (let k = 0; k < 4; k++) {
          v[k] = xform.xform(v[k]);
          n[k] = normalXform.xform(n[k]).normalized();
        }
        m.quad(v, n, colors);
      }
    }
  }

  /** Stations around the axis: each facet contributes two corners pulled toward each other (bevel). */
  static _stations(sides) {
    const out = [];
    if (sides === 0) {
      for (let k = 0; k < ROUND; k++) {
        const d = PieceMeshes._dir((TAU * k) / ROUND);
        out.push([d, d, -1, false]);
      }
      return out;
    }
    for (let i = 0; i < sides; i++) {
      const c0 = PieceMeshes._dir((TAU * (i - 0.5)) / sides);
      const c1 = PieceMeshes._dir((TAU * (i + 0.5)) / sides);
      const facet = PieceMeshes._dir((TAU * i) / sides);
      out.push([c0.lerp(c1, BEVEL), facet, i, false]);
      out.push([c1.lerp(c0, BEVEL), facet, i, true]);
    }
    return out;
  }

  static _dir(angle) {
    return V2(Math.sin(angle), -Math.cos(angle));
  }

  static _station_color(paint, station, stations, j, y, base) {
    if (paint === null || station[2] < 0) return base;
    const chamfer = station[3];
    if (paint.ribs) {
      const span = paint.ribs;
      return chamfer && y >= span[0] && y <= span[1] ? paint.color : base;
    }
    if (y < paint.y0 || y > paint.y1) return base;
    const facets = paint.facets;
    if (!chamfer) return facets.includes(station[2]) ? paint.color : base;
    const next = stations[(j + 1) % stations.length];
    return facets.includes(station[2]) || facets.includes(next[2]) ? paint.edge : base;
  }

  static _joint_normal(prof, segNormals, joint, leaving) {
    const own = leaving ? segNormals[joint] : segNormals[joint - 1];
    if (joint <= 0 || joint >= prof.points.length - 1 || !prof.smooth[joint]) return own;
    return segNormals[joint - 1].add(segNormals[joint]).normalized();
  }

  /** Concave hard joints darken (cavity alpha) to read as carved grooves. */
  static _joint_cavity(prof, joint) {
    if (joint <= 0 || joint >= prof.points.length - 1 || prof.smooth[joint]) return 1.0;
    const before = prof.points[joint].sub(prof.points[joint - 1]);
    const after = prof.points[joint + 1].sub(prof.points[joint]);
    return before.cross(after) < -1e-6 ? CREVICE : 1.0;
  }

  static _ball(m, centre, radius, color) {
    const p = new Profile(V2(0.0, -radius));
    p.paint(color);
    p.arc(Vector2.ZERO, radius, -90.0, 90.0);
    PieceMeshes._lathe(m, p, 0, new Transform3D(new Basis(), centre));
  }

  static _block(m, centre, half, color, basis = new Basis()) {
    const b = 0.14;
    const p = new Profile(V2(0.0, -1.0));
    p.paint(color);
    p.to(V2(Math.sqrt(2.0) * (1.0 - b), -1.0));
    p.to(V2(Math.sqrt(2.0), -1.0 + b));
    p.to(V2(Math.sqrt(2.0), 1.0 - b));
    p.to(V2(Math.sqrt(2.0) * (1.0 - b), 1.0));
    p.to(V2(0.0, 1.0));
    PieceMeshes._lathe(m, p, 4, new Transform3D(basis.mul(Basis.from_scale(half)), centre));
  }

  /** Skins consecutive rings (smooth normals, or faceted), optional end caps. */
  static _loft(m, rings, color, caps = true, faceted = false) {
    const rows = rings.length;
    const cols = rings[0].length;
    const centres = [];
    for (const ring of rings) {
      let sum = Vector3.ZERO;
      for (const q of ring) sum = sum.add(q);
      centres.push(sum.div(cols));
    }
    const normals = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const here = rings[r][c];
        const around = rings[r][(c + 1) % cols].sub(rings[r][(c - 1 + cols) % cols]);
        const along = rings[Math.min(r + 1, rows - 1)][c].sub(rings[Math.max(r - 1, 0)][c]);
        let n = around.cross(along).normalized();
        if (n.dot(here.sub(centres[r])) < 0.0) n = n.neg();
        row.push(n);
      }
      normals.push(row);
    }
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols; c++) {
        const d = (c + 1) % cols;
        const corners = [rings[r][c], rings[r][d], rings[r + 1][d], rings[r + 1][c]];
        let shading = [normals[r][c], normals[r][d], normals[r + 1][d], normals[r + 1][c]];
        if (faceted) {
          const flat = shading[0].add(shading[1]).add(shading[2]).add(shading[3]).normalized();
          shading = [flat, flat, flat, flat];
        }
        m.quad(corners, shading, [color, color, color, color]);
      }
    }
    if (!caps) return;
    for (const end of [0, rows - 1]) {
      const ring = rings[end];
      const axis = centres[end].sub(centres[end === 0 ? 1 : rows - 2]).normalized();
      for (let c = 0; c < cols; c++) m.tri(centres[end], ring[c], ring[(c + 1) % cols], axis, axis, axis, color, color, color);
    }
  }

  static _pyramid(m, base, apex, color) {
    const centre = base[0].add(base[1]).add(base[2]).add(base[3]).mul(0.25);
    for (let i = 0; i < 4; i++) {
      const a = base[i];
      const b = base[(i + 1) % 4];
      let n = b.sub(a).cross(apex.sub(a)).normalized();
      if (n.dot(a.add(b).mul(0.5).sub(centre)) < 0.0) n = n.neg();
      m.tri(a, b, apex, n, n, n, color, color, color);
    }
    const down = centre.sub(apex).normalized();
    m.tri(base[0], base[1], base[2], down, down, down, color, color, color);
    m.tri(base[0], base[2], base[3], down, down, down, color, color, color);
  }

  static _blade(m, a, b, tip, half, color) {
    const x = V3(half, 0.0, 0.0);
    const t = V3(half * 0.35, 0.0, 0.0);
    for (const side of [-1.0, 1.0]) {
      const n = V3(side, 0.0, 0.0);
      m.tri(a.add(x.mul(side)), b.add(x.mul(side)), tip.add(t.mul(side)), n, n, n, color, color, color);
    }
    for (const [e0, e1] of [[a, tip], [tip, b]]) {
      let n = e1.sub(e0).cross(Vector3.RIGHT).normalized();
      const middle = a.add(b).add(tip).div(3.0);
      if (n.dot(e0.add(e1).mul(0.5).sub(middle)) < 0.0) n = n.neg();
      const w0 = !e0.equals(tip) ? x : t;
      const w1 = !e1.equals(tip) ? x : t;
      m.quad([e0.add(w0), e1.add(w1), e1.sub(w1), e0.sub(w0)], [n, n, n, n], [color, color, color, color]);
    }
  }

  static _gem(m, centre, normal, size, color) {
    const out = normal.normalized();
    const up = Math.abs(out.dot(UP)) < 0.95 ? UP.sub(out.mul(out.dot(UP))).normalized() : Vector3.FORWARD;
    const right = up.cross(out).normalized();
    const base = [
      centre.add(up.mul(size).mul(1.3)), centre.add(right.mul(size).mul(0.8)),
      centre.sub(up.mul(size).mul(1.3)), centre.sub(right.mul(size).mul(0.8)),
    ];
    PieceMeshes._pyramid(m, base, centre.add(out.mul(size).mul(0.7)), color);
  }

  static _decal(m, centre, normal, halfW, halfH, color) {
    const out = normal.normalized();
    const up = UP.sub(out.mul(out.dot(UP))).normalized();
    const right = up.cross(out).normalized();
    m.quad([centre.add(up.mul(halfH)), centre.add(right.mul(halfW)), centre.sub(up.mul(halfH)), centre.sub(right.mul(halfW))],
      [out, out, out, out], [color, color, color, color]);
  }
}
