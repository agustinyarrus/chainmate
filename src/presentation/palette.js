/**
 * Palette — port of scripts/presentation/palette.gd.
 */
import { Color } from '../godot/math.js';

export const Palette = Object.freeze({
  BACKGROUND: new Color('0b111b'),
  INK: new Color('ece2cc'),
  MUTED: new Color('a5acb8'),
  FAINT: new Color('5f6878'),
  GOLD: new Color('d4a24e'),
  GOLD_BRIGHT: new Color('f2cd82'),

  MOVE: new Color('4f8dff'),
  CAPTURE: new Color('ff4a3d'),
  CHAIN: new Color('ffb743'),
  SELECT: new Color('ffcf73'),
  THREAT: new Color('ff3b30'),
  SPECIAL: new Color('a86bff'),
  HINT: new Color('a86bff'),
  ENCHANTED: new Color('7ecb4a'),
  FROZEN: new Color('8fc4ff'),
  CORRUPTED: new Color('ff3b24'),

  PANEL: new Color(0.043, 0.063, 0.098, 0.93),
  PANEL_SOFT: new Color(0.043, 0.063, 0.098, 0.72),
  PANEL_EDGE: new Color(0.62, 0.68, 0.78, 0.22),
  PANEL_EDGE_STRONG: new Color(0.7, 0.76, 0.86, 0.42),
  ACCENT: new Color('4f8dff'),
  ACCENT_GLOW: new Color(0.31, 0.55, 1.0, 0.55),

  TILE_LIGHT: new Color('cdbca1'),
  TILE_DARK: new Color('3a393d'),

  RARITY_COLORS: Object.freeze({
    common: new Color('a5acb8'),
    uncommon: new Color('6fa8ff'),
    rare: new Color('f2cd82'),
  }),

  NODE_COLORS: Object.freeze({
    encounter: new Color('ece2cc'),
    elite: new Color('ff8a5c'),
    merchant: new Color('f2cd82'),
    rest: new Color('7ecb4a'),
    unknown: new Color('a86bff'),
    boss: new Color('ff4a3d'),
  }),
});
