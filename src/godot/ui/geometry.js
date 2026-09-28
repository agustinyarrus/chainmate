/**
 * Canvas geometry exactly as Godot 4.7's RendererCanvasCull / CanvasItem build it, so 2D shapes
 * rasterise to the same pixels: every primitive becomes triangles with per-vertex colours
 * (antialiasing is geometric — feather strips fading to transparent — never MSAA), or a 1-px line
 * list for "thin" draws. Ported from servers/rendering/renderer_canvas_cull.cpp:
 *
 *   rect       canvas_item_add_rect        antialiased: shrunk by FEATHER/4, feathered sides + corners
 *   line       canvas_item_add_line        antialiased: compensated width, feathered sides + corners
 *   polyline   canvas_item_add_polyline    clamped-miter strip; antialiased: side strips + end caps
 *   ellipse    canvas_item_add_ellipse     64 segments around the centre; antialiased: feather ring
 *   arc        CanvasItem::draw_ellipse_arc  points on the arc → polyline
 *   polygon    canvas_item_add_polygon     triangulated
 *
 * Vector arithmetic is single precision like the engine's (Math.fround at every step), so vertices
 * that fall on pixel centres tie the same way. All builders are O(points).
 */
import * as THREE from 'three';

export const FEATHER_SIZE = 1.25;
export const ELLIPSE_SEGMENTS = 64;
const CMP_EPSILON = 0.00001;
const MITER_LIMIT = 3.0;
const F = Math.fround;

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

// ─────────────────────────────────────────────────────────────── Vector2 (real_t = float) ──────

const V = (x, y) => ({ x: F(x), y: F(y) });
const add = (a, b) => V(a.x + b.x, a.y + b.y);
const sub = (a, b) => V(a.x - b.x, a.y - b.y);
const mul = (a, k) => V(a.x * F(k), a.y * F(k));
const neg = (a) => V(-a.x, -a.y);
const dot = (a, b) => F(F(a.x * b.x) + F(a.y * b.y));
const cross = (a, b) => F(F(a.x * b.y) - F(a.y * b.x));
const length = (a) => F(Math.sqrt(F(F(a.x * a.x) + F(a.y * a.y))));
/** Vector2::normalized(): zero stays zero. */
function normalized(a) {
  const squared = F(F(a.x * a.x) + F(a.y * a.y));
  if (squared === 0) return V(0, 0);
  const l = F(Math.sqrt(squared));
  return V(a.x / l, a.y / l);
}
/** Vector2::orthogonal(): (y, −x). */
const orthogonal = (a) => V(a.y, -a.x);
const isZeroApprox = (x) => Math.abs(x) < CMP_EPSILON;
const vectorIsZeroApprox = (a) => isZeroApprox(a.x) && isZeroApprox(a.y);
/** Math::is_equal_approx(float, float): relative tolerance. */
function isEqualApprox(a, b) {
  if (a === b) return true;
  const tolerance = Math.max(F(CMP_EPSILON * Math.abs(a)), CMP_EPSILON);
  return Math.abs(a - b) < tolerance;
}
const vectorIsEqualApprox = (a, b) => isEqualApprox(a.x, b.x) && isEqualApprox(a.y, b.y);
const transparent = (c) => ({ r: c.r, g: c.g, b: c.b, a: 0 });
const WHITE = Object.freeze({ r: 1, g: 1, b: 1, a: 1 });

/** Math::remap */
const remap = (value, inStart, inStop, outStart, outStop) => F(outStart + F((outStop - outStart) * F((value - inStart) / (inStop - inStart))));

/**
 * canvas_item_get_compensated_antialiasing_width: antialiased lines are drawn thinner, since their
 * feathers add visible width (half the width up to 2.5 px, a constant 0.625 px less above 5 px).
 */
export function compensatedWidth(width) {
  if (width <= 0) return width;
  if (width <= FEATHER_SIZE * 2 + CMP_EPSILON) return F(width * 0.5);
  if (width <= FEATHER_SIZE * 4 + CMP_EPSILON) return remap(width, FEATHER_SIZE * 2, FEATHER_SIZE * 4, F(width * 0.5), F(width - FEATHER_SIZE * 0.5));
  return F(width - FEATHER_SIZE * 0.5);
}

