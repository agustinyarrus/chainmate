/**
 * Canvas geometry exactly as Godot 4's RendererCanvasCull / CanvasItem build it, so 2D shapes rasterise
 * to the same pixels: every primitive becomes a triangle list with per-vertex colours (antialiasing is
 * geometric — feather strips fading to transparent — never MSAA), or a 1-px line list for "thin" draws.
 *
 *   rect            canvas_item_add_rect
 *   line            canvas_item_add_line (width quad + 1.25 px feather strips and corners)
 *   polyline        canvas_item_add_polyline (miter-joined strip, feathered sides and caps)
 *   circle          canvas_item_add_circle (64-point fan: 63 rim points + centre)
 *   arc             CanvasItem::draw_arc (points on the arc → polyline)
 *   polygon         canvas_item_add_polygon (ear-clipping triangulation)
 *
 * Output: a Mesh2D { positions: number[] (x,y), colors: number[] (r,g,b,a), indices: number[] },
 * appended in place (the caller batches). All builders are O(points).
 */
import * as THREE from 'three';

/** StyleBoxFlat's default feather, doubled for lines "as it's specified for both sides here". */
export const LINE_FEATHER = 1.25;
export const CIRCLE_SEGMENTS = 64;

export class Mesh2D {
  constructor() {
    this.positions = [];
    this.colors = [];
    this.uvs = null;
    this.indices = [];
    /** 'triangles' or 'lines' */
    this.primitive = 'triangles';
  }

  get vertexCount() {
    return this.positions.length / 2;
  }

  vertex(x, y, c) {
    this.positions.push(x, y);
    this.colors.push(c.r, c.g, c.b, c.a);
    return this.positions.length / 2 - 1;
  }

