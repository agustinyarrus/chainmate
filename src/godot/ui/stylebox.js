/**
 * StyleBoxes — Godot 4's StyleBox / StyleBoxEmpty / StyleBoxFlat / StyleBoxLine.
 *
 * StyleBoxFlat.draw is a line-by-line port of style_box_flat.cpp: adapted border widths and corner radii,
 * the shadow ring (colour → transparent over shadow_size), the border ring and infill as rounded
 * rectangles of `corner_detail` segments per corner, and geometric antialiasing (only when corners are
 * rounded or skewed) — 1 px feather rings split half inside / half outside each edge.
 * Output goes to a Mesh2D (see geometry.js). O(corner_detail) vertices per ring.
 */
import { Color } from '../math.js';

export const SIDE = Object.freeze({ LEFT: 0, TOP: 1, RIGHT: 2, BOTTOM: 3 });
export const CORNER = Object.freeze({ TOP_LEFT: 0, TOP_RIGHT: 1, BOTTOM_RIGHT: 2, BOTTOM_LEFT: 3 });

export class StyleBox {
  constructor() {
    /** content_margin_left/top/right/bottom; −1 = derive from the style (borders). */
    this.content_margin = [-1, -1, -1, -1];
  }
  get content_margin_left() { return this.content_margin[0]; }
  set content_margin_left(v) { this.content_margin[0] = v; }
  get content_margin_top() { return this.content_margin[1]; }
  set content_margin_top(v) { this.content_margin[1] = v; }
  get content_margin_right() { return this.content_margin[2]; }
  set content_margin_right(v) { this.content_margin[2] = v; }
  get content_margin_bottom() { return this.content_margin[3]; }
  set content_margin_bottom(v) { this.content_margin[3] = v; }

  set_content_margin_all(v) {
    this.content_margin = [v, v, v, v];
  }

  /** Margin used when content_margin is unset. */
  get_style_margin(_side) {
    return 0;
  }

  get_margin(side) {
    return this.content_margin[side] < 0 ? this.get_style_margin(side) : this.content_margin[side];
  }

  /** Size2(left + right, top + bottom). */
  get_minimum_size() {
    return { x: this.get_margin(SIDE.LEFT) + this.get_margin(SIDE.RIGHT), y: this.get_margin(SIDE.TOP) + this.get_margin(SIDE.BOTTOM) };
  }

  /** Point2(left, top). */
  get_offset() {
    return { x: this.get_margin(SIDE.LEFT), y: this.get_margin(SIDE.TOP) };
  }

  /** Draws into `mesh` (a Mesh2D) for the rect (x, y, w, h). */
  draw(_mesh, _rect) {}
}

export class StyleBoxEmpty extends StyleBox {}

export class StyleBoxLine extends StyleBox {
  constructor() {
    super();
    this.color = new Color(0, 0, 0, 1);
    this.thickness = 1;
    this.vertical = false;
    this.grow_begin = 1.0;
    this.grow_end = 1.0;
  }

