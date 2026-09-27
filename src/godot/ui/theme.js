/**
 * Theme — Godot 4 theme resources and lookup.
 *
 * A Control resolves an item (constant, colour, font, font size, stylebox, icon) by name through:
 *   1. its own overrides (add_theme_*_override),
 *   2. the `theme` of itself or the nearest ancestor that has one, for each type in its type chain
 *      (e.g. HBoxContainer → BoxContainer → Container → Control),
 *   3. the base theme — the effective values the original build resolves for each type (engine
 *      defaults merged with UiTheme), dumped from it by the `theme` oracle probe (theme_data.json).
 * Lookups are memoised per control and invalidated when overrides or themes change.
 */
import { Color } from '../math.js';
import { StyleBoxEmpty, StyleBoxFlat, StyleBoxLine } from './stylebox.js';
import BASE from './theme_data.json' with { type: 'json' };

export const DATA_TYPES = Object.freeze(['constant', 'color', 'font', 'font_size', 'stylebox', 'icon']);

/** Godot's class inheritance for the theme types the game uses. */
export const TYPE_PARENTS = Object.freeze({
  Control: null,
  Container: 'Control',
  BoxContainer: 'Container',
  HBoxContainer: 'BoxContainer',
  VBoxContainer: 'BoxContainer',
  MarginContainer: 'Container',
  CenterContainer: 'Container',
  PanelContainer: 'Container',
  GridContainer: 'Container',
  ScrollContainer: 'Container',
  TooltipPanel: 'PanelContainer',
  Label: 'Control',
  TooltipLabel: 'Label',
  RichTextLabel: 'Control',
  BaseButton: 'Control',
  Button: 'BaseButton',
  CheckButton: 'Button',
  OptionButton: 'Button',
  LineEdit: 'Control',
  Range: 'Control',
  Slider: 'Range',
  HSlider: 'Slider',
  ScrollBar: 'Range',
  VScrollBar: 'ScrollBar',
  HScrollBar: 'ScrollBar',
  Panel: 'Control',
  ColorRect: 'Control',
  TextureRect: 'Control',
  PopupMenu: 'Control',
});

export function typeChain(type) {
  const chain = [];
  for (let t = type; t; t = TYPE_PARENTS[t] ?? null) chain.push(t);
  return chain;
}

export class Theme {
  constructor() {
    /** type → kind → name → value */
    this.items = new Map();
    this.default_font = null;
    this.default_font_size = -1;
    this.version = 0;
  }

  _slot(kind, type) {
    let byType = this.items.get(type);
    if (!byType) {
      byType = new Map();
      this.items.set(type, byType);
    }
    let byKind = byType.get(kind);
    if (!byKind) {
      byKind = new Map();
      byType.set(kind, byKind);
    }
    return byKind;
  }

  _set(kind, name, type, value) {
    this._slot(kind, type).set(name, value);
    this.version += 1;
  }
  _get(kind, name, type) {
    return this.items.get(type)?.get(kind)?.get(name);
  }
  _has(kind, name, type) {
    return this.items.get(type)?.get(kind)?.has(name) ?? false;
  }

  set_color(name, type, value) { this._set('color', name, type, value); }
  set_constant(name, type, value) { this._set('constant', name, type, value); }
  set_font(name, type, value) { this._set('font', name, type, value); }
  set_font_size(name, type, value) { this._set('font_size', name, type, value); }
  set_stylebox(name, type, value) { this._set('stylebox', name, type, value); }
  set_icon(name, type, value) { this._set('icon', name, type, value); }
  get_stylebox(name, type) { return this._get('stylebox', name, type); }
  has(kind, name, type) { return this._has(kind, name, type); }
  get(kind, name, type) { return this._get(kind, name, type); }
}

// ────────────────────────────────────────────────────────────────────────── base theme ──────────

const color = (html) => new Color(html);

function styleboxFrom(data) {
  let box;
  if (data.class === 'StyleBoxFlat') {
    box = new StyleBoxFlat();
    box.bg_color = color(data.bg);
    box.border_color = color(data.border);
    box.draw_center = data.draw_center;
    box.border_width = [...data.border_width];
    box.corner_radius = [...data.radius];
    box.corner_detail = data.corner_detail;
    box.expand_margin = [...data.expand];
    box.shadow_color = color(data.shadow_color);
    box.shadow_size = data.shadow_size;
    box.shadow_offset = { x: data.shadow_offset[0], y: data.shadow_offset[1] };
    box.anti_aliasing = data.anti_aliasing;
    box.anti_aliasing_size = data.aa_size;
    box.border_blend = data.blend;
    box.skew = { x: data.skew[0], y: data.skew[1] };
  } else if (data.class === 'StyleBoxLine') {
    box = new StyleBoxLine();
    box.color = color(data.color);
    box.thickness = data.thickness;
    box.vertical = data.vertical;
    box.grow_begin = data.grow_begin;
    box.grow_end = data.grow_end;
  } else {
    box = new StyleBoxEmpty();
  }
  box.content_margin = [...data.content];
  return box;
}

/**
 * Icons are resolved lazily to ImageBitmap-backed textures by the renderer; the theme only keeps the
 * source (data URL) and the logical size.
 */
export class IconTexture {
  constructor(src, width, height) {
    this.src = src;
    this.width = width;
    this.height = height;
    /** Filled by the renderer once decoded. */
    this.image = null;
    this.version = 0;
  }
  get_width() { return this.width; }
  get_height() { return this.height; }
  get_size() { return { x: this.width, y: this.height }; }
}

/** The base theme, built once from theme_data.json. Fonts are names resolved by the Fonts registry. */
export const baseTheme = new Theme();
for (const [type, data] of Object.entries(BASE.types)) {
  for (const [name, value] of Object.entries(data.constants)) baseTheme.set_constant(name, type, value);
  for (const [name, value] of Object.entries(data.colors)) baseTheme.set_color(name, type, color(value));
  for (const [name, value] of Object.entries(data.font_sizes)) baseTheme.set_font_size(name, type, value);
  for (const [name, value] of Object.entries(data.fonts)) baseTheme.set_font(name, type, value);
  for (const [name, value] of Object.entries(data.styleboxes)) baseTheme.set_stylebox(name, type, styleboxFrom(value));
  for (const [name, value] of Object.entries(data.icons)) baseTheme.set_icon(name, type, new IconTexture(value.src, value.size[0], value.size[1]));
}
baseTheme.default_font = BASE.globals.default_font;
baseTheme.default_font_size = BASE.globals.project_default_font_size;
export const BASE_GLOBALS = Object.freeze(BASE.globals);

/** Fonts are referenced by name in theme data; the app registers the FontVariation objects. */
export const FontRegistry = {
  fonts: {},
  resolve(font) {
    if (font == null) return null;
    if (typeof font === 'string') return this.fonts[font] ?? null;
    return font;
  },
};
