/**
 * Icons — port of scripts/presentation/ui/icons.gd: every relic, upgrade and map-node icon, drawn with
 * canvas primitives in unit coordinates (centre c, radius r), exactly as the original composes them.
 */
import { Color, PI, TAU, lerpf } from '../../godot/math.js';

const GOLD = new Color('e0ad55');
const GOLD_DARK = new Color('8a5a22');
const GOLD_LIGHT = new Color('ffe6a6');
const BLUE = new Color('4f8dff');
const BLUE_DARK = new Color('1e3f8a');
const BLUE_LIGHT = new Color('bcd6ff');
const LEATHER = new Color('7a3b2a');
const LEATHER_DARK = new Color('3d1c14');
const PARCHMENT = new Color('e9dcb8');
const STEEL = new Color('b9c2cf');
const STEEL_DARK = new Color('59616e');
const RED = new Color('d0453a');
const GREEN = new Color('6fb04a');
const INK_DARK = new Color('141a24');

const V = (x, y) => ({ x, y });
const p = (c, r, u) => V(c.x + u.x * r, c.y + u.y * r);
const addv = (a, b) => V(a.x + b.x, a.y + b.y);

function poly(canvas, c, r, points, color) {
  canvas.draw_colored_polygon(points.map((u) => p(c, r, u)), color);
}
function line(canvas, c, r, points, color, width) {
  canvas.draw_polyline(points.map((u) => p(c, r, u)), color, Math.max(1.0, width * r), true);
}
function circle(canvas, c, r, at, radius, color) {
  canvas.draw_circle(p(c, r, at), radius * r, color);
}
function shadow(canvas, c, r) {
  const points = [];
  for (let i = 0; i < 20; i++) {
    const a = (TAU * i) / 20.0;
    points.push(V(c.x + Math.cos(a) * 0.72 * r, c.y + (0.86 + Math.sin(a) * 0.12) * r));
  }
  canvas.draw_colored_polygon(points, new Color(0, 0, 0, 0.35));
}

export class Icons {
  static draw(canvas, icon, c, r) {
    const fn = DRAWERS[icon];
    if (!fn) {
      console.error(`Icons: no icon named '${icon}'`);
      return;
    }
    fn(canvas, c, r);
  }
}

function coin(canvas, c, r) {
  shadow(canvas, c, r);
  circle(canvas, c, r, V(0.06, 0.06), 0.74, GOLD_DARK);
  circle(canvas, c, r, V(0, 0), 0.74, GOLD);
  circle(canvas, c, r, V(0, 0), 0.56, GOLD_DARK.lerp(GOLD, 0.55));
  circle(canvas, c, r, V(-0.04, -0.04), 0.5, GOLD);
  star(canvas, V(c.x, c.y + 0.02 * r), r * 0.42, GOLD_LIGHT, GOLD_DARK, Color.WHITE);
  canvas.draw_arc(p(c, r, V(-0.12, -0.12)), 0.62 * r, PI * 1.05, PI * 1.5, 12, new Color(1, 1, 1, 0.55), Math.max(1.0, 0.07 * r), true);
}

function tome(canvas, c, r) {
  shadow(canvas, c, r);
  poly(canvas, c, r, [V(-0.62, -0.72), V(0.56, -0.8), V(0.66, 0.7), V(-0.52, 0.78)], LEATHER_DARK);
  poly(canvas, c, r, [V(-0.56, -0.78), V(0.6, -0.86), V(0.7, 0.62), V(-0.46, 0.7)], LEATHER);
  poly(canvas, c, r, [V(0.6, -0.86), V(0.7, -0.8), V(0.8, 0.66), V(0.7, 0.62)], PARCHMENT);
  poly(canvas, c, r, [V(-0.3, -0.36), V(0.34, -0.42), V(0.38, 0.2), V(-0.26, 0.26)], new Color(GOLD, 0.25));
  line(canvas, c, r, [V(-0.3, -0.36), V(0.34, -0.42), V(0.38, 0.2), V(-0.26, 0.26), V(-0.3, -0.36)], GOLD, 0.06);
  circle(canvas, c, r, V(0.03, -0.08), 0.12, GOLD_LIGHT);
}