  draw(mesh, r) {
    const c = this.color;
    let x = r.x;
    let y = r.y;
    let w = r.w;
    let h = r.h;
    if (this.vertical) {
      y -= this.grow_begin;
      h += this.grow_begin + this.grow_end;
      w = this.thickness;
      x += Math.trunc((r.w - this.thickness) / 2);
    } else {
      x -= this.grow_begin;
      w += this.grow_begin + this.grow_end;
      h = this.thickness;
      y += Math.trunc((r.h - this.thickness) / 2);
    }
    const base = mesh.vertexCount;
    mesh.vertex(x, y, c);
    mesh.vertex(x + w, y, c);
    mesh.vertex(x + w, y + h, c);
    mesh.vertex(x, y + h, c);
    mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

const growIndividual = (r, left, top, right, bottom) => ({ x: r.x - left, y: r.y - top, w: r.w + left + right, h: r.h + top + bottom });
const growSide = (r, side, amount) => {
  const g = [0, 0, 0, 0];
  g[side] = amount;
  return growIndividual(r, g[0], g[1], g[2], g[3]);
};
const isZeroApprox = (v) => Math.abs(v) < 1e-5;
const withAlpha = (c, a) => ({ r: c.r, g: c.g, b: c.b, a });

/** adapt_values(): shrink opposite values proportionally when they would overlap. */
function adaptValues(a, b, adapted, values, width, maxA, maxB) {
  if (values[a] + values[b] > width) {
    const factor = width / (values[a] + values[b]);
    let v = values[a] * factor;
    if (v < adapted[a]) adapted[a] = v;
    v = values[b] * factor;
    if (v < adapted[b]) adapted[b] = v;
  } else {
    adapted[a] = Math.min(values[a], adapted[a]);
    adapted[b] = Math.min(values[b], adapted[b]);
  }
  adapted[a] = Math.min(maxA, adapted[a]);
  adapted[b] = Math.min(maxB, adapted[b]);
}

/** set_inner_corner_radius(): corner radius of a rect inset from the style rect. */
function innerCornerRadius(styleRect, innerRect, radius) {
  const left = innerRect.x - styleRect.x;
  const top = innerRect.y - styleRect.y;
  const right = styleRect.w - innerRect.w - left;
  const bottom = styleRect.h - innerRect.h - top;
  return [
    Math.max(radius[0] - Math.min(top, left), 0),
    Math.max(radius[1] - Math.min(top, right), 0),
    Math.max(radius[2] - Math.min(bottom, right), 0),
    Math.max(radius[3] - Math.min(bottom, left), 0),
  ];
}

/**
 * draw_rounded_rectangle(): either a ring between `ringRect` (outer colour) and `innerRect` (inner
 * colour), or — `filled` — the inner rounded rect as vertical stripes.
 */
function roundedRectangle(mesh, styleRect, cornerRadius, ringRect, innerRect, innerColor, outerColor, cornerDetail, skew, filled = false) {
  const vertOffset = mesh.vertexCount;
  const sharp = cornerRadius.every((r) => r === 0);
  const detail = sharp ? 1 : cornerDetail;
  const ringRadius = innerCornerRadius(styleRect, ringRect, cornerRadius);
  const outerPoints = [
    { x: ringRect.x + ringRadius[0], y: ringRect.y + ringRadius[0] },
    { x: ringRect.x + ringRect.w - ringRadius[1], y: ringRect.y + ringRadius[1] },
    { x: ringRect.x + ringRect.w - ringRadius[2], y: ringRect.y + ringRect.h - ringRadius[2] },
    { x: ringRect.x + ringRadius[3], y: ringRect.y + ringRect.h - ringRadius[3] },
  ];
  const innerRadius = innerCornerRadius(styleRect, innerRect, cornerRadius);
  const innerPoints = [
    { x: innerRect.x + innerRadius[0], y: innerRect.y + innerRadius[0] },
    { x: innerRect.x + innerRect.w - innerRadius[1], y: innerRect.y + innerRadius[1] },
    { x: innerRect.x + innerRect.w - innerRadius[2], y: innerRect.y + innerRect.h - innerRadius[2] },
    { x: innerRect.x + innerRadius[3], y: innerRect.y + innerRect.h - innerRadius[3] },
  ];
  const maxInnerOuter = filled ? 1 : 2;
  const centerX = ringRect.x + ringRect.w / 2;
  const centerY = ringRect.y + ringRect.h / 2;
  for (let corner = 0; corner < 4; corner++) {
    for (let d = 0; d <= detail; d++) {
      for (let io = 0; io < maxInnerOuter; io++) {
        const radius = io === 0 ? innerRadius[corner] : ringRadius[corner];
        const color = io === 0 ? innerColor : outerColor;
        const point = io === 0 ? innerPoints[corner] : outerPoints[corner];
        const angle = (corner + d / detail) * (Math.PI / 2) + Math.PI;
        const x = radius * Math.fround(Math.cos(angle)) + point.x;
        const y = radius * Math.fround(Math.sin(angle)) + point.y;
        const xSkew = -skew.x * (y - centerY);
        const ySkew = -skew.y * (x - centerX);
        mesh.vertex(x + xSkew, y + ySkew, color);
      }
    }
  }
  const ringVertCount = mesh.vertexCount - vertOffset;
  if (!filled) {
    for (let i = 0; i < ringVertCount; i++) {
      mesh.indices.push(vertOffset + (i % ringVertCount), vertOffset + ((i + 2) % ringVertCount), vertOffset + ((i + 1) % ringVertCount));
    }
  } else {
    const stripes = ringVertCount / 2 - 1;
    const last = ringVertCount - 1;
    for (let i = 0; i < stripes; i++) {
      mesh.indices.push(vertOffset + i, vertOffset + last - i - 1, vertOffset + i + 1);
      mesh.indices.push(vertOffset + i, vertOffset + last - i, vertOffset + last - 1 - i);
    }
  }
}

export class StyleBoxFlat extends StyleBox {
  constructor() {
    super();
    this.bg_color = new Color(0.6, 0.6, 0.6, 1);
    this.border_color = new Color(0.8, 0.8, 0.8, 1);
    /** left, top, right, bottom */
    this.border_width = [0, 0, 0, 0];
    /** top-left, top-right, bottom-right, bottom-left */
    this.corner_radius = [0, 0, 0, 0];
    this.expand_margin = [0, 0, 0, 0];
    this.corner_detail = 8;
    this.draw_center = true;
    this.border_blend = false;
    this.anti_aliasing = true;
    this.anti_aliasing_size = 1.0;
    this.shadow_color = new Color(0, 0, 0, 0.6);
    this.shadow_size = 0;
    this.shadow_offset = { x: 0, y: 0 };
    this.skew = { x: 0, y: 0 };
  }

  set_border_width_all(width) {
    this.border_width = [width, width, width, width];
  }
  set_corner_radius_all(radius) {
    this.corner_radius = [radius, radius, radius, radius];
  }
  get border_width_left() { return this.border_width[0]; }
  get border_width_top() { return this.border_width[1]; }
  get border_width_right() { return this.border_width[2]; }
  get border_width_bottom() { return this.border_width[3]; }

  get_style_margin(side) {
    return this.border_width[side];
  }

  draw(mesh, rect) {
    const drawBorder = this.border_width.some((w) => w > 0);
    const drawShadow = this.shadow_size > 0;
    if (!drawBorder && !this.draw_center && !drawShadow) return;
    const styleRect = growIndividual(rect, this.expand_margin[0], this.expand_margin[1], this.expand_margin[2], this.expand_margin[3]);
    if (isZeroApprox(styleRect.w) || isZeroApprox(styleRect.h)) return;
    const rounded = this.corner_radius.some((r) => r > 0);
    const skewed = !isZeroApprox(this.skew.x) || !isZeroApprox(this.skew.y);
    const aaOn = (rounded || skewed) && this.anti_aliasing;
    const aaSize = this.anti_aliasing_size;
    const blendOn = this.border_blend && drawBorder;
    const bg = this.bg_color;
    const bc = this.border_color;
    const borderAlpha = withAlpha(bc, 0);
    const borderBlend = this.draw_center ? bg : borderAlpha;
    const borderInner = blendOn ? borderBlend : bc;

    const width = Math.max(styleRect.w, 0);
    const height = Math.max(styleRect.h, 0);
    const adaptedBorder = [1000000, 1000000, 1000000, 1000000];
    adaptValues(SIDE.TOP, SIDE.BOTTOM, adaptedBorder, this.border_width, height, height, height);
    adaptValues(SIDE.LEFT, SIDE.RIGHT, adaptedBorder, this.border_width, width, width, width);
    const adaptedCorner = [1000000, 1000000, 1000000, 1000000];
    const cr = this.corner_radius;
    adaptValues(CORNER.TOP_RIGHT, CORNER.BOTTOM_RIGHT, adaptedCorner, cr, height, height - adaptedBorder[SIDE.BOTTOM], height - adaptedBorder[SIDE.TOP]);
    adaptValues(CORNER.TOP_LEFT, CORNER.BOTTOM_LEFT, adaptedCorner, cr, height, height - adaptedBorder[SIDE.BOTTOM], height - adaptedBorder[SIDE.TOP]);
    adaptValues(CORNER.TOP_LEFT, CORNER.TOP_RIGHT, adaptedCorner, cr, width, width - adaptedBorder[SIDE.RIGHT], width - adaptedBorder[SIDE.LEFT]);
    adaptValues(CORNER.BOTTOM_LEFT, CORNER.BOTTOM_RIGHT, adaptedCorner, cr, width, width - adaptedBorder[SIDE.RIGHT], width - adaptedBorder[SIDE.LEFT]);

    const infill = growIndividual(styleRect, -adaptedBorder[SIDE.LEFT], -adaptedBorder[SIDE.TOP], -adaptedBorder[SIDE.RIGHT], -adaptedBorder[SIDE.BOTTOM]);
    let borderStyleRect = styleRect;
    if (aaOn) {
      for (let i = 0; i < 4; i++) if (this.border_width[i] > 0) borderStyleRect = growSide(borderStyleRect, i, -aaSize);
    }
    const detail = this.corner_detail;
    const skew = this.skew;

    if (drawShadow) {
      const inner = { ...styleRect, x: styleRect.x + this.shadow_offset.x, y: styleRect.y + this.shadow_offset.y };
      const outer = growIndividual(styleRect, this.shadow_size, this.shadow_size, this.shadow_size, this.shadow_size);
      outer.x += this.shadow_offset.x;
      outer.y += this.shadow_offset.y;
      const clear = withAlpha(this.shadow_color, 0);
      roundedRectangle(mesh, inner, adaptedCorner, outer, inner, this.shadow_color, clear, detail, skew);
      if (this.draw_center) roundedRectangle(mesh, inner, adaptedCorner, inner, inner, this.shadow_color, this.shadow_color, detail, skew, true);
    }
    if (drawBorder && !aaOn) roundedRectangle(mesh, borderStyleRect, adaptedCorner, borderStyleRect, infill, borderInner, bc, detail, skew);
    if (this.draw_center && (!aaOn || blendOn)) roundedRectangle(mesh, borderStyleRect, adaptedCorner, infill, infill, bg, bg, detail, skew, true);

    if (aaOn) {
      const aaBorder = [0, 0, 0, 0];
      const aaBorderHalf = [0, 0, 0, 0];
      const aaFill = [0, 0, 0, 0];
      const aaFillHalf = [0, 0, 0, 0];
      for (let i = 0; i < 4; i++) {
        if (drawBorder && this.border_width[i] > 0) {
          aaBorder[i] = aaSize;
          aaBorderHalf[i] = aaSize / 2;
        } else {
          aaFill[i] = aaSize;
          aaFillHalf[i] = aaSize / 2;
        }
      }
      if (this.draw_center) {
        const fillTransparent = growIndividual(infill, aaFillHalf[0], aaFillHalf[1], aaFillHalf[2], aaFillHalf[3]);
        const fillColored = growIndividual(fillTransparent, -aaFill[0], -aaFill[1], -aaFill[2], -aaFill[3]);
        if (!blendOn) roundedRectangle(mesh, borderStyleRect, adaptedCorner, fillColored, fillColored, bg, bg, detail, skew, true);
        if (!blendOn || !drawBorder) roundedRectangle(mesh, borderStyleRect, adaptedCorner, fillTransparent, fillColored, bg, withAlpha(bg, 0), detail, skew);
      }
      if (drawBorder) {
        const innerColored = growIndividual(infill, aaBorderHalf[0], aaBorderHalf[1], aaBorderHalf[2], aaBorderHalf[3]);
        const innerTransparent = growIndividual(innerColored, -aaBorder[0], -aaBorder[1], -aaBorder[2], -aaBorder[3]);
        const outerTransparent = growIndividual(styleRect, aaBorderHalf[0], aaBorderHalf[1], aaBorderHalf[2], aaBorderHalf[3]);
        const outerColored = growIndividual(borderStyleRect, aaBorderHalf[0], aaBorderHalf[1], aaBorderHalf[2], aaBorderHalf[3]);
        roundedRectangle(mesh, borderStyleRect, adaptedCorner, outerColored, innerColored, borderInner, bc, detail, skew);
        if (!blendOn) roundedRectangle(mesh, borderStyleRect, adaptedCorner, innerColored, innerTransparent, borderBlend, bc, detail, skew);
        roundedRectangle(mesh, borderStyleRect, adaptedCorner, outerTransparent, outerColored, bc, borderAlpha, detail, skew);
      }
    }
  }
}
