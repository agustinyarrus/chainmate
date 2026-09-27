/**
 * MeshKit — port of scripts/presentation/mesh_kit.gd: beveled boxes, flat frame rings and the
 * ribbon used for the move arc. Geometry is emitted Godot-style (SurfaceTool, CW) and flipped once.
 */
import { Vector2, Vector3 } from '../godot/math.js';
import { SurfaceTool } from '../godot/render/primitives.js';

const V3 = (x, y, z) => new Vector3(x, y, z);

export class MeshKit {
  static beveled_box(size, bevel) {
    const st = new SurfaceTool();
    const hx = size.x * 0.5;
    const hy = size.y * 0.5;
    const hz = size.z * 0.5;
    const shoulder = hy - bevel;
    const ix = hx - bevel;
    const iz = hz - bevel;
    const top = [V3(-ix, hy, -iz), V3(ix, hy, -iz), V3(ix, hy, iz), V3(-ix, hy, iz)];
    const mid = [V3(-hx, shoulder, -hz), V3(hx, shoulder, -hz), V3(hx, shoulder, hz), V3(-hx, shoulder, hz)];
    const low = [V3(-hx, -hy, -hz), V3(hx, -hy, -hz), V3(hx, -hy, hz), V3(-hx, -hy, hz)];
    MeshKit._quad(st, top[0], top[1], top[2], top[3], Vector3.UP);
    MeshKit._quad(st, low[3], low[2], low[1], low[0], Vector3.DOWN);
    const outward = [Vector3.FORWARD, Vector3.RIGHT, Vector3.BACK, Vector3.LEFT];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const side = outward[i];
      MeshKit._quad(st, mid[i], mid[j], low[j], low[i], side);
      const slope = side.add(Vector3.UP).normalized();
      MeshKit._quad(st, top[i], top[j], mid[j], mid[i], slope);
    }
    return st.commit();
  }

  static frame_ring(innerHalf, outerHalf, height) {
    const st = new SurfaceTool();
    const inner = [V3(-innerHalf, height, -innerHalf), V3(innerHalf, height, -innerHalf), V3(innerHalf, height, innerHalf), V3(-innerHalf, height, innerHalf)];
    const outer = [V3(-outerHalf, height, -outerHalf), V3(outerHalf, height, -outerHalf), V3(outerHalf, height, outerHalf), V3(-outerHalf, height, outerHalf)];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      MeshKit._quad(st, outer[i], outer[j], inner[j], inner[i], Vector3.UP);
    }
    return st.commit();
  }

  /** A flat strip following `points` (horizontal side vector), UV.x = distance travelled. O(n). */
  static ribbon(points, width) {
    const st = new SurfaceTool();
    if (points.length < 2) return st.commit();
    let travelled = 0.0;
    const lefts = [];
    const rights = [];
    const distances = [];
    for (let i = 0; i < points.length; i++) {
      let ahead = points[Math.min(i + 1, points.length - 1)].sub(points[Math.max(i - 1, 0)]);
      ahead = new Vector3(ahead.x, 0.0, ahead.z);
      if (ahead.length_squared() < 1e-6) ahead = Vector3.FORWARD;
      const side = ahead.normalized().cross(Vector3.UP).mul(width).mul(0.5);
      lefts.push(points[i].sub(side));
      rights.push(points[i].add(side));
      if (i > 0) travelled += points[i].distance_to(points[i - 1]);
      distances.push(Math.fround(travelled));
    }
    for (let i = 0; i < points.length - 1; i++) {
      const u0 = distances[i];
      const u1 = distances[i + 1];
      MeshKit._uv_tri(st, lefts[i], new Vector2(u0, 0), rights[i], new Vector2(u0, 1), rights[i + 1], new Vector2(u1, 1));
      MeshKit._uv_tri(st, lefts[i], new Vector2(u0, 0), rights[i + 1], new Vector2(u1, 1), lefts[i + 1], new Vector2(u1, 0));
    }
    return st.commit();
  }

  static _quad(st, a, b, c, d, normal) {
    MeshKit._tri(st, a, b, c, normal);
    MeshKit._tri(st, a, c, d, normal);
  }

  static _tri(st, a, b, c, normal) {
    if (b.sub(a).cross(c.sub(a)).dot(normal) > 0.0) {
      const swap = b;
      b = c;
      c = swap;
    }
    for (const vertex of [a, b, c]) {
      st.set_normal(normal);
      st.set_uv(new Vector2(vertex.x, vertex.z));
      st.add_vertex(vertex);
    }
  }

  static _uv_tri(st, a, ua, b, ub, c, uc) {
    let vertices = [a, b, c];
    let uvs = [ua, ub, uc];
    if (b.sub(a).cross(c.sub(a)).dot(Vector3.UP) > 0.0) {
      vertices = [a, c, b];
      uvs = [ua, uc, ub];
    }
    for (let i = 0; i < 3; i++) {
      st.set_normal(Vector3.UP);
      st.set_uv(uvs[i]);
      st.add_vertex(vertices[i]);
    }
  }
}