/** The eight feather primitives shared by antialiased lines and rectangles. */
function feathers(mesh, beginLeft, beginRight, endLeft, endRight, border, border2, color) {
  const clear = transparent(color);
  mesh.quad([beginLeft, add(beginLeft, border), add(endLeft, border), endLeft], [color, clear, clear, color]);
  mesh.quad([beginRight, sub(beginRight, border), sub(endRight, border), endRight], [color, clear, clear, color]);
  mesh.quad([beginLeft, add(beginLeft, border2), add(beginRight, border2), beginRight], [color, clear, clear, color]);
  mesh.quad([endLeft, sub(endLeft, border2), sub(endRight, border2), endRight], [color, clear, clear, color]);
  mesh.quad([beginLeft, add(beginLeft, border2), add(add(beginLeft, border), border2), add(beginLeft, border)], [color, clear, clear, clear]);
  mesh.quad([beginRight, add(beginRight, border2), add(sub(beginRight, border), border2), sub(beginRight, border)], [color, clear, clear, clear]);
  mesh.quad([endLeft, sub(endLeft, border2), sub(add(endLeft, border), border2), add(endLeft, border)], [color, clear, clear, clear]);
  mesh.quad([endRight, sub(endRight, border2), sub(sub(endRight, border), border2), sub(endRight, border)], [color, clear, clear, clear]);
}

/** canvas_item_add_rect */
export function rect(mesh, x, y, w, h, color, antialiased = false) {
  if (!antialiased) {
    mesh.quad([V(x, y), V(x + w, y), V(x + w, y + h), V(x, y + h)], [color, color, color, color]);
    return;
  }
  // Rect2::grow(-FEATHER_SIZE / 4): the feathers give the rectangle its size back.
  const grow = F(-FEATHER_SIZE * 0.25);
  const px = F(x - grow);
  const py = F(y - grow);
  const sw = F(w + grow * 2);
  const sh = F(h + grow * 2);
  mesh.quad([V(px, py), V(px + sw, py), V(px + sw, py + sh), V(px, py + sh)], [color, color, color, color]);
  let borderSize = FEATHER_SIZE;
  const size = Math.min(sw, sh);
  if (size >= 0 && size < 1) borderSize = F(borderSize * size);
  const beginLeft = V(px, py);
  const beginRight = V(px, py + sh);
  const endLeft = V(px + sw, py);
  const endRight = V(px + sw, py + sh);
  feathers(mesh, beginLeft, beginRight, endLeft, endRight, V(0, -borderSize), V(-borderSize, 0), color);
}

/** canvas_item_add_line. width < 0 → a 1-px primitive line. */
export function line(mesh, lines, from, to, color, width = -1, antialiased = false) {
  const a = V(from.x, from.y);
  const b = V(to.x, to.y);
  if (antialiased) width = compensatedWidth(width);
  if (width < 0) {
    lines.positions.push(a.x, a.y, b.x, b.y);
    lines.colors.push(color.r, color.g, color.b, color.a, color.r, color.g, color.b, color.a);
    return;
  }
  const diff = sub(a, b);
  const dir = normalized(orthogonal(diff));
  const t = mul(mul(dir, width), 0.5);
  const beginLeft = add(a, t);
  const beginRight = sub(a, t);
  const endLeft = add(b, t);
  const endRight = sub(b, t);
  mesh.quad([beginLeft, beginRight, endRight, endLeft], [color, color, color, color]);
  if (!antialiased) return;
  let borderSize = FEATHER_SIZE;
  if (width >= 0 && width < 1) borderSize = F(borderSize * width);
  feathers(mesh, beginLeft, beginRight, endLeft, endRight, mul(dir, borderSize), mul(normalized(diff), borderSize), color);
}

/** canvas_item_add_multiline: independent segments (points in pairs). */
export function multiline(mesh, lines, points, colors, width = -1, antialiased = false) {
  for (let i = 0; i + 1 < points.length; i += 2) {
    const color = colors.length === 1 ? colors[0] : colors[i >> 1];
    if (width < 0) line(mesh, lines, points[i], points[i + 1], color, -1, false);
    else line(mesh, lines, points[i], points[i + 1], color, width, antialiased);
  }
}

function segmentDirection(points, index, previous) {
  if (index === points.length - 1) return previous;
  const direction = normalized(sub(points[index + 1], points[index]));
  return vectorIsZeroApprox(direction) ? previous : direction;
}

/** compute_polyline_edge_offset_clamped: the miter at a joint, at most 3 half-widths long. */
function edgeOffsetClamped(segmentDir, previousDir) {
  let bisector = normalized(sub(mul(previousDir, length(segmentDir)), mul(segmentDir, length(previousDir))));
  let scale = 1.0;
  const angle = F(Math.atan2(cross(bisector, previousDir), dot(bisector, previousDir)));
  const sine = F(Math.sin(angle));
  if (!isZeroApprox(sine) && !vectorIsEqualApprox(segmentDir, previousDir)) {
    scale = Math.min(Math.max(F(1.0 / sine), -MITER_LIMIT), MITER_LIMIT);
  } else {
    bisector = orthogonal(segmentDir);
  }
  if (vectorIsZeroApprox(bisector)) bisector = orthogonal(segmentDir);
  return mul(bisector, scale);
}

