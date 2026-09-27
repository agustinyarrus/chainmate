/**
 * CanvasItem and CanvasLayer — the 2D half of Godot's scene tree.
 *
 * A CanvasItem records draw commands (triangle meshes, 1-px lines, glyph runs, textured quads) when
 * redrawn — `queue_redraw()` marks it, the renderer calls `_redraw()` before the frame, which runs the
 * built-in drawing of the class (`_draw_self`) and then the script's `_draw()`, like NOTIFICATION_DRAW.
 * Draw order is tree order inside a CanvasLayer; layers draw by `layer` index.
 *
 * Transforms are 2D affines [a, b, c, d, tx, ty]: x' = a·x + c·y + tx, y' = b·x + d·y + ty.
 */
import { Color } from '../math.js';
import { Node } from '../scene.js';
import { Signal } from '../signal.js';
import { Mesh2D, arc, circle, line, polygon, polyline, rect } from './geometry.js';

export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

export function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return [...IDENTITY];
  const inv = 1 / det;
  return [m[3] * inv, -m[1] * inv, -m[2] * inv, m[0] * inv, (m[2] * m[5] - m[3] * m[4]) * inv, (m[1] * m[4] - m[0] * m[5]) * inv];
}

export const xform = (m, p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

/** Commands recorded by one redraw of an item. */
export class DrawList {
  constructor() {
    this.clear();
  }
  clear() {
    this.mesh = new Mesh2D();
    this.lines = { positions: [], colors: [] };
    /** Ordered segments: {kind:'mesh', start, end} | {kind:'lines', start, end} | {kind:'glyphs', run} | {kind:'texture', …} */
    this.segments = [];
    this._meshStart = 0;
    this._lineStart = 0;
  }
  /** Closes the open mesh/line ranges so later textured commands keep their order. */
  _flushGeometry() {
    const meshEnd = this.mesh.indices.length;
    if (meshEnd > this._meshStart) this.segments.push({ kind: 'mesh', start: this._meshStart, end: meshEnd });
    this._meshStart = meshEnd;
    const lineEnd = this.lines.positions.length / 2;
    if (lineEnd > this._lineStart) this.segments.push({ kind: 'lines', start: this._lineStart, end: lineEnd });
    this._lineStart = lineEnd;
  }
  push(segment) {
    this._flushGeometry();
    this.segments.push(segment);
  }
  finish() {
    this._flushGeometry();
  }
  get empty() {
    return this.segments.length === 0;
  }
}

export class CanvasItem extends Node {
  constructor(name = '') {
    super(name);
    this._visible = true;
    this._modulate = new Color(1, 1, 1, 1);
    this._selfModulate = new Color(1, 1, 1, 1);
    this.z_index = 0;
    this.visibility_changed = new Signal();
    this.draw = new Signal();
    this.drawList = new DrawList();
    this._needsRedraw = true;
    this.clip_contents = false;
  }

  get visible() {
    return this._visible;
  }
  set visible(on) {
    on = Boolean(on);
    if (on === this._visible) return;
    this._visible = on;
    this._visibilityChanged();
  }
  show() {
    this.visible = true;
  }
  hide() {
    this.visible = false;
  }
  is_visible() {
    return this._visible;
  }
  is_visible_in_tree() {
    if (!this._inside) return false;
    for (let node = this; node; node = node.parent) {
      if (node._visible === false) return false;
      if (node instanceof CanvasLayer) return node.visible !== false;
    }
    return true;
  }

  _visibilityChanged() {
    this.queue_redraw();
    this.visibility_changed.emit();
    this._propagateVisibility?.();
  }

  get modulate() {
    return this._modulate.clone();
  }
  set modulate(c) {
    this._modulate = c.clone();
  }
  get self_modulate() {
    return this._selfModulate.clone();
  }
  set self_modulate(c) {
    this._selfModulate = c.clone();
  }

  /** Local transform (Controls compose position, pivot, rotation and scale). */
  get_transform() {
    return IDENTITY;
  }

  /** Transform to canvas-layer space. */
  get_global_transform() {
    let m = this.get_transform();
    for (let node = this.parent; node && node instanceof CanvasItem; node = node.parent) m = multiply(node.get_transform(), m);
    return m;
  }

  queue_redraw() {
    this._needsRedraw = true;
  }

  /** Called by the renderer when marked: built-in drawing, then the script's _draw(). */
  _redraw() {
    this._needsRedraw = false;
    this.drawList.clear();
    this._draw_self?.();
    this._draw?.();
    this.draw.emit();
    this.drawList.finish();
  }

  // ───────────────────────────────────────────────────────────────── draw API (CanvasItem) ──────

  draw_rect(r, color, filled = true, width = -1, antialiased = false) {
    const x = Math.min(r.x, r.x + r.w);
    const y = Math.min(r.y, r.y + r.h);
    const w = Math.abs(r.w);
    const h = Math.abs(r.h);
    const list = this.drawList;
    if (filled) {
      rect(list.mesh, x, y, w, h, color);
    } else if (width >= w || width >= h) {
      rect(list.mesh, x - 0.5 * width, y - 0.5 * width, w + width, h + width, color);
    } else {
      const points = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }];
      polyline(list.mesh, list.lines, points, [color], width, antialiased);
    }
  }

  draw_line(from, to, color, width = -1, antialiased = false) {
    line(this.drawList.mesh, this.drawList.lines, from, to, color, width, antialiased);
  }

  draw_polyline(points, color, width = -1, antialiased = false) {
    polyline(this.drawList.mesh, this.drawList.lines, points, [color], width, antialiased);
  }

  draw_polyline_colors(points, colors, width = -1, antialiased = false) {
    polyline(this.drawList.mesh, this.drawList.lines, points, colors, width, antialiased);
  }

  draw_colored_polygon(points, color) {
    polygon(this.drawList.mesh, points, [color]);
  }

  draw_polygon(points, colors) {
    polygon(this.drawList.mesh, points, colors);
  }

  /** draw_circle(position, radius, color, filled = true, width = -1, antialiased = false) */
  draw_circle(center, radius, color, filled = true, width = -1, antialiased = false) {
    if (filled) circle(this.drawList.mesh, this.drawList.lines, center, radius, color, antialiased);
    else arc(this.drawList.mesh, this.drawList.lines, center, radius, 0, Math.PI * 2, 64, color, width, antialiased);
  }

  draw_arc(center, radius, startAngle, endAngle, pointCount, color, width = -1, antialiased = false) {
    arc(this.drawList.mesh, this.drawList.lines, center, radius, startAngle, endAngle, pointCount, color, width, antialiased);
  }

  draw_style_box(style, r) {
    style.draw(this.drawList.mesh, r);
  }

  /** draw_texture_rect(texture, rect, tile = false, modulate = WHITE) — tiling unsupported (unused). */
  draw_texture_rect(texture, r, _tile = false, modulate = Color.WHITE) {
    this.drawList.push({ kind: 'texture', texture, rect: { ...r }, uv: { x: 0, y: 0, w: 1, h: 1 }, modulate });
  }

  /** Glyph runs are recorded by text-drawing code (Label, Button, …) — see ui/text_draw.js. */
  draw_glyph_run(run) {
    this.drawList.push({ kind: 'glyphs', run });
  }
}

/** CanvasLayer: an independent 2D layer drawn above (layer > 0) the 3D view. */
export class CanvasLayer extends Node {
  constructor(layer = 1) {
    super('CanvasLayer');
    this.layer = layer;
    this.visible = true;
  }
}