  /** A convex quad (CommandPrimitive with 4 points: triangles 0-1-2, 0-2-3). */
  quad(points, colors) {
    const base = this.vertexCount;
    for (let i = 0; i < 4; i++) this.vertex(points[i].x, points[i].y, colors[i]);
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** A triangle strip (PRIMITIVE_TRIANGLE_STRIP) expanded to indexed triangles. */
  strip(points, colors) {
    const base = this.vertexCount;
    for (let i = 0; i < points.length; i++) this.vertex(points[i].x, points[i].y, colors[i]);
    for (let i = 0; i + 2 < points.length; i++) this.indices.push(base + i, base + i + 1, base + i + 2);
  }
}

const V = (x, y) => ({ x, y });
const add = (a, b) => V(a.x + b.x, a.y + b.y);
const sub = (a, b) => V(a.x - b.x, a.y - b.y);
const mul = (a, k) => V(a.x * k, a.y * k);
const len = (a) => Math.hypot(a.x, a.y);
const normalized = (a) => {
  const l = len(a);
  return l > 0 ? V(a.x / l, a.y / l) : V(0, 0);
};
/** Godot's Vector2::orthogonal(): (y, −x). */
const orthogonal = (a) => V(a.y, -a.x);
const dot = (a, b) => a.x * b.x + a.y * b.y;
const zeroApprox = (a) => Math.abs(a.x) < 1e-5 && Math.abs(a.y) < 1e-5;
const equalApprox = (a, b) => Math.abs(a.x - b.x) < 1e-5 && Math.abs(a.y - b.y) < 1e-5;
const transparent = (c) => ({ r: c.r, g: c.g, b: c.b, a: 0 });

/** canvas_item_add_rect (no antialiasing for axis-aligned rects). */
export function rect(mesh, x, y, w, h, color) {
  mesh.quad([V(x, y), V(x + w, y), V(x + w, y + h), V(x, y + h)], [color, color, color, color]);
}

/** canvas_item_add_line. width < 0 → a 1-px primitive line. */
export function line(mesh, lines, from, to, color, width = -1, antialiased = false) {
  if (width < 0) {
    lines.positions.push(from.x, from.y, to.x, to.y);
    lines.colors.push(color.r, color.g, color.b, color.a, color.r, color.g, color.b, color.a);
    return;
  }
  const diff = sub(from, to);
  const dir = normalized(orthogonal(diff));
  const t = mul(dir, width * 0.5);
  const beginLeft = add(from, t);
  const beginRight = sub(from, t);
  const endLeft = add(to, t);
  const endRight = sub(to, t);
  mesh.quad([beginLeft, beginRight, endRight, endLeft], [color, color, color, color]);
  if (!antialiased) return;
  let border = LINE_FEATHER;
  if (width >= 0 && width < 1) border *= width;
  const dir2 = normalized(diff);
  const b = mul(dir, border);
  const b2 = mul(dir2, border);
  const clear = transparent(color);
  mesh.quad([beginLeft, add(beginLeft, b), add(endLeft, b), endLeft], [color, clear, clear, color]);
  mesh.quad([beginRight, sub(beginRight, b), sub(endRight, b), endRight], [color, clear, clear, color]);
  mesh.quad([beginLeft, add(beginLeft, b2), add(beginRight, b2), beginRight], [color, clear, clear, color]);
  mesh.quad([endLeft, sub(endLeft, b2), sub(endRight, b2), endRight], [color, clear, clear, color]);
  mesh.quad([beginLeft, add(beginLeft, b2), add(add(beginLeft, b), b2), add(beginLeft, b)], [color, clear, clear, clear]);
  mesh.quad([beginRight, add(beginRight, b2), add(sub(beginRight, b), b2), sub(beginRight, b)], [color, clear, clear, clear]);
  mesh.quad([endLeft, sub(endLeft, b2), sub(add(endLeft, b), b2), add(endLeft, b)], [color, clear, clear, clear]);
  mesh.quad([endRight, sub(endRight, b2), sub(sub(endRight, b), b2), sub(endRight, b)], [color, clear, clear, clear]);
}

/**
 * canvas_item_add_polyline. width < 0 → line strip. Otherwise a miter-joined triangle strip; with
 * antialiasing, two feather strips along the sides and feathered begin/end caps (open polylines).
 */
export function polyline(mesh, lines, points, colors, width = -1, antialiased = false) {
  const count = points.length;
  if (count < 2) return;
  const colorAt = (i) => colors[Math.min(i, colors.length - 1)] ?? { r: 1, g: 1, b: 1, a: 1 };
  if (width < 0) {
    for (let i = 0; i + 1 < count; i++) {
      const a = colorAt(i);
      const b = colorAt(i + 1);
      lines.positions.push(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
      lines.colors.push(a.r, a.g, a.b, a.a, b.r, b.g, b.b, b.a);
    }
    return;
  }
  const loop = equalApprox(points[0], points[count - 1]);
  let firstDir = V(0, 0);
  for (let i = 1; i < count; i++) {
    firstDir = normalized(sub(points[i], points[0]));
    if (!zeroApprox(firstDir)) break;
  }
  let lastDir = V(0, 0);
  for (let i = count - 1; i >= 1; i--) {
    lastDir = normalized(sub(points[count - 1], points[i - 1]));
    if (!zeroApprox(lastDir)) break;
  }
  let border = LINE_FEATHER;
  if (width < 1) border *= width;
  const center = [];
  const centerColors = [];
  const left = [];
  const leftColors = [];
  const right = [];
  const rightColors = [];
  let prevDir = V(0, 0);
  const capBegin = [];
  const capEnd = [];
  for (let i = 0; i < count; i++) {
    const first = i === 0;
    const last = i === count - 1;
    let segmentDir;
    if (last) segmentDir = lastDir;
    else {
      segmentDir = normalized(sub(points[i + 1], points[i]));
      if (zeroApprox(segmentDir)) segmentDir = prevDir;
    }
    let baseEdge;
    if (first && !loop) baseEdge = orthogonal(firstDir);
    else if (last && !loop) baseEdge = orthogonal(lastDir);
    else {
      const incoming = first ? lastDir : prevDir;
      baseEdge = orthogonal(normalized(add(segmentDir, incoming)));
      if (zeroApprox(baseEdge)) baseEdge = orthogonal(segmentDir);
      else {
        const d = dot(baseEdge, orthogonal(segmentDir));
        if (Math.abs(d) > 1e-6) baseEdge = mul(baseEdge, 1 / d);
      }
    }
    const edge = mul(baseEdge, width * 0.5);
    const feather = mul(baseEdge, border);
    const pos = points[i];
    const color = colorAt(i);
    const clear = transparent(color);
    center.push(add(pos, edge), sub(pos, edge));
    centerColors.push(color, color);
    if (antialiased) {
      left.push(add(pos, edge), add(add(pos, edge), feather));
      leftColors.push(color, clear);
      right.push(sub(pos, edge), sub(sub(pos, edge), feather));
      rightColors.push(color, clear);
      if (first && !loop) capBegin.push({ pos, edge, feather, dir: firstDir, color, clear });
      if (last && !loop) capEnd.push({ pos, edge, feather, dir: lastDir, color, clear });
    }
    prevDir = segmentDir;
  }
  mesh.strip(center, centerColors);
  if (!antialiased) return;
  mesh.strip(left, leftColors);
  mesh.strip(right, rightColors);
  // Feathered caps: a strip across the end and the two corner quads.
  for (const [cap, sign] of [[capBegin[0], -1], [capEnd[0], 1]]) {
    if (!cap) continue;
    const out = mul(cap.dir, border * sign);
    const a = add(cap.pos, cap.edge);
    const b = sub(cap.pos, cap.edge);
    mesh.quad([a, add(a, out), add(b, out), b], [cap.color, cap.clear, cap.clear, cap.color]);
    mesh.quad([a, add(a, cap.feather), add(add(a, cap.feather), out), add(a, out)], [cap.color, cap.clear, cap.clear, cap.clear]);
    mesh.quad([b, sub(b, cap.feather), add(sub(b, cap.feather), out), add(b, out)], [cap.color, cap.clear, cap.clear, cap.clear]);
  }
}

/** canvas_item_add_circle: 63 rim points (sin, cos) around the centre, fan-indexed, closed. */
export function circle(mesh, lines, center, radius, color, antialiased = false) {
  const base = mesh.vertexCount;
  const step = (Math.PI * 2) / (CIRCLE_SEGMENTS - 1);
  const rim = [];
  for (let i = 0; i < CIRCLE_SEGMENTS - 1; i++) {
    const p = V(center.x + Math.sin(i * step) * radius, center.y + Math.cos(i * step) * radius);
    rim.push(p);
    mesh.vertex(p.x, p.y, color);
  }
  const centreIndex = mesh.vertex(center.x, center.y, color);
  for (let i = 0; i < CIRCLE_SEGMENTS - 2; i++) mesh.indices.push(centreIndex, base + i, base + i + 1);
  mesh.indices.push(centreIndex, base + CIRCLE_SEGMENTS - 2, base);
  if (antialiased) {
    // Feather ring: rim → rim pushed out by the line feather, fading to transparent.
    const clear = transparent(color);
    const ring = [];
    const ringColors = [];
    for (let i = 0; i <= CIRCLE_SEGMENTS - 1; i++) {
      const p = rim[i % (CIRCLE_SEGMENTS - 1)];
      const out = normalized(sub(p, center));
      ring.push(p, add(p, mul(out, LINE_FEATHER * 0.5)));
      ringColors.push(color, clear);
    }
    mesh.strip(ring, ringColors);
  }
}

/** CanvasItem::draw_arc — `pointCount` points on the arc, drawn as a polyline. */
export function arc(mesh, lines, center, radius, startAngle, endAngle, pointCount, color, width = -1, antialiased = false) {
  const delta = Math.min(Math.max(endAngle - startAngle, -Math.PI * 2), Math.PI * 2);
  const points = [];
  for (let i = 0; i < pointCount; i++) {
    const theta = (i / (pointCount - 1)) * delta + startAngle;
    points.push(V(center.x + Math.cos(theta) * radius, center.y + Math.sin(theta) * radius));
  }
  polyline(mesh, lines, points, [color], width, antialiased);
}

/** canvas_item_add_polygon: triangulated (ear clipping); one colour or one per point. */
export function polygon(mesh, points, colors) {
  if (points.length < 3) return;
  const triangles = THREE.ShapeUtils.triangulateShape(points.map((p) => new THREE.Vector2(p.x, p.y)), []);
  if (triangles.length === 0) return;
  const base = mesh.vertexCount;
  points.forEach((p, i) => mesh.vertex(p.x, p.y, colors[Math.min(i, colors.length - 1)]));
  for (const [a, b, c] of triangles) mesh.indices.push(base + a, base + b, base + c);
}

export { V as vec2 };
