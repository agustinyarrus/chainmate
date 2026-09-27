/**
 * The slice of Godot physics the game uses: static bodies with one CylinderShape3D, on collision
 * layers, queried with a ray (PhysicsDirectSpaceState3D.intersect_ray). Bodies register while inside
 * the tree; a query transforms the ray into each cylinder's local frame (so toppled or scaled pieces
 * still pick right) and returns the nearest hit. O(bodies) per query — a few dozen pieces at most.
 */
import * as THREE from 'three';
import { Vector3 } from './math.js';
import { Node3D } from './node3d.js';

const bodies = new Set();
const inverse = new THREE.Matrix4();
const localOrigin = new THREE.Vector3();
const localEnd = new THREE.Vector3();
const hitPoint = new THREE.Vector3();

export class CylinderShape3D {
  constructor(radius = 0.5, height = 2.0) {
    this.radius = radius;
    this.height = height;
  }
}

/** CollisionShape3D: holds the shape; its own transform offsets it inside the body. */
export class CollisionShape3D extends Node3D {
  constructor(shape = null) {
    super('CollisionShape3D');
    this.shape = shape;
  }
}

/** StaticBody3D with metadata (set_meta / get_meta) and a collision layer bitmask. */
export class StaticBody3D extends Node3D {
  constructor() {
    super('StaticBody3D');
    this.collision_layer = 1;
    this.collision_mask = 1;
    this._meta = new Map();
  }
  set_meta(key, value) {
    this._meta.set(key, value);
  }
  get_meta(key, fallback = null) {
    return this._meta.has(key) ? this._meta.get(key) : fallback;
  }
  _enter_tree() {
    bodies.add(this);
  }
  _exit_tree() {
    bodies.delete(this);
  }
  _dispose() {
    bodies.delete(this);
    super._dispose();
  }
}

/**
 * Ray segment vs a Y-axis cylinder centred at the origin (radius r, half-height h), in local space.
 * Returns the entry parameter t ∈ [0, 1] along the segment or -1. O(1).
 */
function segmentCylinder(o, e, r, h) {
  const dx = e.x - o.x;
  const dy = e.y - o.y;
  const dz = e.z - o.z;
  let best = -1;
  // Side wall.
  const a = dx * dx + dz * dz;
  if (a > 1e-12) {
    const b = 2 * (o.x * dx + o.z * dz);
    const c = o.x * o.x + o.z * o.z - r * r;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      const y = o.y + dy * t;
      if (t >= 0 && t <= 1 && y >= -h && y <= h) best = t;
    }
  }
  // Caps.
  if (Math.abs(dy) > 1e-12) {
    for (const capY of [h, -h]) {
      const t = (capY - o.y) / dy;
      if (t < 0 || t > 1 || (best >= 0 && t >= best)) continue;
      const x = o.x + dx * t;
      const z = o.z + dz * t;
      if (x * x + z * z <= r * r) best = t;
    }
  }
  return best;
}

/** get_world_3d().direct_space_state.intersect_ray(query) for cylinder bodies. */
export function intersectRay(from, to, collisionMask) {
  let nearest = null;
  let nearestT = Infinity;
  for (const body of bodies) {
    // Hidden bodies still collide in Godot (visibility is a rendering property): only tree membership counts.
    if ((body.collision_layer & collisionMask) === 0 || !body._inside) continue;
    for (const child of body.children) {
      if (!(child instanceof CollisionShape3D) || !(child.shape instanceof CylinderShape3D)) continue;
      child.object3d.updateWorldMatrix(true, false);
      inverse.copy(child.object3d.matrixWorld).invert();
      localOrigin.set(from.x, from.y, from.z).applyMatrix4(inverse);
      localEnd.set(to.x, to.y, to.z).applyMatrix4(inverse);
      const t = segmentCylinder(localOrigin, localEnd, child.shape.radius, child.shape.height / 2);
      if (t >= 0 && t < nearestT) {
        nearestT = t;
        hitPoint.set(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, from.z + (to.z - from.z) * t);
        nearest = { collider: body, position: new Vector3(hitPoint.x, hitPoint.y, hitPoint.z) };
      }
    }
  }
  return nearest ?? {};
}