function laurel(canvas, c, r) {
  for (const side of [-1.0, 1.0]) {
    for (let i = 0; i < 6; i++) {
      const t = i / 5.0;
      const a = lerpf(PI * 0.62, PI * 1.35, t);
      const at = V(Math.cos(a) * 0.62 * side, Math.sin(a) * 0.7 + 0.05);
      const leaf = [addv(at, V(0, -0.2)), addv(at, V(0.13 * side, 0)), addv(at, V(0, 0.14)), addv(at, V(-0.1 * side, 0))];
      poly(canvas, c, r, leaf, i % 2 === 0 ? GREEN.darkened(0.35) : GREEN);
    }
    line(canvas, c, r, [V(0.62 * side * Math.cos(PI * 0.62), 0.7 * Math.sin(PI * 0.62)), V(0.2 * side, 0.82)], GREEN.darkened(0.5), 0.05);
  }
  poly(canvas, c, r, [V(-0.18, 0.72), V(0.18, 0.72), V(0.1, 0.9), V(-0.1, 0.9)], GOLD);
}

function shield(canvas, c, r) {
  shadow(canvas, c, r);
  poly(canvas, c, r, [V(-0.66, -0.7), V(0.66, -0.7), V(0.6, 0.1), V(0, 0.86), V(-0.6, 0.1)], STEEL_DARK);
  poly(canvas, c, r, [V(-0.54, -0.6), V(0.54, -0.6), V(0.48, 0.06), V(0, 0.72), V(-0.48, 0.06)], STEEL);
  poly(canvas, c, r, [V(0, -0.6), V(0.54, -0.6), V(0.48, 0.06), V(0, 0.72)], STEEL.darkened(0.2));
  poly(canvas, c, r, [V(-0.08, -0.45), V(0.08, -0.45), V(0.08, 0.5), V(-0.08, 0.5)], BLUE);
  poly(canvas, c, r, [V(-0.4, -0.14), V(0.4, -0.14), V(0.4, 0.02), V(-0.4, 0.02)], BLUE);
}

function crown(canvas, c, r) {
  shadow(canvas, c, r);
  poly(canvas, c, r, [V(-0.72, 0.5), V(-0.72, -0.3), V(-0.36, 0.02), V(0, -0.5), V(0.36, 0.02), V(0.72, -0.3), V(0.72, 0.5)], GOLD);
  poly(canvas, c, r, [V(0, -0.5), V(0.36, 0.02), V(0.72, -0.3), V(0.72, 0.5), V(0, 0.5)], GOLD_DARK.lerp(GOLD, 0.5));
  poly(canvas, c, r, [V(-0.72, 0.34), V(0.72, 0.34), V(0.72, 0.56), V(-0.72, 0.56)], GOLD_DARK);
  for (const x of [-0.72, 0.0, 0.72]) circle(canvas, c, r, V(x, x !== 0.0 ? -0.4 : -0.6), 0.1, GOLD_LIGHT);
  circle(canvas, c, r, V(0, 0.14), 0.12, RED);
  circle(canvas, c, r, V(-0.4, 0.2), 0.08, BLUE);
  circle(canvas, c, r, V(0.4, 0.2), 0.08, BLUE);
}