/**
 * canvas_item_add_polyline. width < 0 → line strip. Otherwise a triangle strip with clamped miters;
 * with antialiasing, the width is compensated and two feather strips run along the sides, with
 * feathered caps at both ends of an open polyline.
 */
export function polyline(mesh, lines, rawPoints, colors, width = -1, antialiased = false) {
  const count = rawPoints.length;
  if (count < 2) return;
  const points = rawPoints.map((p) => V(p.x, p.y));
  if (antialiased) width = compensatedWidth(width);
  if (width < 0) {
    let color = WHITE;
    for (let i = 0; i + 1 < count; i++) {
      const from = i < colors.length ? colors[i] : colors.length ? colors[colors.length - 1] : color;
      const to = i + 1 < colors.length ? colors[i + 1] : from;
      color = to;
      lines.positions.push(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
      lines.colors.push(from.r, from.g, from.b, from.a, to.r, to.g, to.b, to.a);
    }
    return;
  }
  const loop = vectorIsEqualApprox(points[0], points[count - 1]);
  let firstDir = V(0, 0);
  for (let i = 1; i < count; i++) {
    firstDir = normalized(sub(points[i], points[i - 1]));
    if (!vectorIsZeroApprox(firstDir)) break;
  }
  let lastDir = V(0, 0);
  for (let i = count - 1; i >= 1; i--) {
    lastDir = normalized(sub(points[i], points[i - 1]));
    if (!vectorIsZeroApprox(lastDir)) break;
  }
  const capped = antialiased && !loop;
  const lead = capped ? 2 : 0;
  const middle = new Array(count * 2 + (capped ? 4 : 0));
  const middleColors = new Array(middle.length);
  const left = antialiased ? new Array(count * 2 + (loop ? 0 : 5)) : null;
  const leftColors = antialiased ? new Array(left.length) : null;
  const right = antialiased ? new Array(count * 2 + (loop ? 0 : 5)) : null;
  const rightColors = antialiased ? new Array(right.length) : null;
  let borderSize = FEATHER_SIZE;
  if (antialiased && width < 1) borderSize = F(borderSize * width);
  let color = WHITE;
  let clear = transparent(WHITE);
  let previousDir = V(0, 0);
  for (let i = 0; i < count; i++) {
    const first = i === 0;
    const last = i === count - 1;
    const direction = segmentDirection(points, i, previousDir);
    if (first && loop) previousDir = lastDir;
    else if (last && loop) previousDir = firstDir;
    let base;
    if (first && !loop) base = orthogonal(firstDir);
    else if (last && !loop) base = orthogonal(lastDir);
    else base = edgeOffsetClamped(direction, previousDir);
    const edge = mul(base, F(width * 0.5));
    const position = points[i];
    if (i < colors.length) {
      color = colors[i];
      clear = transparent(color);
    }
    const j = i * 2 + lead;
    middle[j] = add(position, edge);
    middle[j + 1] = sub(position, edge);
    middleColors[j] = color;
    middleColors[j + 1] = color;
    if (antialiased) {
      const border = mul(base, borderSize);
      left[j] = add(position, edge);
      left[j + 1] = add(add(position, edge), border);
      right[j] = sub(position, edge);
      right[j + 1] = sub(sub(position, edge), border);
      leftColors[j] = color;
      leftColors[j + 1] = clear;
      rightColors[j] = color;
      rightColors[j + 1] = clear;
      if (first && !loop) {
        const begin = mul(neg(direction), borderSize);
        middle[0] = add(add(position, edge), begin);
        middle[1] = add(sub(position, edge), begin);
        middleColors[0] = clear;
        middleColors[1] = clear;
        left[0] = add(add(position, edge), begin);
        left[1] = add(add(add(position, edge), begin), border);
        leftColors[0] = clear;
        leftColors[1] = clear;
        right[0] = add(sub(position, edge), begin);
        right[1] = sub(add(sub(position, edge), begin), border);
        rightColors[0] = clear;
        rightColors[1] = clear;
      }
      if (last && !loop) {
        const end = mul(previousDir, borderSize);
        const at = count * 2 + 2;
        middle[at] = add(add(position, edge), end);
        middle[at + 1] = add(sub(position, edge), end);
        middleColors[at] = clear;
        middleColors[at + 1] = clear;
        // Back to the edge corner, so the seam of the end corner's quad starts there.
        left[at] = add(position, edge);
        left[at + 1] = add(add(add(position, edge), end), border);
        left[at + 2] = add(add(position, edge), end);
        leftColors[at] = color;
        leftColors[at + 1] = clear;
        leftColors[at + 2] = clear;
        right[at] = sub(position, edge);
        right[at + 1] = sub(add(sub(position, edge), end), border);
        right[at + 2] = add(sub(position, edge), end);
        rightColors[at] = color;
        rightColors[at + 1] = clear;
        rightColors[at + 2] = clear;
      }
    }
    previousDir = direction;
  }
  // Command order of the engine: the feather strips are allocated before the middle strip is filled,
  // but the middle strip's command comes first.
  mesh.strip(middle, middleColors);
  if (antialiased) {
    mesh.strip(left, leftColors);
    mesh.strip(right, rightColors);
  }
}

/** canvas_item_add_ellipse: 64 segments fanned around the centre; feather ring when antialiased. */
export function ellipse(mesh, center, majorRadius, minorRadius, color, antialiased = false) {
  let major = F(majorRadius);
  let minor = F(minorRadius);
  if (antialiased) {
    major = Math.max(0, F(major - FEATHER_SIZE * 0.25));
    minor = Math.max(0, F(minor - FEATHER_SIZE * 0.25));
  }
  const step = F((Math.PI * 2) / ELLIPSE_SEGMENTS);
  const cosines = new Array(ELLIPSE_SEGMENTS + 1);
  const sines = new Array(ELLIPSE_SEGMENTS + 1);
  for (let i = 0; i <= ELLIPSE_SEGMENTS; i++) {
    const angle = F(i * step);
    cosines[i] = F(Math.cos(angle));
    sines[i] = F(Math.sin(angle));
  }
  const base = mesh.vertexCount;
  for (let i = 0; i <= ELLIPSE_SEGMENTS; i++) mesh.vertex(F(F(cosines[i] * major) + center.x), F(F(sines[i] * minor) + center.y), color);
  const centre = mesh.vertex(F(center.x), F(center.y), color);
  for (let i = 0; i < ELLIPSE_SEGMENTS; i++) mesh.indices.push(centre, base + i, base + i + 1);
  if (!antialiased) return;
  let borderSize = FEATHER_SIZE;
  const maxAxis = F(Math.max(major, minor) * 2);
  if (maxAxis >= 0 && maxAxis < 1) borderSize = F(borderSize * F(maxAxis * 0.5));
  const clear = transparent(color);
  const ring = [];
  const ringColors = [];
  for (let i = 0; i <= ELLIPSE_SEGMENTS; i++) {
    ring.push(V(F(cosines[i] * major) + center.x, F(sines[i] * minor) + center.y));
    ring.push(V(F(cosines[i] * F(major + borderSize)) + center.x, F(sines[i] * F(minor + borderSize)) + center.y));
    ringColors.push(color, clear);
  }
  mesh.strip(ring, ringColors);
}

/** CanvasItem::draw_ellipse for outlines: 64 points on the rim, closed, as a polyline. */
export function ellipseOutline(mesh, lines, center, major, minor, color, width, antialiased = false) {
  const step = F((Math.PI * 2) / ELLIPSE_SEGMENTS);
  const points = new Array(ELLIPSE_SEGMENTS + 1);
  for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
    const angle = F(i * step);
    points[i] = V(F(F(Math.cos(angle)) * F(major)) + center.x, F(F(Math.sin(angle)) * F(minor)) + center.y);
  }
  points[ELLIPSE_SEGMENTS] = points[0];
  polyline(mesh, lines, points, [color], width, antialiased);
}

