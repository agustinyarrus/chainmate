/**
 * Control — Godot 4's Control, ported for layout fidelity:
 *   anchors + offsets → rect (Control::_size_changed), minimum-size enforcement with grow directions,
 *   set_anchors_preset / set_offsets_preset exactly as the engine computes them, set_rect resetting
 *   anchors (containers), deferred minimum-size propagation (update_minimum_size → minimum_size_changed),
 *   theme resolution (overrides → nearest themed ancestor → base theme, along the class type chain),
 *   pivot/rotation/scale transforms, focus, mouse filter, tooltips and gui_input.
 */
import { Color } from '../math.js';
import { SceneTree } from '../scene.js';
import { Signal } from '../signal.js';
import { CanvasItem, CanvasLayer, multiply } from './canvas_item.js';
import { baseTheme, typeChain, FontRegistry } from './theme.js';

export const ANCHOR_BEGIN = 0;
export const ANCHOR_END = 1;
export const SIDE_LEFT = 0;
export const SIDE_TOP = 1;
export const SIDE_RIGHT = 2;
export const SIDE_BOTTOM = 3;

export const PRESET = Object.freeze({
  TOP_LEFT: 0, TOP_RIGHT: 1, BOTTOM_LEFT: 2, BOTTOM_RIGHT: 3, CENTER_LEFT: 4, CENTER_TOP: 5, CENTER_RIGHT: 6,
  CENTER_BOTTOM: 7, CENTER: 8, LEFT_WIDE: 9, TOP_WIDE: 10, RIGHT_WIDE: 11, BOTTOM_WIDE: 12, VCENTER_WIDE: 13,
  HCENTER_WIDE: 14, FULL_RECT: 15,
});
export const PRESET_MODE = Object.freeze({ MINSIZE: 0, KEEP_WIDTH: 1, KEEP_HEIGHT: 2, KEEP_SIZE: 3 });
export const GROW = Object.freeze({ BEGIN: 0, END: 1, BOTH: 2 });
export const SIZE = Object.freeze({ SHRINK_BEGIN: 0, FILL: 1, EXPAND: 2, EXPAND_FILL: 3, SHRINK_CENTER: 4, SHRINK_END: 8 });
export const MOUSE_FILTER = Object.freeze({ STOP: 0, PASS: 1, IGNORE: 2 });
export const FOCUS = Object.freeze({ NONE: 0, CLICK: 1, ALL: 2 });
export const CURSOR = Object.freeze({ ARROW: 0, IBEAM: 1, POINTING_HAND: 2 });
export const HORIZONTAL_ALIGNMENT = Object.freeze({ LEFT: 0, CENTER: 1, RIGHT: 2, FILL: 3 });
export const VERTICAL_ALIGNMENT = Object.freeze({ TOP: 0, CENTER: 1, BOTTOM: 2, FILL: 3 });

const LEFT_SET = new Set([PRESET.TOP_LEFT, PRESET.BOTTOM_LEFT, PRESET.CENTER_LEFT, PRESET.TOP_WIDE, PRESET.BOTTOM_WIDE, PRESET.LEFT_WIDE, PRESET.HCENTER_WIDE, PRESET.FULL_RECT]);
const HCENTER_SET = new Set([PRESET.CENTER_TOP, PRESET.CENTER_BOTTOM, PRESET.CENTER, PRESET.VCENTER_WIDE]);
const TOP_SET = new Set([PRESET.TOP_LEFT, PRESET.TOP_RIGHT, PRESET.CENTER_TOP, PRESET.LEFT_WIDE, PRESET.RIGHT_WIDE, PRESET.TOP_WIDE, PRESET.VCENTER_WIDE, PRESET.FULL_RECT]);
const VCENTER_SET = new Set([PRESET.CENTER_LEFT, PRESET.CENTER_RIGHT, PRESET.CENTER, PRESET.HCENTER_WIDE]);
const RIGHT_BEGIN_SET = new Set([PRESET.TOP_LEFT, PRESET.BOTTOM_LEFT, PRESET.CENTER_LEFT, PRESET.LEFT_WIDE]);
const BOTTOM_BEGIN_SET = new Set([PRESET.TOP_LEFT, PRESET.TOP_RIGHT, PRESET.CENTER_TOP, PRESET.TOP_WIDE]);