function spur(canvas, c, r) {
  shadow(canvas, c, r);
  canvas.draw_arc(p(c, r, V(-0.1, 0.1)), 0.55 * r, PI * 0.1, PI * 1.25, 20, STEEL_DARK, Math.max(2.0, 0.2 * r), true);
  canvas.draw_arc(p(c, r, V(-0.1, 0.1)), 0.55 * r, PI * 0.1, PI * 1.25, 20, STEEL, Math.max(1.0, 0.11 * r), true);
  line(canvas, c, r, [V(0.38, 0.28), V(0.62, 0.46)], STEEL, 0.1);
  for (let i = 0; i < 8; i++) {
    const a = (TAU * i) / 8.0;
    line(canvas, c, r, [V(0.72, 0.56), V(0.72 + Math.cos(a) * 0.24, 0.56 + Math.sin(a) * 0.24)], GOLD, 0.06);
  }
  circle(canvas, c, r, V(0.72, 0.56), 0.1, GOLD_LIGHT);
}

function lens(canvas, c, r) {
  shadow(canvas, c, r);
  line(canvas, c, r, [V(0.3, 0.3), V(0.78, 0.78)], LEATHER, 0.2);
  circle(canvas, c, r, V(-0.14, -0.14), 0.56, GOLD_DARK);
  circle(canvas, c, r, V(-0.14, -0.14), 0.46, new Color(0.55, 0.75, 1.0, 0.85));
  circle(canvas, c, r, V(-0.26, -0.28), 0.14, new Color(1, 1, 1, 0.7));
  line(canvas, c, r, [V(-0.52, 0.22), V(0.26, -0.56)], new Color(1, 1, 1, 0.25), 0.05);
}

function banner(canvas, c, r) {
  line(canvas, c, r, [V(-0.5, -0.86), V(-0.5, 0.9)], LEATHER_DARK, 0.1);
  poly(canvas, c, r, [V(-0.46, -0.76), V(0.56, -0.76), V(0.56, 0.52), V(0.05, 0.3), V(-0.46, 0.52)], new Color('8e1f25'));
  poly(canvas, c, r, [V(0.05, -0.76), V(0.56, -0.76), V(0.56, 0.52), V(0.05, 0.3)], new Color('6a151b'));
  line(canvas, c, r, [V(-0.46, -0.76), V(0.56, -0.76)], GOLD, 0.08);
  crown(canvas, V(c.x + 0.05 * r, c.y - 0.2 * r), r * 0.34);
}

function scroll(canvas, c, r) {
  shadow(canvas, c, r);
  poly(canvas, c, r, [V(-0.56, -0.56), V(0.56, -0.56), V(0.56, 0.56), V(-0.56, 0.56)], PARCHMENT);
  for (const y of [-0.6, 0.6]) poly(canvas, c, r, [V(-0.66, y - 0.1), V(0.66, y - 0.1), V(0.66, y + 0.1), V(-0.66, y + 0.1)], PARCHMENT.darkened(0.25));
  for (const y of [-0.3, -0.1, 0.1, 0.3]) line(canvas, c, r, [V(-0.38, y), V(0.38, y)], LEATHER, 0.04);
}

function seal(canvas, c, r) {
  shadow(canvas, c, r);
  const points = [];
  for (let i = 0; i < 16; i++) {
    const a = (TAU * i) / 16.0;
    const d = i % 2 === 0 ? 0.72 : 0.62;
    points.push(V(Math.cos(a) * d, Math.sin(a) * d));
  }
  poly(canvas, c, r, points, new Color('8e1f25'));
  circle(canvas, c, r, V(0, 0), 0.46, new Color('b02a30'));
  circle(canvas, c, r, V(-0.1, -0.12), 0.18, new Color(1, 1, 1, 0.18));
  crown(canvas, c, r * 0.3);
}

function feather(canvas, c, r) {
  poly(canvas, c, r, [V(0.52, -0.82), V(0.62, -0.4), V(0.26, 0.2), V(-0.3, 0.56), V(-0.12, 0.08), V(0.2, -0.46)], new Color('ff7a2e'));
  poly(canvas, c, r, [V(0.52, -0.82), V(0.62, -0.4), V(0.26, 0.2), V(-0.3, 0.56)], new Color('ffb347'));
  line(canvas, c, r, [V(0.52, -0.82), V(-0.56, 0.8)], GOLD_LIGHT, 0.06);
  circle(canvas, c, r, V(0.3, -0.4), 0.1, new Color(1, 0.95, 0.7, 0.6));
}

