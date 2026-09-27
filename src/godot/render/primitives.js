/**
 * Godot meshes as THREE.BufferGeometry.
 *
 * Godot's front faces wind CLOCKWISE; three.js's wind counter-clockwise. Procedural code in the game is
 * written for Godot (it even swaps vertices to fix winding), so every triangle list that comes out of
 * a Godot-style builder passes through `fromGodotArrays`, the single place where the order flips.
 * Primitive meshes keep Godot's UV conventions where a shader reads UV (quad, plane).
 */
import * as THREE from 'three';

/**
 * Godot arrays → geometry. `positions/normals` Float32Array (xyz), `uvs/uv2s` (xy), `colors` (rgba),
 * `indices` optional (CW). Triangles are flipped to CCW. O(vertices).
 */
export function fromGodotArrays({ positions, normals, uvs, uv2s, colors, indices }) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (normals) geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (uv2s) geometry.setAttribute('aUv2', new THREE.BufferAttribute(uv2s, 2));
  if (colors) geometry.setAttribute('aColor', new THREE.BufferAttribute(quantizeColors(colors), 4));
  if (indices) {
    const flipped = new Uint32Array(indices.length);
    for (let i = 0; i < indices.length; i += 3) {
      flipped[i] = indices[i];
      flipped[i + 1] = indices[i + 2];
      flipped[i + 2] = indices[i + 1];
    }
    geometry.setIndex(new THREE.BufferAttribute(flipped, 1));
  } else {
    // Non-indexed: swap the 2nd and 3rd vertex of each triangle in every attribute.
    for (const attribute of Object.values(geometry.attributes)) {
      const size = attribute.itemSize;
      const array = attribute.array;
      for (let t = 0; t + 2 < attribute.count; t += 3) {
        for (let k = 0; k < size; k++) {
          const a = (t + 1) * size + k;
          const b = (t + 2) * size + k;
          const swap = array[a];
          array[a] = array[b];
          array[b] = swap;
        }
      }
    }
  }
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

/**
 * Godot stores mesh vertex colours as RGBA8, converting with `uint8_t(CLAMP(c * 255.0, 0, 255))`
 * (truncation, not rounding). Shaders then read n/255 — reproduce it so cavity/gem masks match.
 */
export function quantizeColors(colors) {
  const out = new Float32Array(colors.length);
  for (let i = 0; i < colors.length; i++) out[i] = Math.trunc(Math.min(Math.max(colors[i] * 255.0, 0), 255)) / 255;
  return out;
}

/** Godot's SurfaceTool for PRIMITIVE_TRIANGLES: set_* then add_vertex; commit() → geometry. */
export class SurfaceTool {
  constructor() {
    this.p = [];
    this.n = [];
    this.uv = [];
    this.uv2 = [];
    this.c = [];
    this._normal = [0, 0, 0];
    this._uv = [0, 0];
    this._uv2 = [0, 0];
    this._color = [1, 1, 1, 1];
    this.hasUv = false;
    this.hasUv2 = false;
    this.hasColor = false;
  }
  begin() {}
  set_normal(v) {
    this._normal = [v.x, v.y, v.z];
  }
  set_uv(v) {
    this._uv = [v.x, v.y];
    this.hasUv = true;
  }
  set_uv2(v) {
    this._uv2 = [v.x, v.y];
    this.hasUv2 = true;
  }
  set_color(c) {
    this._color = [c.r, c.g, c.b, c.a];
    this.hasColor = true;
  }
  add_vertex(v) {
    this.p.push(v.x, v.y, v.z);
    this.n.push(...this._normal);
    this.uv.push(...this._uv);
    this.uv2.push(...this._uv2);
    this.c.push(...this._color);
  }
  get vertexCount() {
    return this.p.length / 3;
  }
  commit() {
    return fromGodotArrays({
      positions: new Float32Array(this.p),
      normals: new Float32Array(this.n),
      uvs: this.hasUv ? new Float32Array(this.uv) : undefined,
      uv2s: this.hasUv2 ? new Float32Array(this.uv2) : undefined,
      colors: this.hasColor ? new Float32Array(this.c) : undefined,
    });
  }
}

/** BoxMesh(size) — same faces/normals as Godot (its UV atlas is never sampled by the game). */
export function boxMesh(size = { x: 1, y: 1, z: 1 }) {
  return new THREE.BoxGeometry(size.x, size.y, size.z);
}

/**
 * CylinderMesh — three's cylinder uses Godot's exact ring layout (x = sin, z = cos of the segment
 * angle, smooth side normals with the slope term). `rings` intermediate rings = rings + 1 bands.
 */
export function cylinderMesh(top = 0.5, bottom = 0.5, height = 2, radialSegments = 64, rings = 4, capTop = true, capBottom = true) {
  const geometry = new THREE.CylinderGeometry(top, bottom, height, radialSegments, rings + 1, !(capTop || capBottom));
  return geometry;
}

/** SphereMesh(radius, height, radial_segments, rings) — rings + 1 latitude bands like Godot. */
export function sphereMesh(radius = 0.5, height = 1, radialSegments = 64, rings = 32) {
  const geometry = new THREE.SphereGeometry(radius, radialSegments, rings + 1);
  if (Math.abs(height - radius * 2) > 1e-6) geometry.scale(1, height / (radius * 2), 1);
  return geometry;
}

/** TorusMesh(inner, outer) — Godot's torus lies in the XZ plane (around +Y). */
export function torusMesh(inner = 0.5, outer = 1.0, rings = 64, ringSegments = 32) {
  const lo = Math.min(inner, outer);
  const hi = Math.max(inner, outer);
  const geometry = new THREE.TorusGeometry((lo + hi) / 2, (hi - lo) / 2, ringSegments, rings);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/**
 * QuadMesh(size, center_offset) — faces +Z; Godot UVs: (0,0) top-left … (1,1) bottom-right,
 * i.e. V grows DOWNWARD (the flame shader relies on UV.y = 0 at the tip).
 */
export function quadMesh(size = { x: 1, y: 1 }, centerOffset = { x: 0, y: 0, z: 0 }) {
  const hx = size.x / 2;
  const hy = size.y / 2;
  const o = centerOffset;
  const positions = new Float32Array([
    -hx + o.x, hy + o.y, o.z, hx + o.x, hy + o.y, o.z, hx + o.x, -hy + o.y, o.z, -hx + o.x, -hy + o.y, o.z,
  ]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex([0, 3, 2, 0, 2, 1]);
  geometry.computeBoundingSphere();
  return geometry;
}

/** PlaneMesh(size) — lies on XZ facing +Y; Godot UVs: u grows with +X, v grows with +Z. */
export function planeMesh(size = { x: 2, y: 2 }) {
  const hx = size.x / 2;
  const hz = size.y / 2;
  const positions = new Float32Array([-hx, 0, -hz, hx, 0, -hz, hx, 0, hz, -hx, 0, hz]);
  const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex([0, 3, 2, 0, 2, 1]);
  geometry.computeBoundingSphere();
  return geometry;
}

/** PrismMesh (size 1, left_to_right 0.5): a triangular prism, apex up. */
export function prismMesh() {
  const a = [-0.5, -0.5];
  const b = [0.5, -0.5];
  const c = [0, 0.5];
  const shape = new THREE.Shape([new THREE.Vector2(...a), new THREE.Vector2(...b), new THREE.Vector2(...c)]);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  geometry.translate(0, 0, -0.5);
  return geometry;
}

export { THREE };
