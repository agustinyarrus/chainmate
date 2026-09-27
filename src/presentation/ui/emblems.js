/**
 * Emblems — port of scripts/presentation/ui/emblems.gd (flat chess silhouettes for portraits and
 * cards) and glyph.gd (the small Glyph control: coin, tempo diamond or a piece silhouette).
 */
import { Color, PI, TAU } from '../../godot/math.js';
import { Control, MOUSE_FILTER, SIZE } from '../../godot/ui/control.js';
import { Palette } from '../palette.js';

const V = (x, y) => ({ x, y });
const p = (c, r, u) => V(c.x + u.x * r, c.y + u.y * r);

function poly(canvas, c, r, unitPoints, color, filled = true, width = 2.0) {
  const points = unitPoints.map((u) => p(c, r, u));
  if (filled) canvas.draw_colored_polygon(points, color);
  else canvas.draw_polyline(points, color, width, true);
}

function rect(canvas, c, r, x, y, w, h, color) {
  const at = p(c, r, V(x, y));
  canvas.draw_rect({ x: at.x, y: at.y, w: w * r, h: h * r }, color);
}

const base = (canvas, c, r, color) => rect(canvas, c, r, -0.52, 0.55, 1.04, 0.22, color);

export class Emblems {
  static draw_piece(canvas, kind, center, radius, color) {
    Emblems.draw_shape(canvas, kind, center, radius, color);
  }

  static draw_shape(canvas, shape, c, r, color) {
    switch (shape) {
      case 'pawn':
        base(canvas, c, r, color);
        poly(canvas, c, r, [V(-0.16, -0.2), V(0.16, -0.2), V(0.32, 0.55), V(-0.32, 0.55)], color);
        canvas.draw_circle(p(c, r, V(0, -0.42)), r * 0.28, color);
        break;
      case 'rook':
        base(canvas, c, r, color);
        poly(canvas, c, r, [V(-0.3, -0.3), V(0.3, -0.3), V(0.38, 0.55), V(-0.38, 0.55)], color);
        for (const x of [-0.45, -0.11, 0.23]) rect(canvas, c, r, x, -0.72, 0.22, 0.46, color);
        rect(canvas, c, r, -0.45, -0.4, 0.9, 0.14, color);
        break;
      case 'bishop': {
        base(canvas, c, r, color);
        poly(canvas, c, r, [V(-0.16, 0.0), V(0.16, 0.0), V(0.3, 0.55), V(-0.3, 0.55)], color);
        const mitre = [];
        for (let i = 0; i < 16; i++) {
          const a = PI * 0.5 + (TAU * i) / 16.0;
          mitre.push(V(Math.cos(a) * 0.3, -0.32 + Math.sin(a) * 0.36));
        }
        mitre[8] = V(0, -0.82);
        poly(canvas, c, r, mitre, color);
        canvas.draw_circle(p(c, r, V(0, -0.9)), r * 0.09, color);
        break;
      }
      case 'knight':
        base(canvas, c, r, color);
        poly(canvas, c, r, [
          V(0.36, 0.55), V(-0.3, 0.55), V(-0.22, 0.18), V(-0.02, -0.06),
          V(-0.42, 0.04), V(-0.58, -0.14), V(-0.22, -0.52), V(-0.02, -0.82),
          V(0.1, -0.62), V(0.3, -0.54), V(0.44, -0.2), V(0.46, 0.2),
        ], color);
        break;
      case 'queen':
        base(canvas, c, r, color);
        poly(canvas, c, r, [V(-0.2, -0.2), V(0.2, -0.2), V(0.34, 0.55), V(-0.34, 0.55)], color);
        poly(canvas, c, r, [V(-0.42, -0.58), V(0.42, -0.58), V(0.24, -0.2), V(-0.24, -0.2)], color);
        for (let i = 0; i < 5; i++) {
          const x = -0.42 + 0.21 * i;
          canvas.draw_circle(p(c, r, V(x, -0.68 - (i === 2 ? 0.08 : 0.0))), r * 0.09, color);
        }
        break;
      case 'king':
        base(canvas, c, r, color);
        poly(canvas, c, r, [V(-0.2, -0.2), V(0.2, -0.2), V(0.34, 0.55), V(-0.34, 0.55)], color);
        poly(canvas, c, r, [V(-0.38, -0.52), V(0.38, -0.52), V(0.24, -0.2), V(-0.24, -0.2)], color);
        rect(canvas, c, r, -0.06, -0.98, 0.12, 0.46, color);
        rect(canvas, c, r, -0.2, -0.86, 0.4, 0.12, color);
        break;
      default:
        console.error(`Emblems: no shape named '${shape}'`);
    }
  }
}

export class Glyph extends Control {
  constructor() {
    super('Glyph');
    this.shape = 'coin';
    this.color = Palette.GOLD;
    this.filled = true;
  }

  static make(shapeName, size = 18.0, tint = Palette.GOLD, isFilled = true) {
    const glyph = new Glyph();
    glyph.shape = shapeName;
    glyph.color = tint;
    glyph.filled = isFilled;
    glyph.custom_minimum_size = { x: size, y: size };
    glyph.mouse_filter = MOUSE_FILTER.IGNORE;
    glyph.size_flags_vertical = SIZE.SHRINK_CENTER;
    return glyph;
  }

  set_filled(on) {
    this.filled = on;
    this.queue_redraw();
  }

  _draw() {
    const size = this.size;
    const center = V(size.x * 0.5, size.y * 0.5);
    const r = Math.min(size.x, size.y) * 0.5;
    switch (this.shape) {
      case 'coin':
        this.draw_circle(center, r, this.color.darkened(0.35));
        this.draw_circle(center, r * 0.82, this.color);
        this.draw_arc(center, r * 0.55, 0, TAU, 24, this.color.darkened(0.3), Math.max(1.0, r * 0.14), true);
        break;
      case 'tempo': {
        const points = [V(center.x, center.y - r), V(center.x + r * 0.72, center.y), V(center.x, center.y + r), V(center.x - r * 0.72, center.y)];
        if (this.filled) this.draw_colored_polygon(points, this.color);
        else this.draw_polyline([...points, points[0]], new Color(this.color, 0.45), Math.max(1.0, r * 0.16), true);
        break;
      }
      default:
        Emblems.draw_piece(this, this.shape, center, r, this.color);
    }
  }
}