function medal(canvas, c, r) {
  poly(canvas, c, r, [V(-0.36, -0.9), V(-0.08, -0.9), V(0.08, -0.2), V(-0.2, -0.2)], BLUE);
  poly(canvas, c, r, [V(0.36, -0.9), V(0.08, -0.9), V(-0.08, -0.2), V(0.2, -0.2)], BLUE_DARK);
  circle(canvas, c, r, V(0, 0.28), 0.5, GOLD_DARK);
  circle(canvas, c, r, V(0, 0.24), 0.46, GOLD);
  star(canvas, V(c.x, c.y + 0.24 * r), r * 0.3, GOLD_LIGHT, GOLD_DARK, Color.WHITE);
}

function ribbon(canvas, c, r) {
  shadow(canvas, c, r);
  poly(canvas, c, r, [V(-0.2, 0.0), V(-0.02, 0.1), V(-0.34, 0.86), V(-0.46, 0.66), V(-0.6, 0.78)], new Color('8e1f25'));
  poly(canvas, c, r, [V(0.2, 0.0), V(0.02, 0.1), V(0.34, 0.86), V(0.46, 0.66), V(0.6, 0.78)], new Color('6a151b'));
  const petals = [];
  for (let i = 0; i < 14; i++) {
    const a = (TAU * i) / 14.0;
    const d = i % 2 === 0 ? 0.52 : 0.4;
    petals.push(V(Math.cos(a) * d, Math.sin(a) * d - 0.2));
  }
  poly(canvas, c, r, petals, new Color('b02a30'));
  circle(canvas, c, r, V(0, -0.2), 0.28, GOLD);
  circle(canvas, c, r, V(0, -0.2), 0.2, GOLD_DARK.lerp(GOLD, 0.5));
  circle(canvas, c, r, V(-0.08, -0.28), 0.07, GOLD_LIGHT);
}

function eye(canvas, c, r) {
  shadow(canvas, c, r);
  const lid = [];
  for (let i = 0; i < 17; i++) {
    const t = i / 16.0;
    lid.push(V(lerpf(-0.8, 0.8, t), -Math.sin(PI * t) * 0.46));
  }
  for (let i = 15; i > 0; i--) {
    const t = i / 16.0;
    lid.push(V(lerpf(-0.8, 0.8, t), Math.sin(PI * t) * 0.4));
  }
  poly(canvas, c, r, lid, PARCHMENT);
  circle(canvas, c, r, V(0, 0), 0.32, BLUE_DARK);
  circle(canvas, c, r, V(0, 0), 0.24, BLUE);
  circle(canvas, c, r, V(0, 0), 0.11, INK_DARK);
  circle(canvas, c, r, V(-0.1, -0.1), 0.07, Color.WHITE);
  line(canvas, c, r, [...lid, lid[0]], LEATHER_DARK, 0.06);
}

function key(canvas, c, r) {
  shadow(canvas, c, r);
  line(canvas, c, r, [V(-0.12, -0.12), V(0.62, 0.62)], GOLD_DARK, 0.2);
  line(canvas, c, r, [V(-0.12, -0.12), V(0.62, 0.62)], GOLD, 0.11);
  poly(canvas, c, r, [V(0.4, 0.62), V(0.62, 0.4), V(0.74, 0.52), V(0.52, 0.74)], GOLD_DARK);
  canvas.draw_arc(p(c, r, V(-0.34, -0.34)), 0.3 * r, 0, TAU, 20, GOLD_DARK, Math.max(2.0, 0.2 * r), true);
  canvas.draw_arc(p(c, r, V(-0.34, -0.34)), 0.3 * r, 0, TAU, 20, GOLD, Math.max(1.0, 0.11 * r), true);
  circle(canvas, c, r, V(-0.34, -0.34), 0.1, BLUE);
  circle(canvas, c, r, V(-0.44, -0.46), 0.06, GOLD_LIGHT);
}