const approxEqual = (a, b) => Math.abs(a - b) < 1e-5;

/** The GUI viewport (focus, hover, input) — set by viewport.js. */
export const Gui = { viewport: null };

export class Control extends CanvasItem {
  /** Godot class name used for theme lookups (subclasses override). */
  static themeType = 'Control';

  constructor(name = '') {
    super(name);
    this.anchor = [0, 0, 0, 0];
    this.offset = [0, 0, 0, 0];
    this._pos = { x: 0, y: 0 };
    this._size = { x: 0, y: 0 };
    this._rotation = 0;
    this._scale = { x: 1, y: 1 };
    this._pivot = { x: 0, y: 0 };
    this.grow_horizontal = GROW.END;
    this.grow_vertical = GROW.END;
    this._sizeFlags = [SIZE.FILL, SIZE.FILL];
    this._stretchRatio = 1;
    this._customMin = { x: 0, y: 0 };
    this._minCache = null;
    this._lastMin = { x: 0, y: 0 };
    this._minUpdatePending = false;
    this.mouse_filter = MOUSE_FILTER.STOP;
    this.focus_mode = FOCUS.NONE;
    this.mouse_default_cursor_shape = CURSOR.ARROW;
    this.tooltip_text = '';
    this._theme = null;
    this._overrides = { constant: new Map(), color: new Map(), font: new Map(), font_size: new Map(), stylebox: new Map(), icon: new Map() };
    this._themeCache = new Map();
    this.theme_type_variation = '';

    this.resized = new Signal();
    this.minimum_size_changed = new Signal();
    this.size_flags_changed = new Signal();
    this.mouse_entered = new Signal();
    this.mouse_exited = new Signal();
    this.focus_entered = new Signal();
    this.focus_exited = new Signal();
    this.gui_input = new Signal();
    this.item_rect_changed = new Signal();
    this.theme_changed = new Signal();
  }

  // ─────────────────────────────────────────────────────────────── tree hooks ────────────────────

  _enter_tree() {
    // Parents enter first, so the ancestors' themes and sizes are already current (each child gets its own call).
    this._themeCache.clear();
    this._minCache = null;
    this._theme_changed?.();
    this._size_changed();
    this.update_minimum_size();
  }

  _exit_tree() {
    Gui.viewport?._controlExited(this);
  }

  /** The Control parent (null for top-level controls under a CanvasLayer / non-Control). */
  get_parent_control() {
    return this.parent instanceof Control ? this.parent : null;
  }

  get_viewport() {
    return Gui.viewport;
  }

  get_parent_anchorable_rect() {
    if (!this._inside) return { x: 0, y: 0, w: 0, h: 0 };
    const parent = this.get_parent_control();
    if (parent) return { x: 0, y: 0, w: parent._size.x, h: parent._size.y };
    const vp = Gui.viewport;
    return vp ? { x: 0, y: 0, w: vp.size.x, h: vp.size.y } : { x: 0, y: 0, w: 0, h: 0 };
  }

  // ─────────────────────────────────────────────────────────────── layout ────────────────────────