/** CanvasItem::draw_ellipse_arc — `pointCount` points on the arc, drawn as a polyline. */
export function arc(mesh, lines, center, radius, startAngle, endAngle, pointCount, color, width = -1, antialiased = false) {
  const tau = Math.PI * 2;
  const delta = F(Math.min(Math.max(F(endAngle - startAngle), -tau), tau));
  const points = new Array(pointCount);
  for (let i = 0; i < pointCount; i++) {
    const theta = F(F(F(i / F(pointCount - 1.0)) * delta) + F(startAngle));
    points[i] = V(center.x + F(F(radius) * F(Math.cos(theta))), center.y + F(F(radius) * F(Math.sin(theta))));
  }
  polyline(mesh, lines, points, [color], width, antialiased);
}

/** canvas_item_add_polygon: triangulated; one colour or one per point. */
export function polygon(mesh, points, colors) {
  if (points.length < 3) return;
  const triangles = THREE.ShapeUtils.triangulateShape(points.map((p) => new THREE.Vector2(p.x, p.y)), []);
  if (triangles.length === 0) return;
  const base = mesh.vertexCount;
  points.forEach((p, i) => mesh.vertex(F(p.x), F(p.y), colors[Math.min(i, colors.length - 1)]));
  for (const [a, b, c] of triangles) mesh.indices.push(base + a, base + b, base + c);
}

export { V as vec2 };