function salt(canvas, c, r) {
  shadow(canvas, c, r);
  const white = new Color('eef1f4');
  const grey = new Color('a9b3bf');
  for (const [at, h] of [[V(-0.36, 0.3), 0.38], [V(0.34, 0.34), 0.32], [V(0.0, -0.02), 0.52]]) {
    poly(canvas, c, r, [addv(at, V(0, -h)), addv(at, V(h * 0.46, -h * 0.1)), addv(at, V(0, h * 0.8)), addv(at, V(-h * 0.46, -h * 0.1))], white);
    poly(canvas, c, r, [addv(at, V(0, -h)), addv(at, V(0.04, 0.0)), addv(at, V(0, h * 0.8)), addv(at, V(-h * 0.46, -h * 0.1))], grey);
  }
  circle(canvas, c, r, V(-0.06, -0.3), 0.06, Color.WHITE);
}

function quill(canvas, c, r) {
  poly(canvas, c, r, [V(0.58, -0.84), V(0.66, -0.36), V(0.24, 0.24), V(-0.28, 0.58), V(-0.1, 0.1), V(0.24, -0.48)], PARCHMENT);
  poly(canvas, c, r, [V(0.58, -0.84), V(0.66, -0.36), V(0.24, 0.24), V(-0.28, 0.58)], PARCHMENT.darkened(0.2));
  line(canvas, c, r, [V(0.58, -0.84), V(-0.54, 0.8)], LEATHER_DARK, 0.05);
  circle(canvas, c, r, V(-0.62, 0.82), 0.12, INK_DARK);
  circle(canvas, c, r, V(-0.66, 0.78), 0.04, BLUE_LIGHT);
}

function chit(canvas, c, r) {
  shadow(canvas, c, r);
  poly(canvas, c, r, [V(-0.74, -0.42), V(0.74, -0.42), V(0.74, -0.12), V(0.62, 0.0), V(0.74, 0.12), V(0.74, 0.42), V(-0.74, 0.42), V(-0.74, 0.12), V(-0.62, 0.0), V(-0.74, -0.12)], PARCHMENT);
  line(canvas, c, r, [V(-0.3, -0.42), V(-0.3, 0.42)], LEATHER, 0.03);
  star(canvas, V(c.x + 0.2 * r, c.y), r * 0.3, GOLD, GOLD_DARK, GOLD_LIGHT);
  for (const y of [-0.18, 0.0, 0.18]) line(canvas, c, r, [V(-0.6, y), V(-0.4, y)], LEATHER, 0.04);
}

function envelope(canvas, c, r) {
  shadow(canvas, c, r);
  poly(canvas, c, r, [V(-0.76, -0.48), V(0.76, -0.48), V(0.76, 0.5), V(-0.76, 0.5)], PARCHMENT);
  poly(canvas, c, r, [V(-0.76, 0.5), V(0.0, -0.02), V(0.76, 0.5)], PARCHMENT.darkened(0.12));
  poly(canvas, c, r, [V(-0.76, -0.48), V(0.76, -0.48), V(0.0, 0.14)], PARCHMENT.darkened(0.22));
  circle(canvas, c, r, V(0.0, 0.1), 0.2, new Color('8e1f25'));
  circle(canvas, c, r, V(0.0, 0.1), 0.14, new Color('b02a30'));
  circle(canvas, c, r, V(-0.05, 0.05), 0.05, new Color(1, 1, 1, 0.3));
}