  _size_changed() {
    const parentRect = this.get_parent_anchorable_rect();
    const edge = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const area = i & 1 ? parentRect.h : parentRect.w;
      edge[i] = this.offset[i] + this.anchor[i] * area;
    }
    const pos = { x: edge[0], y: edge[1] };
    const size = { x: edge[2] - edge[0], y: edge[3] - edge[1] };
    const min = this.get_combined_minimum_size();
    if (min.x > size.x) {
      if (this.grow_horizontal === GROW.BEGIN) pos.x += size.x - min.x;
      else if (this.grow_horizontal === GROW.BOTH) pos.x += 0.5 * (size.x - min.x);
      size.x = min.x;
    }
    if (min.y > size.y) {
      if (this.grow_vertical === GROW.BEGIN) pos.y += size.y - min.y;
      else if (this.grow_vertical === GROW.BOTH) pos.y += 0.5 * (size.y - min.y);
      size.y = min.y;
    }
    const posChanged = !approxEqual(pos.x, this._pos.x) || !approxEqual(pos.y, this._pos.y);
    const sizeChanged = !approxEqual(size.x, this._size.x) || !approxEqual(size.y, this._size.y);
    if (posChanged) this._pos = pos;
    if (sizeChanged) this._size = size;
    if (this._inside && (posChanged || sizeChanged)) {
      this.item_rect_changed.emit();
      if (sizeChanged) {
        this.queue_redraw();
        this._resized();
        this.resized.emit();
        for (const child of this.children) if (child instanceof Control) child._size_changed();
      }
    }
  }

  /** NOTIFICATION_RESIZED hook for subclasses (containers sort, labels re-wrap). */
  _resized() {}

  _computeOffsets(rect) {
    const parent = this.get_parent_anchorable_rect();
    this.offset[0] = rect.x - this.anchor[0] * parent.w;
    this.offset[1] = rect.y - this.anchor[1] * parent.h;
    this.offset[2] = rect.x + rect.w - this.anchor[2] * parent.w;
    this.offset[3] = rect.y + rect.h - this.anchor[3] * parent.h;
  }

  get position() {
    return { x: this._pos.x, y: this._pos.y };
  }
  set position(p) {
    this.set_position(p);
  }
  set_position(p) {
    this._computeOffsets({ x: p.x, y: p.y, w: this._size.x, h: this._size.y });
    this._size_changed();
  }

  get size() {
    return { x: this._size.x, y: this._size.y };
  }
  set size(s) {
    this.set_size(s);
  }
  set_size(s) {
    const min = this.get_combined_minimum_size();
    const w = Math.max(s.x, min.x);
    const h = Math.max(s.y, min.y);
    this._computeOffsets({ x: this._pos.x, y: this._pos.y, w, h });
    this._size_changed();
  }
  reset_size() {
    this.set_size({ x: 0, y: 0 });
  }

  /** Used by containers: anchors go to the begin edge, offsets frame `rect`. */
  set_rect(rect) {
    this.anchor = [ANCHOR_BEGIN, ANCHOR_BEGIN, ANCHOR_BEGIN, ANCHOR_BEGIN];
    this._computeOffsets(rect);
    if (this._inside) this._size_changed();
  }

  get_rect() {
    return { x: this._pos.x, y: this._pos.y, w: this._size.x, h: this._size.y };
  }

  get global_position() {
    const m = this.get_global_transform();
    return { x: m[4], y: m[5] };
  }

  get_global_rect() {
    const m = this.get_global_transform();
    return { x: m[4], y: m[5], w: this._size.x * m[0], h: this._size.y * m[3] };
  }

  get rotation() { return this._rotation; }
  set rotation(r) { this._rotation = r; }
  get scale() { return { x: this._scale.x, y: this._scale.y }; }
  set scale(s) { this._scale = { x: s.x, y: s.y }; }
  get pivot_offset() { return { x: this._pivot.x, y: this._pivot.y }; }
  set pivot_offset(p) { this._pivot = { x: p.x, y: p.y }; }

  /** T(position) · T(pivot) · R · S · T(−pivot) */
  get_transform() {
    const c = Math.cos(this._rotation);
    const s = Math.sin(this._rotation);
    const a = c * this._scale.x;
    const b = s * this._scale.x;
    const cc = -s * this._scale.y;
    const d = c * this._scale.y;
    const px = this._pivot.x;
    const py = this._pivot.y;
    return [a, b, cc, d, this._pos.x + px - (a * px + cc * py), this._pos.y + py - (b * px + d * py)];
  }

  // offsets / anchors as properties
  get offset_left() { return this.offset[0]; }
  set offset_left(v) { this.offset[0] = v; this._size_changed(); }
  get offset_top() { return this.offset[1]; }
  set offset_top(v) { this.offset[1] = v; this._size_changed(); }
  get offset_right() { return this.offset[2]; }
  set offset_right(v) { this.offset[2] = v; this._size_changed(); }
  get offset_bottom() { return this.offset[3]; }
  set offset_bottom(v) { this.offset[3] = v; this._size_changed(); }
  get anchor_left() { return this.anchor[0]; }
  get anchor_top() { return this.anchor[1]; }
  get anchor_right() { return this.anchor[2]; }
  get anchor_bottom() { return this.anchor[3]; }

  set_anchor(side, value, keepOffset = false, pushOpposite = true) {
    const parent = this.get_parent_anchorable_rect();
    const range = side === SIDE_LEFT || side === SIDE_RIGHT ? parent.w : parent.h;
    const opposite = (side + 2) % 4;
    const previous = this.offset[side] + this.anchor[side] * range;
    const previousOpposite = this.offset[opposite] + this.anchor[opposite] * range;
    this.anchor[side] = value;
    if (((side === SIDE_LEFT || side === SIDE_TOP) && this.anchor[side] > this.anchor[opposite]) || ((side === SIDE_RIGHT || side === SIDE_BOTTOM) && this.anchor[side] < this.anchor[opposite])) {
      if (pushOpposite) this.anchor[opposite] = this.anchor[side];
      else this.anchor[side] = this.anchor[opposite];
    }
    if (!keepOffset) {
      this.offset[side] = previous - this.anchor[side] * range;
      if (pushOpposite) this.offset[opposite] = previousOpposite - this.anchor[opposite] * range;
    }
    if (this._inside) this._size_changed();
    this.queue_redraw();
  }

  set_anchors_preset(preset, keepOffsets = false) {
    const horizontal = (lr) => (LEFT_SET.has(lr) ? ANCHOR_BEGIN : HCENTER_SET.has(lr) ? 0.5 : ANCHOR_END);
    this.set_anchor(SIDE_LEFT, horizontal(preset), keepOffsets);
    this.set_anchor(SIDE_TOP, TOP_SET.has(preset) ? ANCHOR_BEGIN : VCENTER_SET.has(preset) ? 0.5 : ANCHOR_END, keepOffsets);
    this.set_anchor(SIDE_RIGHT, RIGHT_BEGIN_SET.has(preset) ? ANCHOR_BEGIN : HCENTER_SET.has(preset) ? 0.5 : ANCHOR_END, keepOffsets);
    this.set_anchor(SIDE_BOTTOM, BOTTOM_BEGIN_SET.has(preset) ? ANCHOR_BEGIN : VCENTER_SET.has(preset) ? 0.5 : ANCHOR_END, keepOffsets);
  }

  set_offsets_preset(preset, resizeMode = PRESET_MODE.MINSIZE, margin = 0) {
    const size = this.size;
    const min = this.get_minimum_size();
    if (resizeMode === PRESET_MODE.MINSIZE || resizeMode === PRESET_MODE.KEEP_HEIGHT) size.x = min.x;
    if (resizeMode === PRESET_MODE.MINSIZE || resizeMode === PRESET_MODE.KEEP_WIDTH) size.y = min.y;
    const p = this.get_parent_anchorable_rect();
    const a = this.anchor;
    if (LEFT_SET.has(preset)) this.offset[0] = p.w * (0 - a[0]) + margin + p.x;
    else if (HCENTER_SET.has(preset)) this.offset[0] = p.w * (0.5 - a[0]) - size.x / 2 + p.x;
    else this.offset[0] = p.w * (1 - a[0]) - size.x - margin + p.x;
    if (TOP_SET.has(preset)) this.offset[1] = p.h * (0 - a[1]) + margin + p.y;
    else if (VCENTER_SET.has(preset)) this.offset[1] = p.h * (0.5 - a[1]) - size.y / 2 + p.y;
    else this.offset[1] = p.h * (1 - a[1]) - size.y - margin + p.y;
    if (RIGHT_BEGIN_SET.has(preset)) this.offset[2] = p.w * (0 - a[2]) + size.x + margin + p.x;
    else if (HCENTER_SET.has(preset)) this.offset[2] = p.w * (0.5 - a[2]) + size.x / 2 + p.x;
    else this.offset[2] = p.w * (1 - a[2]) - margin + p.x;
    if (BOTTOM_BEGIN_SET.has(preset)) this.offset[3] = p.h * (0 - a[3]) + size.y + margin + p.y;
    else if (VCENTER_SET.has(preset)) this.offset[3] = p.h * (0.5 - a[3]) + size.y / 2 + p.y;
    else this.offset[3] = p.h * (1 - a[3]) - margin + p.y;
    this._size_changed();
  }

  set_anchors_and_offsets_preset(preset, resizeMode = PRESET_MODE.MINSIZE, margin = 0) {
    this.set_anchors_preset(preset);
    this.set_offsets_preset(preset, resizeMode, margin);
  }

  get size_flags_horizontal() { return this._sizeFlags[0]; }
  set size_flags_horizontal(v) {
    if (this._sizeFlags[0] === v) return;
    this._sizeFlags[0] = v;
    this.size_flags_changed.emit();
  }
  get size_flags_vertical() { return this._sizeFlags[1]; }
  set size_flags_vertical(v) {
    if (this._sizeFlags[1] === v) return;
    this._sizeFlags[1] = v;
    this.size_flags_changed.emit();
  }
  get size_flags_stretch_ratio() { return this._stretchRatio; }
  set size_flags_stretch_ratio(v) {
    this._stretchRatio = v;
    this.size_flags_changed.emit();
  }

  get custom_minimum_size() {
    return { x: this._customMin.x, y: this._customMin.y };
  }
  set custom_minimum_size(v) {
    if (v.x === this._customMin.x && v.y === this._customMin.y) return;
    this._customMin = { x: v.x, y: v.y };
    this.update_minimum_size();
  }

  /** The control's own minimum size (virtual; containers and widgets override). */
  get_minimum_size() {
    return { x: 0, y: 0 };
  }

  get_combined_minimum_size() {
    if (!this._minCache) {
      const own = this.get_minimum_size();
      this._minCache = { x: Math.max(own.x, this._customMin.x), y: Math.max(own.y, this._customMin.y) };
    }
    return { x: this._minCache.x, y: this._minCache.y };
  }

  /** Invalidates the cached minimum size; the change propagates at the end of the frame. */
  update_minimum_size() {
    this._minCache = null;
    if (!this._inside || this._minUpdatePending) return;
    this._minUpdatePending = true;
    SceneTree.current?.callDeferred(() => this._update_minimum_size());
  }

  _update_minimum_size() {
    this._minUpdatePending = false;
    if (!this._inside || this._freed) return;
    this._minCache = null;
    const min = this.get_combined_minimum_size();
    if (min.x !== this._lastMin.x || min.y !== this._lastMin.y) {
      this._lastMin = min;
      this._size_changed();
      this.minimum_size_changed.emit();
    }
  }

  // ─────────────────────────────────────────────────────────────── theme ─────────────────────────

  get theme() {
    return this._theme;
  }
  set theme(t) {
    this._theme = t;
    this._themeChangedRecursive(true);
  }

  _themeChangedRecursive(emit = true) {
    this._themeCache.clear();
    this._minCache = null;
    this._theme_changed?.();
    if (emit) this.theme_changed.emit();
    this.queue_redraw();
    if (this._inside) this.update_minimum_size();
    for (const child of this.children) if (child instanceof Control) child._themeChangedRecursive(emit);
  }

  _themeTypes(type) {
    if (type) return typeChain(type);
    const primary = this.theme_type_variation || this.constructor.themeType;
    return typeChain(primary);
  }

  _lookup(kind, name, type) {
    const key = `${kind}|${name}|${type ?? ''}`;
    if (this._themeCache.has(key)) return this._themeCache.get(key);
    let value;
    if (!type && this._overrides[kind].has(name)) value = this._overrides[kind].get(name);
    else {
      const types = this._themeTypes(type);
      outer: for (let node = this; node; node = node.parent) {
        const theme = node instanceof Control ? node._theme : null;
        if (!theme) continue;
        for (const t of types) {
          if (theme.has(kind, name, t)) {
            value = theme.get(kind, name, t);
            break outer;
          }
        }
      }
      if (value === undefined) {
        for (const t of types) {
          if (baseTheme.has(kind, name, t)) {
            value = baseTheme.get(kind, name, t);
            break;
          }
        }
      }
      if (value === undefined && kind === 'font') value = this._defaultFont();
      if (value === undefined && kind === 'font_size') value = this._defaultFontSize();
    }
    if (kind === 'font') value = FontRegistry.resolve(value);
    this._themeCache.set(key, value);
    return value;
  }

  /** The nearest theme up the parent chain (popups copy it: they live outside the owner's subtree). */
  find_theme() {
    for (let node = this; node; node = node.parent) if (node instanceof Control && node._theme) return node._theme;
    return null;
  }

  _defaultFont() {
    for (let node = this; node; node = node.parent) if (node instanceof Control && node._theme?.default_font) return node._theme.default_font;
    return baseTheme.default_font;
  }
  _defaultFontSize() {
    for (let node = this; node; node = node.parent) if (node instanceof Control && node._theme?.default_font_size > 0) return node._theme.default_font_size;
    return baseTheme.default_font_size;
  }

  get_theme_constant(name, type) { return this._lookup('constant', name, type) ?? 0; }
  get_theme_color(name, type) { return this._lookup('color', name, type) ?? new Color(0, 0, 0, 1); }
  get_theme_font(name, type) { return this._lookup('font', name, type); }
  get_theme_font_size(name, type) { return this._lookup('font_size', name, type) ?? this._defaultFontSize(); }
  get_theme_stylebox(name, type) { return this._lookup('stylebox', name, type); }
  get_theme_icon(name, type) { return this._lookup('icon', name, type); }
  has_theme_constant(name, type) { return this._lookup('constant', name, type) !== undefined; }

  _override(kind, name, value) {
    if (value === undefined || value === null) this._overrides[kind].delete(name);
    else this._overrides[kind].set(name, value);
    this._themeChangedRecursive(false);
  }
  add_theme_constant_override(name, value) { this._override('constant', name, value); }
  add_theme_color_override(name, value) { this._override('color', name, value); }
  add_theme_font_override(name, value) { this._override('font', name, value); }
  add_theme_font_size_override(name, value) { this._override('font_size', name, value); }
  add_theme_stylebox_override(name, value) { this._override('stylebox', name, value); }
  add_theme_icon_override(name, value) { this._override('icon', name, value); }
  remove_theme_color_override(name) { this._override('color', name, null); }
  remove_theme_stylebox_override(name) { this._override('stylebox', name, null); }

  // ─────────────────────────────────────────────────────────────── focus & input ─────────────────

  has_focus() {
    return Gui.viewport?.focusOwner === this;
  }

  grab_focus() {
    if (this.focus_mode === FOCUS.NONE || !this.is_visible_in_tree()) return;
    Gui.viewport?.setFocus(this);
  }

  release_focus() {
    if (this.has_focus()) Gui.viewport?.setFocus(null);
  }

  /** Marks the current GUI event handled (stops propagation to parents). */
  accept_event() {
    Gui.viewport?.acceptEvent();
  }

  /** Control::get_tooltip(at_position) */
  get_tooltip(_point) {
    return this.tooltip_text;
  }

  has_point(p) {
    return p.x >= 0 && p.y >= 0 && p.x < this._size.x && p.y < this._size.y;
  }

  /** Global (layer-space) point → local point. */
  toLocal(point) {
    const m = this.get_global_transform();
    const det = m[0] * m[3] - m[1] * m[2];
    const x = point.x - m[4];
    const y = point.y - m[5];
    return { x: (m[3] * x - m[2] * y) / det, y: (-m[1] * x + m[0] * y) / det };
  }

  /** The layer this control draws in (null if not under a CanvasLayer). */
  get_canvas_layer() {
    for (let node = this.parent; node; node = node.parent) if (node instanceof CanvasLayer) return node;
    return null;
  }

  _visibilityChanged() {
    super._visibilityChanged();
    if (!this._visible) Gui.viewport?._controlHidden(this);
    this.get_parent_control()?._childVisibilityChanged?.(this);
  }

  get_global_transform() {
    let m = this.get_transform();
    for (let node = this.parent; node instanceof CanvasItem; node = node.parent) m = multiply(node.get_transform(), m);
    return m;
  }
}