function chain(canvas, c, r) {
  for (let i = 0; i < 3; i++) {
    const at = V(-0.48 + i * 0.48, -0.24 + i * 0.24);
    canvas.draw_arc(p(c, r, at), 0.28 * r, 0, TAU, 18, GOLD_DARK, Math.max(2.0, 0.16 * r), true);
    canvas.draw_arc(p(c, r, at), 0.28 * r, 0, TAU, 18, GOLD, Math.max(1.0, 0.09 * r), true);
  }
}

function chevrons(canvas, c, r, color) {
  for (let i = 0; i < 3; i++) {
    const x = -0.6 + i * 0.42;
    line(canvas, c, r, [V(x, -0.5), V(x + 0.34, 0), V(x, 0.5)], new Color(color, 0.45 + i * 0.27), 0.14);
  }
}

function star(canvas, c, r, body, dark, light) {
  const points = [];
  for (let i = 0; i < 10; i++) {
    const a = -PI * 0.5 + (TAU * i) / 10.0;
    const d = i % 2 === 0 ? 0.9 : 0.4;
    points.push(V(Math.cos(a) * d, Math.sin(a) * d));
  }
  poly(canvas, c, r, points, body);
  poly(canvas, c, r, [V(0, 0), points[0], points[1], points[2], points[3], points[4]], dark.lerp(body, 0.6));
  circle(canvas, c, r, V(-0.12, -0.2), 0.1, new Color(light, 0.8));
}

function arrow(canvas, c, r, color) {
  line(canvas, c, r, [V(-0.7, 0.62), V(0.4, -0.48)], color, 0.13);
  poly(canvas, c, r, [V(0.72, -0.8), V(0.6, -0.18), V(0.08, -0.68)], color);
}

function bolt(canvas, c, r) {
  poly(canvas, c, r, [V(0.12, -0.9), V(-0.46, 0.1), V(-0.02, 0.1), V(-0.16, 0.9), V(0.46, -0.16), V(0.04, -0.16)], GOLD);
  poly(canvas, c, r, [V(0.12, -0.9), V(-0.46, 0.1), V(-0.02, 0.1)], GOLD_LIGHT);
}

function spear(canvas, c, r) {
  line(canvas, c, r, [V(-0.72, 0.72), V(0.3, -0.3)], LEATHER, 0.1);
  poly(canvas, c, r, [V(0.78, -0.78), V(0.44, -0.08), V(0.18, -0.2), V(0.08, -0.44)], STEEL);
  poly(canvas, c, r, [V(0.78, -0.78), V(0.18, -0.2), V(0.08, -0.44)], Color.WHITE.lerp(STEEL, 0.4));
}

function steps(canvas, c, r) {
  for (let i = 0; i < 3; i++) {
    const at = V(-0.56 + i * 0.52, 0.5 - i * 0.5);
    poly(canvas, c, r, [addv(at, V(-0.2, -0.2)), addv(at, V(0.2, -0.2)), addv(at, V(0.2, 0.2)), addv(at, V(-0.2, 0.2))], new Color(BLUE_LIGHT, 0.4 + i * 0.3));
  }
}

function fist(canvas, c, r) {
  poly(canvas, c, r, [V(-0.46, -0.3), V(0.46, -0.3), V(0.5, 0.3), V(0.2, 0.56), V(-0.4, 0.5)], PARCHMENT);
  for (let i = 0; i < 4; i++) line(canvas, c, r, [V(-0.34 + i * 0.24, -0.3), V(-0.34 + i * 0.24, 0.0)], LEATHER, 0.05);
  line(canvas, c, r, [V(0, -0.56), V(0, -0.84)], GOLD, 0.1);
  poly(canvas, c, r, [V(-0.2, -0.62), V(0.2, -0.62), V(0, -0.9)], GOLD);
}

function swords(canvas, c, r) {
  for (const side of [-1.0, 1.0]) {
    line(canvas, c, r, [V(-0.62 * side, -0.62), V(0.42 * side, 0.42)], STEEL, 0.12);
    line(canvas, c, r, [V(0.28 * side, 0.6), V(0.6 * side, 0.28)], GOLD, 0.1);
    line(canvas, c, r, [V(0.44 * side, 0.44), V(0.66 * side, 0.66)], LEATHER, 0.12);
  }
}

function skull(canvas, c, r) {
  circle(canvas, c, r, V(0, -0.14), 0.56, PARCHMENT);
  poly(canvas, c, r, [V(-0.3, 0.2), V(0.3, 0.2), V(0.26, 0.62), V(-0.26, 0.62)], PARCHMENT);
  circle(canvas, c, r, V(-0.22, -0.12), 0.15, INK_DARK);
  circle(canvas, c, r, V(0.22, -0.12), 0.15, INK_DARK);
  poly(canvas, c, r, [V(0, 0.04), V(0.08, 0.2), V(-0.08, 0.2)], INK_DARK);
  for (const x of [-0.14, 0.0, 0.14]) line(canvas, c, r, [V(x, 0.4), V(x, 0.6)], INK_DARK, 0.04);
}

function purse(canvas, c, r) {
  poly(canvas, c, r, [V(-0.3, -0.42), V(0.3, -0.42), V(0.62, 0.2), V(0.44, 0.66), V(-0.44, 0.66), V(-0.62, 0.2)], LEATHER);
  poly(canvas, c, r, [V(0, -0.42), V(0.3, -0.42), V(0.62, 0.2), V(0.44, 0.66), V(0, 0.66)], LEATHER_DARK.lerp(LEATHER, 0.4));
  line(canvas, c, r, [V(-0.34, -0.44), V(0.34, -0.44)], GOLD, 0.08);
  circle(canvas, c, r, V(0, 0.2), 0.2, GOLD);
}

function campfire(canvas, c, r) {
  line(canvas, c, r, [V(-0.62, 0.64), V(0.62, 0.38)], LEATHER, 0.14);
  line(canvas, c, r, [V(0.62, 0.64), V(-0.62, 0.38)], LEATHER_DARK, 0.14);
  poly(canvas, c, r, [V(-0.34, 0.4), V(-0.16, -0.2), V(0.0, -0.8), V(0.18, -0.24), V(0.36, 0.4)], new Color('ff7a2e'));
  poly(canvas, c, r, [V(-0.16, 0.4), V(0.0, -0.3), V(0.16, 0.4)], GOLD_LIGHT);
}

function question(canvas, c, r) {
  canvas.draw_arc(p(c, r, V(0, -0.3)), 0.34 * r, PI, TAU + PI * 0.4, 16, PARCHMENT, Math.max(1.5, 0.16 * r), true);
  line(canvas, c, r, [V(0.1, 0.0), V(0.0, 0.14), V(0.0, 0.3)], PARCHMENT, 0.16);
  circle(canvas, c, r, V(0, 0.6), 0.11, PARCHMENT);
}

const DRAWERS = {
  coin, ribbon, eye, tome, laurel, shield, key, crown, spur, lens, banner, salt, scroll, quill, chit, envelope, seal, feather, medal,
  chain,
  momentum: (canvas, c, r) => chevrons(canvas, c, r, BLUE_LIGHT),
  ward: shield,
  veteran: (canvas, c, r) => star(canvas, c, r, GOLD, GOLD_DARK, GOLD_LIGHT),
  extended_range: (canvas, c, r) => arrow(canvas, c, r, BLUE_LIGHT),
  charge: bolt,
  piercing: spear,
  siege_step: steps,
  side_step: steps,
  royal_stride: steps,
  rebellion: fist,
  vanguard: (canvas, c, r) => chevrons(canvas, c, r, GOLD_LIGHT),
  encounter: swords,
  elite: skull,
  merchant: purse,
  rest: campfire,
  unknown: question,
  boss: crown,
};
